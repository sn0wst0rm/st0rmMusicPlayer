"""
Wrapper Song Downloader - Downloads ALAC/Atmos tracks using the wrapper service.

This module handles downloading encrypted HLS streams from Apple Music
and decrypting them using amdecrypt.py (FairPlay via wrapper TCP).
"""

import asyncio
import logging
import tempfile
import shutil
from pathlib import Path
from typing import Optional

import httpx
import m3u8
from gamdl.interface.enums import SongCodec, SyncedLyricsFormat

from wrapper_client import WrapperClient
import amdecrypt
from mutagen.mp4 import MP4, MP4Cover

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY = 2.0

# Map SongCodec to M3U8 stream name patterns
CODEC_STREAM_PATTERNS = {
    SongCodec.ALAC: ["audio-alac-stereo", "alac"],
    SongCodec.ATMOS: ["audio-atmos-2768", "audio-atmos-2448", "atmos"],
    SongCodec.AAC: ["audio-stereo-256"],
    SongCodec.AAC_HE: ["audio-HE-stereo-64"],
    SongCodec.AAC_BINAURAL: ["audio-stereo-256-binaural"],
    SongCodec.AAC_DOWNMIX: ["audio-stereo-256-downmix"],
    SongCodec.AAC_HE_BINAURAL: ["audio-HE-stereo-64-binaural"],
    SongCodec.AAC_HE_DOWNMIX: ["audio-HE-stereo-64-downmix"],
}



class WrapperSongDownloader:
    """Downloads and decrypts ALAC/Atmos/AAC tracks using the wrapper service."""
    
    def __init__(self, base_downloader, interface, codec: SongCodec = SongCodec.ALAC, synced_lyrics_format: SyncedLyricsFormat = SyncedLyricsFormat.LRC, no_synced_lyrics: bool = False):
        self.base_downloader = base_downloader
        self.interface = interface
        self.codec = codec
        self.wrapper_client = WrapperClient()
        self.wrapper_ip = "127.0.0.1:10020"
        self.synced_lyrics_format = synced_lyrics_format
        self.no_synced_lyrics = no_synced_lyrics
        self.synced_lyrics_only = False
        self.use_wrapper = True

    def write_synced_lyrics(self, synced_lyrics, lyrics_synced_path: Path):
        """Write lyrics to file."""
        if not synced_lyrics:
            return
        
        try:
            # Attempt to extract content if it's an object
            content = str(synced_lyrics)
            if hasattr(synced_lyrics, 'as_lrc') and self.synced_lyrics_format == SyncedLyricsFormat.LRC:
                content = synced_lyrics.as_lrc()
            elif hasattr(synced_lyrics, 'as_ttml'):
                content = synced_lyrics.as_ttml()
                
            with open(lyrics_synced_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            logger.error(f"Failed to write lyrics file: {e}")
            
    def apply_tags(self, path: Path, download_item):
        """Apply metadata tags to the downloaded file."""
        if not path.exists():
            return
        
        try:
            # metadata is usually in download_item.media_metadata
            tags = getattr(download_item, "media_metadata", {})
            if not tags: 
                logger.warning("No metadata found in download_item")
                return

            video = MP4(path)
            
            # Basic Tags
            if tags.get("title"):
                video["\xa9nam"] = tags["title"]
            if tags.get("artist"):
                video["\xa9ART"] = tags["artist"]
            if tags.get("album_artist"):
                video["aART"] = tags["album_artist"]
            if tags.get("album"):
                video["\xa9alb"] = tags["album"]
            if tags.get("release_year"):
                video["\xa9day"] = str(tags["release_year"])
            if tags.get("genre"):
                video["\xa9gen"] = tags["genre"]
            if tags.get("composer"):
                video["\xa9wrt"] = tags["composer"]
            if tags.get("copyright"):
                video["cprt"] = tags["copyright"]
            if tags.get("grouping"): # Work Name / Grouping
                video["\xa9grp"] = tags["grouping"]
            if tags.get("description"):
                video["desc"] = tags["description"]
            
            # Track/Disc
            try:
                trkn = (int(tags.get("track_number", 0)), int(tags.get("track_count", 0)))
                if trkn[0] > 0:
                    video["trkn"] = [trkn]
            except: pass
                
            try:
                disk = (int(tags.get("disc_number", 0)), int(tags.get("disc_count", 0)))
                if disk[0] > 0:
                    video["disk"] = [disk]
            except: pass

            # Cover Art (Attempt to find it if gamdl stored it)
            # download_item might NOT have cover_path if it's set later in gamdl logic.
            # But the 'temp_path' or similar might exist.
            # We skip cover for now as it's complex to locate without explicit path passing.
            
            video.save()
            logger.info(f"Applied metadata tags to {path}")
        except Exception as e:
            logger.error(f"Failed to apply tags: {e}")

    def is_wrapper_available(self) -> bool:
        """Check if wrapper service is available."""
        return self.wrapper_client.health_check()

    async def download(self, download_item, progress_callback=None) -> Optional[Path]:
        """
        Main download entry point.
        
        Args:
            download_item: The download item from gamdl with metadata and tags
            progress_callback: Optional callback(stage, current, total, bytes, speed) for progress tracking
                              stage is 'download' or 'decrypt'
            
        Returns:
            Path to the downloaded file, or None on failure
        """
        track_id = download_item.media_metadata["id"]
        logger.info(f"WrapperDownloader: Processing track {track_id} ({self.codec.value})")

        # Check wrapper availability
        if not self.is_wrapper_available():
            raise Exception("Wrapper service is not available - check if it's running on port 10020")

        # 1. Fetch M3U8 URL from Wrapper
        m3u8_url = await self._fetch_m3u8_with_retry(track_id)
        if not m3u8_url:
            raise Exception("Failed to get M3U8 URL from wrapper after retries")

        logger.info(f"Got M3U8 URL: {m3u8_url[:80]}...")

        # 2. Download and parse master playlist
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(m3u8_url)
            resp.raise_for_status()
            master_playlist_text = resp.text

        master_playlist = m3u8.loads(master_playlist_text, uri=m3u8_url)
        
        # 3. Select best audio stream based on codec preference
        stream_info = self._select_audio_stream(master_playlist, m3u8_url)
        if not stream_info:
            raise Exception(f"No suitable audio stream found for codec {self.codec.value}")

        media_url, stream_name = stream_info
        logger.info(f"Selected stream: {stream_name}")

        # 4. Fetch Media Playlist
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(media_url)
            resp.raise_for_status()
            media_playlist_text = resp.text
            
        media_seq = m3u8.loads(media_playlist_text, uri=media_url)
        
        # 5. Extract FairPlay Key Info (skip prefetch key P000000000)
        fairplay_key = None
        for key in media_seq.keys:
            if key and key.uri and key.uri.startswith("skd://"):
                if "P000000000" not in key.uri:
                    fairplay_key = key.uri
                    break
        
        if not fairplay_key:
            raise Exception("No FairPlay key found in media playlist")
            
        logger.info(f"FairPlay key: {fairplay_key.split('/')[-1]}")
        
        # 6. Download encrypted file (Apple Music typically has 1 large segment)
        segment = media_seq.segments[0]
        seg_url = segment.uri
        if not seg_url.startswith("http"):
            seg_url = media_url.rsplit("/", 1)[0] + "/" + seg_url
        
        encrypted_data = await self._download_file_with_retry(seg_url, progress_callback)
        if not encrypted_data:
            raise Exception("Failed to download encrypted file")
        
        logger.info(f"Downloaded {len(encrypted_data):,} bytes")
        
        # 7. Save encrypted file to temp location
        # Use unique path to avoid collisions with parallel downloads
        import time
        unique_suffix = f"{track_id}_{self.codec.value}_{int(time.time() * 1000)}"
        temp_dir = Path(tempfile.gettempdir()) / "wrapper_downloads" / unique_suffix
        temp_dir.mkdir(parents=True, exist_ok=True)
        encrypted_path = temp_dir / f"encrypted.m4a"
        encrypted_path.write_bytes(encrypted_data)
        
        # 8. Prepare output path
        temp_path = self.base_downloader.get_temp_path(
            download_item.media_metadata["id"],
            "wrapper_download",
            "decrypted",
            ".m4a"
        )
        Path(temp_path).parent.mkdir(parents=True, exist_ok=True)
        
        # 9. Decrypt using amdecrypt
        logger.info("Decrypting with amdecrypt...")
        
        # Create decrypt progress callback wrapper
        def decrypt_progress(current, total, bytes_done, speed):
            if progress_callback:
                progress_callback('decrypt', current, total, bytes_done, speed)
        
        await amdecrypt.decrypt_file(
            wrapper_ip=self.wrapper_ip,
            mp4decrypt_path="mp4decrypt",
            track_id=track_id,
            fairplay_key=fairplay_key,
            input_path=str(encrypted_path),
            output_path=temp_path,
            progress_callback=decrypt_progress,
        )
        
        # Cleanup encrypted temp file
        encrypted_path.unlink(missing_ok=True)
        
        logger.info(f"Decryption complete: {temp_path}")

        # 10. Finalize (Tags, Cover, Move)
        media_tags = download_item.media_tags
        playlist_tags = download_item.playlist_tags
        
        # Defensive check - media_tags can be None if stream_info was not fetched properly
        if media_tags is None:
            logger.warning("media_tags is None - attempting to use media_metadata for tags")
            # Try to construct minimal tags from media_metadata
            # media_metadata is Apple Music API response with 'id' and 'attributes' keys
            raw_metadata = download_item.media_metadata or {}
            # Extract the nested attributes dict
            attrs = raw_metadata.get('attributes', {}) if isinstance(raw_metadata, dict) else {}
            
            # Create a minimal Tags-like object using gamdl's dataclass if available
            from dataclasses import dataclass
            @dataclass
            class MinimalTags:
                album: str = None
                album_artist: str = None  # Required by gamdl
                album_sort: str = None
                artist: str = None
                artist_sort: str = None
                composer: str = None
                composer_sort: str = None
                copyright: str = None
                disc: int = 1
                disc_total: int = 1
                genre: str = None
                lyrics: str = None
                rating: int = 0
                release_date: str = None
                title: str = None
                title_sort: str = None
                track: int = 1
                track_total: int = 1
                # Additional required fields
                compilation: bool = False
                gapless: bool = False
                media_type: int = 1  # 1 = Music
            
            # Map Apple Music API field names to our Tags fields
            media_tags = MinimalTags(
                album=attrs.get("albumName"),
                album_artist=attrs.get("artistName"),  # Album artist = track artist if not specified
                artist=attrs.get("artistName"),
                title=attrs.get("name"),
                genre=attrs.get("genreNames", [None])[0] if attrs.get("genreNames") else None,
                composer=attrs.get("composerName"),
                copyright=attrs.get("copyright"),
                track=attrs.get("trackNumber", 1),
                track_total=attrs.get("trackCount", 1),
                disc=attrs.get("discNumber", 1),
                disc_total=attrs.get("discCount", 1),
                # Note: release_date removed as gamdl Tags doesn't accept it
            )
            logger.info(f"Created MinimalTags: title={media_tags.title}, artist={media_tags.artist}, album={media_tags.album}")
        
        final_path = self.base_downloader.get_final_path(
            media_tags,
            ".m4a",
            playlist_tags
        )
        
        # Apply tags
        cover_url = self.base_downloader.get_cover_url_template(download_item.media_metadata)
        await self.base_downloader.apply_tags(Path(temp_path), media_tags, cover_url)
        
        # NOTE: Lyrics are NOT downloaded here because:
        # 1. gamdl's interface.get_lyrics() only supports line-by-line lyrics
        # 2. gamdl_service.py handles lyrics with fetch_all_lyrics_variants() 
        #    which supports syllable-synced (word-by-word) lyrics
        # The gamdl_service will download syllable lyrics after this download completes.

        # Move to final location
        self.base_downloader.move_to_final_path(temp_path, final_path)
        
        logger.info(f"Download complete: {final_path}")
        return final_path

    async def _fetch_m3u8_with_retry(self, track_id: str) -> Optional[str]:
        """Fetch M3U8 URL with retry logic."""
        for attempt in range(MAX_RETRIES):
            try:
                m3u8_url = await asyncio.to_thread(
                    self.wrapper_client.fetch_m3u8_url, track_id
                )
                if m3u8_url and "http" in m3u8_url:
                    return m3u8_url
            except Exception as e:
                logger.warning(f"M3U8 fetch attempt {attempt + 1} failed: {e}")
                
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_DELAY)
        
        return None

    def _select_audio_stream(self, master_playlist, base_url: str) -> Optional[tuple[str, str]]:
        """
        Select the audio stream matching the desired codec.
        
        Returns:
            Tuple of (stream_url, stream_name) or None if not found
        """
        patterns = CODEC_STREAM_PATTERNS.get(self.codec, [])
        
        # Check playlists (video variants with audio group reference)
        for pl in master_playlist.playlists:
            audio = getattr(pl.stream_info, 'audio', '')
            if audio:
                audio_lower = str(audio).lower()
                # Check if this matches our codec patterns
                for pattern in patterns:
                    if pattern.lower() in audio_lower:
                        media_url = pl.uri
                        if not media_url.startswith("http"):
                            media_url = base_url.rsplit("/", 1)[0] + "/" + media_url
                        return (media_url, audio)
        
        # Fallback: for ALAC specifically, also check AUDIO media entries
        if self.codec == SongCodec.ALAC:
            for media in master_playlist.media:
                if media.type == "AUDIO" and media.uri:
                    if "alac" in (media.group_id or "").lower():
                        media_url = media.uri
                        if not media_url.startswith("http"):
                            media_url = base_url.rsplit("/", 1)[0] + "/" + media_url
                        return (media_url, media.group_id or "alac")
        
        # Last fallback: use first available playlist
        if master_playlist.playlists:
            for pl in master_playlist.playlists:
                audio = getattr(pl.stream_info, 'audio', '')
                if audio:
                    media_url = pl.uri
                    if not media_url.startswith("http"):
                        media_url = base_url.rsplit("/", 1)[0] + "/" + media_url
                    return (media_url, f"fallback-{audio}")
        
        return None

    async def _download_file_with_retry(self, url: str, progress_callback=None) -> Optional[bytes]:
        """Download a file with retry logic and progress tracking."""
        import time
        
        for attempt in range(MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=180.0) as client:
                    # Use streaming to track progress
                    async with client.stream("GET", url) as resp:
                        resp.raise_for_status()
                        
                        # Try to get content length for progress tracking
                        total_size = int(resp.headers.get("content-length", 0))
                        
                        chunks = []
                        bytes_downloaded = 0
                        start_time = time.time()
                        last_progress_time = start_time
                        
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            chunks.append(chunk)
                            bytes_downloaded += len(chunk)
                            
                            # Call progress callback every 0.5s
                            now = time.time()
                            if progress_callback and (now - last_progress_time > 0.3):
                                elapsed = now - start_time
                                speed = bytes_downloaded / elapsed if elapsed > 0 else 0
                                progress_callback('download', bytes_downloaded, total_size, bytes_downloaded, speed)
                                last_progress_time = now
                        
                        # Final progress update
                        if progress_callback:
                            elapsed = time.time() - start_time
                            speed = bytes_downloaded / elapsed if elapsed > 0 else 0
                            progress_callback('download', bytes_downloaded, total_size, bytes_downloaded, speed)
                        
                        return b"".join(chunks)
            except Exception as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY)
        
        return None


async def download_track_with_wrapper(
    track_id: str,
    codec: str,
    output_path: Path,
    wrapper_ip: str = "127.0.0.1:10020",
) -> Path:
    """
    Standalone function to download a track using the wrapper.
    
    This is a simpler interface that doesn't require gamdl's base_downloader.
    
    Args:
        track_id: Apple Music track ID
        codec: Codec name (alac, atmos, aac, etc.)
        output_path: Output file path
        wrapper_ip: Wrapper service address
        
    Returns:
        Path to the downloaded file
    """
    from wrapper_client import WrapperClient
    
    logger.info(f"Downloading track {track_id} as {codec}")
    
    client = WrapperClient()
    
    # 1. Get M3U8
    m3u8_url = client.fetch_m3u8_url(track_id)
    if not m3u8_url:
        raise Exception("Failed to get M3U8 URL")
    
    # 2. Parse master playlist
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.get(m3u8_url)
        master = m3u8.loads(resp.text, uri=m3u8_url)
    
    # 3. Find matching stream
    codec_lower = codec.lower()
    target_url = None
    target_name = None
    
    for pl in master.playlists:
        audio = str(getattr(pl.stream_info, 'audio', '')).lower()
        if codec_lower in audio or (codec_lower == "alac" and "alac" in audio):
            target_url = pl.uri
            target_name = audio
            break
        elif codec_lower == "atmos" and "atmos" in audio:
            target_url = pl.uri
            target_name = audio
            break
    
    if not target_url:
        # Fallback to first stream
        if master.playlists:
            target_url = master.playlists[0].uri
            target_name = str(getattr(master.playlists[0].stream_info, 'audio', 'unknown'))
    
    if not target_url:
        raise Exception("No audio stream found")
    
    if not target_url.startswith("http"):
        target_url = m3u8_url.rsplit("/", 1)[0] + "/" + target_url
    
    logger.info(f"Selected stream: {target_name}")
    
    # 4. Parse media playlist
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.get(target_url)
        media = m3u8.loads(resp.text, uri=target_url)
    
    # 5. Get FairPlay key
    fairplay_key = None
    for key in media.keys:
        if key and key.uri and "P000000000" not in key.uri:
            fairplay_key = key.uri
            break
    
    if not fairplay_key:
        raise Exception("No FairPlay key found")
    
    # 6. Download encrypted file
    segment = media.segments[0]
    seg_url = segment.uri
    if not seg_url.startswith("http"):
        seg_url = target_url.rsplit("/", 1)[0] + "/" + seg_url
    
    async with httpx.AsyncClient(timeout=180.0) as http:
        resp = await http.get(seg_url)
        encrypted_data = resp.content
    
    # 7. Save and decrypt
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as f:
        f.write(encrypted_data)
        encrypted_path = f.name
    
    await amdecrypt.decrypt_file(
        wrapper_ip=wrapper_ip,
        mp4decrypt_path="mp4decrypt",
        track_id=track_id,
        fairplay_key=fairplay_key,
        input_path=encrypted_path,
        output_path=str(output_path),
    )
    
    Path(encrypted_path).unlink(missing_ok=True)
    
    # 8. Apply Tags
    self.apply_tags(Path(output_path), download_item)
    
    logger.info(f"Downloaded: {output_path}")
    return output_path

