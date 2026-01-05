"""
Apple Music Decrypt - Python implementation of amdecrypt.

This module decrypts FairPlay-encrypted MP4 files via the wrapper service.
It parses MP4 structure, sends individual samples to the wrapper for decryption,
and reassembles the decrypted file.

Based on: https://github.com/glomatico/amdecrypt
"""

import asyncio
import io
import logging
import os
import socket
import struct
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, List, Optional

logger = logging.getLogger(__name__)

# Pre-fetch key used for first sample description
PREFETCH_KEY = "skd://itunes.apple.com/P000000000/s1/e1"

# Default wrapper address
DEFAULT_WRAPPER_IP = "127.0.0.1:10020"


@dataclass
class SampleInfo:
    """Information about a single audio sample."""
    data: bytes
    duration: int
    desc_index: int


@dataclass
class SongInfo:
    """Extracted song information from MP4 file."""
    samples: List[SampleInfo] = field(default_factory=list)
    moov_data: bytes = b""
    ftyp_data: bytes = b""


def read_box_header(f: BinaryIO) -> tuple[int, str, int]:
    """Read MP4 box header, return (size, type, header_size)."""
    header = f.read(8)
    if len(header) < 8:
        return 0, "", 0
    
    size = struct.unpack(">I", header[:4])[0]
    box_type = header[4:8].decode("ascii", errors="replace")
    header_size = 8
    
    if size == 1:  # Extended size
        ext_size = f.read(8)
        size = struct.unpack(">Q", ext_size)[0]
        header_size = 16
    elif size == 0:  # Box extends to end of file
        pos = f.tell()
        f.seek(0, 2)  # Seek to end
        size = f.tell() - pos + header_size
        f.seek(pos)
    
    return size, box_type, header_size


def find_box(data: bytes, box_path: List[str]) -> Optional[bytes]:
    """Find a box in MP4 data by path (e.g., ['moov', 'trak', 'mdia'])."""
    f = io.BytesIO(data)
    
    for target_type in box_path:
        found = False
        while True:
            pos = f.tell()
            size, box_type, header_size = read_box_header(f)
            if size == 0:
                break
            
            if box_type == target_type:
                f.seek(pos + header_size)  # Skip past header
                found = True
                break
            else:
                f.seek(pos + size)  # Skip this box
        
        if not found:
            return None
    
    # Return remaining data from current position
    return f.read()


def extract_song(input_path: str) -> SongInfo:
    """
    Extract song samples and metadata from encrypted MP4 file.
    
    This parses the MP4 structure to extract:
    - ftyp and moov boxes (for reassembly)
    - Individual audio samples from mdat boxes
    - Sample durations and description indices from moof boxes
    """
    with open(input_path, "rb") as f:
        raw_data = f.read()
    
    song_info = SongInfo()
    
    # First pass: collect all top-level boxes
    boxes = []
    offset = 0
    while offset < len(raw_data) - 8:
        size = struct.unpack(">I", raw_data[offset:offset+4])[0]
        box_type = raw_data[offset+4:offset+8].decode("ascii", errors="replace")
        
        header_size = 8
        if size == 0:
            break
        if size == 1:
            # Extended size
            if offset + 16 > len(raw_data):
                break
            size = struct.unpack(">Q", raw_data[offset+8:offset+16])[0]
            header_size = 16
        
        boxes.append({
            "offset": offset,
            "size": size,
            "type": box_type,
            "header_size": header_size,
            "data": raw_data[offset:offset+size],
        })
        offset += size
    
    logger.debug(f"Found {len(boxes)} top-level boxes")
    
    # Extract ftyp and moov
    for box in boxes:
        if box["type"] == "ftyp":
            song_info.ftyp_data = box["data"]
        elif box["type"] == "moov":
            song_info.moov_data = box["data"]
    
    # Get default sample info from trex (inside moov)
    default_sample_duration = 1024
    default_sample_size = 0
    
    # Parse moof/mdat pairs
    moof_box = None
    for box in boxes:
        if box["type"] == "moof":
            moof_box = box
        elif box["type"] == "mdat" and moof_box is not None:
            # Parse this moof/mdat pair
            moof_data = moof_box["data"]
            mdat_data = box["data"][box["header_size"]:]  # Skip mdat header
            
            # Parse moof for tfhd (sample description index, defaults) and trun (entries)
            samples_from_pair = _parse_moof_mdat(
                moof_data, mdat_data,
                default_sample_duration, default_sample_size
            )
            song_info.samples.extend(samples_from_pair)
            moof_box = None
    
    logger.info(f"Extracted {len(song_info.samples)} samples from {input_path}")
    return song_info


def _parse_moof_mdat(moof_data: bytes, mdat_data: bytes,
                     default_sample_duration: int, default_sample_size: int) -> List[SampleInfo]:
    """Parse a moof box and extract samples from corresponding mdat."""
    samples = []
    
    # Parse moof to find tfhd (track fragment header) and trun (track run)
    tfhd_info = {"desc_index": 0, "default_duration": default_sample_duration, 
                 "default_size": default_sample_size, "flags": 0}
    trun_entries = []
    
    # Simple box parsing inside moof
    offset = 8  # Skip moof header
    while offset < len(moof_data) - 8:
        size = struct.unpack(">I", moof_data[offset:offset+4])[0]
        box_type = moof_data[offset+4:offset+8].decode("ascii", errors="replace")
        
        if size == 0 or offset + size > len(moof_data):
            break
        
        if box_type == "traf":
            # Parse inside traf
            traf_offset = offset + 8
            traf_end = offset + size
            while traf_offset < traf_end - 8:
                inner_size = struct.unpack(">I", moof_data[traf_offset:traf_offset+4])[0]
                inner_type = moof_data[traf_offset+4:traf_offset+8].decode("ascii", errors="replace")
                
                if inner_size == 0:
                    break
                
                if inner_type == "tfhd":
                    _parse_tfhd(moof_data[traf_offset+8:traf_offset+inner_size], tfhd_info)
                elif inner_type == "trun":
                    trun_entries = _parse_trun(moof_data[traf_offset+8:traf_offset+inner_size], tfhd_info)
                
                traf_offset += inner_size
        
        offset += size
    
    # Extract samples from mdat using trun entries
    mdat_offset = 0
    desc_index = tfhd_info["desc_index"]
    if desc_index > 0:
        desc_index -= 1  # Convert to 0-indexed
    
    for entry in trun_entries:
        sample_size = entry.get("size", tfhd_info["default_size"])
        sample_duration = entry.get("duration", tfhd_info["default_duration"])
        
        if sample_size > 0 and mdat_offset + sample_size <= len(mdat_data):
            sample = SampleInfo(
                data=mdat_data[mdat_offset:mdat_offset + sample_size],
                duration=sample_duration,
                desc_index=desc_index,
            )
            samples.append(sample)
            mdat_offset += sample_size
    
    return samples


def _parse_tfhd(data: bytes, tfhd_info: dict):
    """Parse track fragment header box (FullBox: version + flags + content)."""
    if len(data) < 8:  # version(1) + flags(3) + track_id(4)
        return
    
    # FullBox: version(1) + flags(3)
    version = data[0]
    flags = struct.unpack(">I", b'\x00' + data[1:4])[0]
    tfhd_info["flags"] = flags
    
    # After version+flags is track_id(4)
    offset = 4 + 4  # version+flags + track_id
    
    if flags & 0x01 and offset + 8 <= len(data):  # base_data_offset
        offset += 8
    if flags & 0x02 and offset + 4 <= len(data):  # sample_description_index
        tfhd_info["desc_index"] = struct.unpack(">I", data[offset:offset+4])[0]
        offset += 4
    if flags & 0x08 and offset + 4 <= len(data):  # default_sample_duration
        tfhd_info["default_duration"] = struct.unpack(">I", data[offset:offset+4])[0]
        offset += 4
    if flags & 0x10 and offset + 4 <= len(data):  # default_sample_size
        tfhd_info["default_size"] = struct.unpack(">I", data[offset:offset+4])[0]


def _parse_trun(data: bytes, tfhd_info: dict) -> List[dict]:
    """Parse track run box to get sample entries (FullBox: version + flags + content)."""
    entries = []
    if len(data) < 8:  # version(1) + flags(3) + sample_count(4)
        return entries
    
    # FullBox: version(1) + flags(3)
    version = data[0]
    flags = struct.unpack(">I", b'\x00' + data[1:4])[0]
    sample_count = struct.unpack(">I", data[4:8])[0]
    
    # Start reading entries after header fields
    offset = 8  # version+flags(4) + sample_count(4)
    if flags & 0x01:  # data_offset present
        offset += 4
    if flags & 0x04:  # first_sample_flags present
        offset += 4
    
    for _ in range(sample_count):
        entry = {}
        if flags & 0x100 and offset + 4 <= len(data):  # sample_duration
            entry["duration"] = struct.unpack(">I", data[offset:offset+4])[0]
            offset += 4
        if flags & 0x200 and offset + 4 <= len(data):  # sample_size
            entry["size"] = struct.unpack(">I", data[offset:offset+4])[0]
            offset += 4
        if flags & 0x400:  # sample_flags
            offset += 4
        if flags & 0x800:  # sample_composition_time_offset
            offset += 4
        entries.append(entry)
    
    return entries


def decrypt_samples(
    wrapper_ip: str,
    track_id: str,
    fairplay_key: str,
    samples: List[SampleInfo],
) -> bytes:
    """
    Send samples to wrapper for CBCS decryption and return decrypted data.
    
    CBCS full subsample encryption (used by ALAC):
    - Only bytes aligned to 16 are encrypted
    - Remaining bytes (len % 16) are clear and kept as-is
    
    Protocol:
    - For each new key: [1B id_len][id][1B key_len][key]
    - For each sample: [4B LE truncated_size][truncated_data] -> read back [decrypted_data]
    - Key switch: [0,0,0,0]
    - Close: [0,0,0,0,0]
    """
    host, port = wrapper_ip.split(":")
    port = int(port)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(120.0)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)  # Disable Nagle
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 262144)  # 256KB send buffer
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 262144)  # 256KB recv buffer
    sock.connect((host, port))
    
    # Use buffered I/O like Go's bufio
    sock_writer = sock.makefile('wb', buffering=65536)
    sock_reader = sock.makefile('rb', buffering=65536)
    
    try:
        decrypted_data = bytearray()
        last_desc_index = 255
        
        keys = [PREFETCH_KEY, fairplay_key]
        
        for i, sample in enumerate(samples):
            # Check if we need to switch keys
            if last_desc_index != sample.desc_index:
                if last_desc_index != 255:
                    # Send key switch signal
                    sock_writer.write(struct.pack("<I", 0))
                    sock_writer.flush()
                
                # Send new key info
                key_uri = keys[min(sample.desc_index, len(keys) - 1)]
                
                if key_uri == PREFETCH_KEY:
                    id_bytes = b"0"
                else:
                    id_bytes = track_id.encode("utf-8")
                sock_writer.write(struct.pack("B", len(id_bytes)))
                sock_writer.write(id_bytes)
                
                key_bytes = key_uri.encode("utf-8")
                sock_writer.write(struct.pack("B", len(key_bytes)))
                sock_writer.write(key_bytes)
                sock_writer.flush()
                
                last_desc_index = sample.desc_index
            
            # CBCS full subsample decryption: truncate to 16-byte boundary
            sample_len = len(sample.data)
            truncated_len = sample_len & ~0xf
            
            if truncated_len > 0:
                # Send size and data
                sock_writer.write(struct.pack("<I", truncated_len))
                sock_writer.write(sample.data[:truncated_len])
                sock_writer.flush()
                
                # Read decrypted data
                decrypted_sample = sock_reader.read(truncated_len)
                if len(decrypted_sample) != truncated_len:
                    raise IOError(f"Short read: got {len(decrypted_sample)}, expected {truncated_len}")
                decrypted_data.extend(decrypted_sample)
            
            # Append clear bytes
            if truncated_len < sample_len:
                decrypted_data.extend(sample.data[truncated_len:])
        
        # Send close signal
        sock_writer.write(bytes([0, 0, 0, 0, 0]))
        sock_writer.flush()
        
        logger.info(f"Decrypted {len(samples)} samples ({len(decrypted_data)} bytes)")
        return bytes(decrypted_data)
    
    finally:
        sock_writer.close()
        sock_reader.close()
        sock.close()


def write_decrypted_m4a(
    output_path: str,
    song_info: SongInfo,
    decrypted_data: bytes,
    mp4decrypt_path: str = "mp4decrypt",
    original_path: str = None,
) -> None:
    """
    Write decrypted MP4 file as non-fragmented MP4.
    
    Creates a new MP4 from scratch with:
    - ftyp box (M4A compatible)
    - moov box with proper sample tables (stts, stsc, stsz, stco)
    - Single mdat box with all decrypted samples
    
    This matches the output format of Go's amdecrypt which is required
    for ALAC playback.
    """
    temp_path = output_path + ".tmp.m4a"
    
    # Extract stsd content and timescale from original moov
    stsd_content = None
    timescale = 44100  # Default
    if original_path:
        with open(original_path, "rb") as f:
            orig_data = f.read()
        stsd_content = _extract_stsd_content(orig_data)
        timescale = _extract_timescale(orig_data)
    elif song_info.moov_data:
        stsd_content = _extract_stsd_content(song_info.ftyp_data + song_info.moov_data)
        timescale = _extract_timescale(song_info.moov_data)
    
    with open(temp_path, "wb") as f:
        # Write ftyp
        _write_ftyp(f)
        
        # Calculate total duration
        total_duration = sum(s.duration for s in song_info.samples)
        
        # Write moov with sample tables
        _write_moov(f, song_info.samples, total_duration, timescale, stsd_content, decrypted_data)
        
        # Write mdat
        _write_mdat(f, decrypted_data)
    
    # Use mp4decrypt to clean up the file (removes any stale encryption metadata)
    try:
        result = subprocess.run(
            [
                mp4decrypt_path,
                "--key", "00000000000000000000000000000000:00000000000000000000000000000000",
                temp_path,
                output_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            # mp4decrypt may fail on non-fragmented, just use temp as output
            logger.debug(f"mp4decrypt returned {result.returncode}, using raw output")
            os.rename(temp_path, output_path)
        else:
            os.remove(temp_path)
    except FileNotFoundError:
        os.rename(temp_path, output_path)
    
    logger.info(f"Wrote decrypted file to {output_path}")


def _write_box(f, box_type: bytes, content: bytes):
    """Write a simple MP4 box."""
    size = len(content) + 8
    f.write(struct.pack(">I", size))
    f.write(box_type)
    f.write(content)


def _write_ftyp(f):
    """Write ftyp box for M4A."""
    content = b"M4A " + struct.pack(">I", 0)  # major brand + minor version
    content += b"M4A mp42isom\x00\x00\x00\x00"  # compatible brands
    _write_box(f, b"ftyp", content)


def _write_fullbox(f, box_type: bytes, version: int, flags: int, content: bytes):
    """Write a FullBox (with version and flags)."""
    size = len(content) + 12
    f.write(struct.pack(">I", size))
    f.write(box_type)
    f.write(struct.pack("B", version))
    f.write(struct.pack(">I", flags)[1:])  # 3 bytes for flags
    f.write(content)


def _write_moov(f, samples: List[SampleInfo], total_duration: int, timescale: int, 
                stsd_content: bytes, decrypted_data: bytes):
    """Write moov box with sample tables."""
    # First, build all the content
    moov_start = f.tell()
    
    # Placeholder for moov header
    f.write(b"\x00" * 8)
    
    # mvhd (movie header)
    mvhd_content = struct.pack(">I", 0)  # creation_time
    mvhd_content += struct.pack(">I", 0)  # modification_time
    mvhd_content += struct.pack(">I", timescale)
    mvhd_content += struct.pack(">I", total_duration)
    mvhd_content += struct.pack(">I", 0x00010000)  # rate (1.0)
    mvhd_content += struct.pack(">H", 0x0100)  # volume (1.0)
    mvhd_content += b"\x00" * 10  # reserved
    mvhd_content += struct.pack(">9I", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)  # matrix
    mvhd_content += b"\x00" * 24  # pre_defined
    mvhd_content += struct.pack(">I", 2)  # next_track_id
    _write_fullbox(f, b"mvhd", 0, 0, mvhd_content)
    
    # trak (track)
    trak_start = f.tell()
    f.write(b"\x00" * 8)  # trak header placeholder
    
    # tkhd (track header)
    tkhd_content = struct.pack(">I", 0)  # creation_time
    tkhd_content += struct.pack(">I", 0)  # modification_time
    tkhd_content += struct.pack(">I", 1)  # track_id
    tkhd_content += struct.pack(">I", 0)  # reserved
    tkhd_content += struct.pack(">I", total_duration)
    tkhd_content += b"\x00" * 8  # reserved
    tkhd_content += struct.pack(">H", 0)  # layer
    tkhd_content += struct.pack(">H", 0)  # alternate_group
    tkhd_content += struct.pack(">H", 0x0100)  # volume
    tkhd_content += struct.pack(">H", 0)  # reserved
    tkhd_content += struct.pack(">9I", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)  # matrix
    tkhd_content += struct.pack(">I", 0)  # width
    tkhd_content += struct.pack(">I", 0)  # height
    _write_fullbox(f, b"tkhd", 0, 7, tkhd_content)  # flags=7 (enabled, in_movie, in_preview)
    
    # mdia (media)
    mdia_start = f.tell()
    f.write(b"\x00" * 8)
    
    # mdhd (media header)
    mdhd_content = struct.pack(">I", 0)  # creation_time
    mdhd_content += struct.pack(">I", 0)  # modification_time
    mdhd_content += struct.pack(">I", timescale)
    mdhd_content += struct.pack(">I", total_duration)
    mdhd_content += struct.pack(">H", 0x55C4)  # language (und)
    mdhd_content += struct.pack(">H", 0)  # quality
    _write_fullbox(f, b"mdhd", 0, 0, mdhd_content)
    
    # hdlr (handler)
    hdlr_content = struct.pack(">I", 0)  # pre_defined
    hdlr_content += b"soun"  # handler_type
    hdlr_content += b"\x00" * 12  # reserved
    hdlr_content += b"SoundHandler\x00"
    _write_fullbox(f, b"hdlr", 0, 0, hdlr_content)
    
    # minf (media info)
    minf_start = f.tell()
    f.write(b"\x00" * 8)
    
    # smhd (sound media header)
    smhd_content = struct.pack(">H", 0)  # balance
    smhd_content += struct.pack(">H", 0)  # reserved
    _write_fullbox(f, b"smhd", 0, 0, smhd_content)
    
    # dinf + dref
    dinf_start = f.tell()
    f.write(b"\x00" * 8)
    dref_content = struct.pack(">I", 1)  # entry_count
    dref_content += struct.pack(">I", 12) + b"url " + struct.pack(">I", 1)  # url entry (self-contained)
    _write_fullbox(f, b"dref", 0, 0, dref_content)
    _fixup_box_size(f, dinf_start, b"dinf")
    
    # stbl (sample table)
    stbl_start = f.tell()
    f.write(b"\x00" * 8)
    
    # stsd (sample description) - use content from original file
    _write_stsd(f, stsd_content)
    
    # stts (time-to-sample)
    _write_stts(f, samples)
    
    # stsc (sample-to-chunk) - all samples in one chunk
    stsc_content = struct.pack(">I", 1)  # entry_count
    stsc_content += struct.pack(">III", 1, len(samples), 1)  # first_chunk, samples_per_chunk, sample_description_index
    _write_fullbox(f, b"stsc", 0, 0, stsc_content)
    
    # stsz (sample size)
    stsz_content = struct.pack(">I", 0)  # sample_size (0 = variable)
    stsz_content += struct.pack(">I", len(samples))  # sample_count
    for sample in samples:
        stsz_content += struct.pack(">I", len(sample.data))
    _write_fullbox(f, b"stsz", 0, 0, stsz_content)
    
    # stco (chunk offset) - will be fixed up later
    stco_pos = f.tell()
    stco_content = struct.pack(">I", 1)  # entry_count
    stco_content += struct.pack(">I", 0)  # chunk_offset (placeholder)
    _write_fullbox(f, b"stco", 0, 0, stco_content)
    
    _fixup_box_size(f, stbl_start, b"stbl")
    _fixup_box_size(f, minf_start, b"minf")
    _fixup_box_size(f, mdia_start, b"mdia")
    _fixup_box_size(f, trak_start, b"trak")
    _fixup_box_size(f, moov_start, b"moov")
    
    # Fix up stco with correct mdat offset
    mdat_offset = f.tell() + 8  # +8 for mdat header
    f.seek(stco_pos + 16)  # +12 for box header + version/flags, +4 for entry_count
    f.write(struct.pack(">I", mdat_offset))
    f.seek(0, 2)  # Back to end


def _write_stsd(f, stsd_content: bytes):
    """Write sample description box using content from original file.
    This preserves the original codec info (ALAC, EC-3, AAC, etc.).
    """
    if stsd_content:
        # Write the full stsd box with its content from the source file
        size = len(stsd_content) + 8
        f.write(struct.pack(">I", size))
        f.write(b"stsd")
        f.write(stsd_content)
    else:
        # Fallback: write a basic ALAC stsd if no source content available
        _write_stsd_alac_fallback(f)


def _write_stsd_alac_fallback(f):
    """Write a default ALAC sample description box (fallback)."""
    stsd_start = f.tell()
    f.write(b"\x00" * 12)  # box header + version/flags placeholder
    
    f.write(struct.pack(">I", 1))  # entry_count
    
    # alac sample entry
    alac_start = f.tell()
    f.write(b"\x00" * 8)  # alac box header placeholder
    
    f.write(b"\x00" * 6)  # reserved
    f.write(struct.pack(">H", 1))  # data_reference_index
    f.write(b"\x00" * 8)  # reserved
    f.write(struct.pack(">H", 2))  # channel_count
    f.write(struct.pack(">H", 16))  # sample_size (bits)
    f.write(struct.pack(">H", 0))  # pre_defined
    f.write(struct.pack(">H", 0))  # reserved
    f.write(struct.pack(">I", 44100 << 16))  # sample_rate (16.16 fixed point)
    
    # alac magic cookie box
    # Default ALAC config for 44.1kHz stereo 24-bit
    default_config = bytes([
        0x00, 0x00, 0x10, 0x00,  # frame_length
        0x00,  # compatible_version
        0x18,  # bit_depth (24)
        0x28, 0x28, 0x0A,  # pb, mb, kb
        0x02,  # num_channels
        0x00, 0x00,  # max_run
        0x00, 0x00, 0xFF, 0xFF,  # max_frame_bytes
        0x00, 0x0D, 0x00, 0x80,  # avg_bit_rate
        0x00, 0x00, 0xAC, 0x44,  # sample_rate
    ])
    _write_box(f, b"alac", default_config)
    
    _fixup_box_size(f, alac_start, b"alac")
    
    # Fix stsd size
    end_pos = f.tell()
    size = end_pos - stsd_start
    f.seek(stsd_start)
    f.write(struct.pack(">I", size))
    f.write(b"stsd")
    f.write(struct.pack(">I", 0))  # version + flags
    f.seek(end_pos)


def _write_stts(f, samples: List[SampleInfo]):
    """Write time-to-sample box (run-length encoded)."""
    # Run-length encode durations
    entries = []
    for sample in samples:
        if entries and entries[-1][1] == sample.duration:
            entries[-1] = (entries[-1][0] + 1, sample.duration)
        else:
            entries.append((1, sample.duration))
    
    content = struct.pack(">I", len(entries))
    for count, delta in entries:
        content += struct.pack(">II", count, delta)
    _write_fullbox(f, b"stts", 0, 0, content)


def _fixup_box_size(f, start_pos: int, box_type: bytes):
    """Fix up the size field of a box that was written with placeholder."""
    end_pos = f.tell()
    size = end_pos - start_pos
    f.seek(start_pos)
    f.write(struct.pack(">I", size))
    f.write(box_type)
    f.seek(end_pos)


def _write_mdat(f, data: bytes):
    """Write mdat box with decrypted data."""
    size = len(data) + 8
    f.write(struct.pack(">I", size))
    f.write(b"mdat")
    f.write(data)


def _extract_stsd_content(data: bytes) -> Optional[bytes]:
    """Extract full stsd box content from moov box (supports any codec)."""
    # Find stsd box in the data
    idx = data.find(b"stsd")
    if idx < 4:
        return None
    
    # Get stsd box size
    size = struct.unpack(">I", data[idx-4:idx])[0]
    if size < 16 or size > 10000:  # Reasonable stsd size range
        return None
    
    # Return stsd content (after box header = size + type)
    return data[idx+4:idx-4+size]


def _extract_alac_config(data: bytes) -> Optional[bytes]:
    """Extract ALAC configuration from moov/stsd box (for backwards compatibility)."""
    # Simple search for 'alac' box in data
    idx = data.find(b"alac")
    if idx < 4:
        return None
    
    # Check if it's inside stsd (look for full structure)
    # The 'alac' cookie box follows the sample entry
    alac_idx = idx
    while alac_idx < len(data) - 100:
        if data[alac_idx:alac_idx+4] == b"alac":
            size = struct.unpack(">I", data[alac_idx-4:alac_idx])[0]
            if 20 < size < 100:  # Reasonable ALAC config size
                return data[alac_idx+4:alac_idx-4+size]
        alac_idx += 1
        if alac_idx > idx + 200:
            break
    return None


def _extract_timescale(data: bytes) -> int:
    """Extract timescale from moov/mvhd or mdhd box."""
    # Look for mdhd box (media header has the audio timescale)
    idx = data.find(b"mdhd")
    if idx > 0 and idx + 24 < len(data):
        # mdhd: version(1) + flags(3) + creation(4) + modification(4) + timescale(4)
        return struct.unpack(">I", data[idx+16:idx+20])[0]
    return 44100  # Default


async def decrypt_file(
    wrapper_ip: str,
    mp4decrypt_path: str,
    track_id: str,
    fairplay_key: str,
    input_path: str,
    output_path: str,
) -> None:
    """
    Main decryption function - decrypt an encrypted MP4 file via the wrapper.
    
    This is the Python equivalent of the amdecrypt tool:
    1. Extract samples from encrypted MP4
    2. Send samples to wrapper for FairPlay decryption
    3. Reassemble decrypted MP4
    4. Fix metadata with mp4decrypt
    
    Args:
        wrapper_ip: Wrapper decrypt port address (e.g., "127.0.0.1:10020")
        mp4decrypt_path: Path to mp4decrypt binary
        track_id: Apple Music track ID
        fairplay_key: FairPlay key URI (skd://...)
        input_path: Path to encrypted MP4 file
        output_path: Path for decrypted output file
    """
    logger.info(f"Decrypting {input_path} -> {output_path}")
    
    # Extract samples (run in thread to not block)
    song_info = await asyncio.to_thread(extract_song, input_path)
    
    # Decrypt samples via wrapper
    decrypted_data = await asyncio.to_thread(
        decrypt_samples,
        wrapper_ip,
        track_id,
        fairplay_key,
        song_info.samples,
    )
    
    # Write output file (preserve original structure, replace mdat content)
    await asyncio.to_thread(
        write_decrypted_m4a,
        output_path,
        song_info,
        decrypted_data,
        mp4decrypt_path,
        input_path,  # Pass original path for in-place replacement
    )


# CLI interface for testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) != 7:
        print(f"Usage: {sys.argv[0]} <wrapper_ip> <mp4decrypt_path> <track_id> <fairplay_key> <input_path> <output_path>")
        sys.exit(1)
    
    logging.basicConfig(level=logging.INFO)
    
    asyncio.run(decrypt_file(
        wrapper_ip=sys.argv[1],
        mp4decrypt_path=sys.argv[2],
        track_id=sys.argv[3],
        fairplay_key=sys.argv[4],
        input_path=sys.argv[5],
        output_path=sys.argv[6],
    ))
