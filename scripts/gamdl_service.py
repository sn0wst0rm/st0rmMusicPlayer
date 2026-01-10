#!/usr/bin/env python3
"""
gamdl Service - FastAPI microservice for Apple Music downloads via gamdl.
Returns metadata via SSE for Next.js to insert into the database via Prisma.
"""

import asyncio
import json
import os
import sys
import tempfile
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import websockets
# Use websockets.serve directly to avoid deprecation warning
from wrapper_downloader import WrapperSongDownloader
from wrapper_manager import get_wrapper_manager, stop_wrapper, init_wrapper_manager

# Global state
active_downloads: dict = {}
# Cached AppleMusicApi instance to avoid re-initialization on every request
_cached_api: dict = {
    "api": None,
    "cookies_hash": None,
    "last_used": None
}
# Background scheduler for playlist sync
_scheduler: Optional[AsyncIOScheduler] = None
# WebSocket server and connected clients
_ws_server = None
_ws_clients: set = set()
# Wrapper auth socket state
_wrapper_auth_socket = None
_wrapper_auth_queue: asyncio.Queue = None  # Queue for auth messages from wrapper
_wrapper_auth_pending: dict = {}  # Pending credentials/otp to send

# Path to the Widevine Device file for L3 decryption (required for standard AAC)
WVD_PATH = Path(__file__).parent / "device.wvd"

# Codecs that work with gamdl native (Widevine, no wrapper needed)
GAMDL_NATIVE_CODECS = ["aac-legacy", "aac-he-legacy"]

# All other codecs require wrapper (FairPlay decryption)
# Includes: aac, aac-he, aac-binaural, aac-downmix, aac-he-binaural, aac-he-downmix, alac, atmos, ac3

def is_wrapper_required(codec: str) -> bool:
    """Check if a codec requires the wrapper for decryption."""
    return codec.lower() not in GAMDL_NATIVE_CODECS


async def download_private_library_track(
    api,
    library_id: str,
    output_path: Path,
    progress_callback=None
) -> dict | None:
    """
    Download a private/uploaded library track (not in Apple Music catalog).
    
    Private tracks are stored unencrypted in Apple's blobstore and can be
    downloaded directly without FairPlay decryption.
    
    Args:
        api: Initialized AppleMusicApi instance
        library_id: Library track ID starting with 'i.' (e.g., 'i.KoJEDdbIYKQDzA')
        output_path: Base output directory for downloads
        progress_callback: Optional callback(stage, current, total, bytes, speed)
        
    Returns:
        Dict with download info including file_path and metadata, or None on failure
    """
    import httpx
    from mutagen.mp4 import MP4, MP4Cover
    
    print(f"[PRIVATE TRACK] Fetching playback info for {library_id}", flush=True)
    
    # Make direct API call to webPlayback with universalLibraryId
    # This bypasses the gamdl library which only supports salableAdamId (catalog IDs)
    WEBPLAYBACK_API_URL = "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                WEBPLAYBACK_API_URL,
                headers={
                    "Authorization": f"Bearer {api.token}",
                    "x-apple-music-user-token": api.media_user_token,
                    "Content-Type": "application/json",
                    "Origin": "https://music.apple.com",
                    "Referer": "https://music.apple.com/",
                },
                json={
                    "universalLibraryId": library_id,
                    "language": api.language,
                },
            )
            
            if response.status_code != 200:
                print(f"[PRIVATE TRACK] API returned status {response.status_code} for {library_id}", flush=True)
                return None
            
            playback = response.json()
    except Exception as e:
        print(f"[PRIVATE TRACK] API request failed: {e}", flush=True)
        return None
    
    if not playback or not playback.get("songList"):
        print(f"[PRIVATE TRACK] No playback info available for {library_id}", flush=True)
        return None
    
    song_info = playback["songList"][0]
    assets = song_info.get("assets", [])
    if not assets:
        print(f"[PRIVATE TRACK] No assets in playback info for {library_id}", flush=True)
        return None
    
    asset = assets[0]
    audio_url = asset.get("URL")
    metadata = asset.get("metadata", {})
    artwork_url = song_info.get("artworkURL")
    
    if not audio_url:
        print(f"[PRIVATE TRACK] No audio URL in assets for {library_id}", flush=True)
        return None
    
    print(f"[PRIVATE TRACK] Downloading from blobstore: {audio_url[:80]}...", flush=True)
    
    # Extract metadata
    artist_name = metadata.get("artistName", "Unknown Artist")
    album_name = metadata.get("playlistName", "Unknown Album")  # playlistName is the album for library tracks
    track_name = metadata.get("itemName", "Unknown Track")
    duration_ms = metadata.get("duration", 0)
    genre = metadata.get("genre", "")
    year = metadata.get("year", 0)
    track_number = metadata.get("trackNumber", 0)
    disc_number = metadata.get("discNumber", 0)
    
    # Create safe folder structure: Artist/Album/Track.m4a
    safe_artist = "".join(c for c in artist_name if c.isalnum() or c in " -_").strip() or "Unknown Artist"
    safe_album = "".join(c for c in album_name if c.isalnum() or c in " -_").strip() or "Unknown Album"
    safe_track = "".join(c for c in track_name if c.isalnum() or c in " -_").strip() or "Unknown Track"
    
    track_folder = output_path / safe_artist / safe_album
    track_folder.mkdir(parents=True, exist_ok=True)
    
    # Add track number prefix if available
    if track_number > 0:
        file_name = f"{track_number:02d} {safe_track}.m4a"
    else:
        file_name = f"{safe_track}.m4a"
    
    final_path = track_folder / file_name
    
    # Check if file already exists
    if final_path.exists():
        print(f"[PRIVATE TRACK] File already exists: {final_path}", flush=True)
        return {
            "file_path": str(final_path),
            "library_id": library_id,
            "already_exists": True,
            "metadata": {
                "title": track_name,
                "artist": artist_name,
                "album": album_name,
                "duration_ms": duration_ms,
                "genre": genre,
                "year": year,
                "track_number": track_number,
                "disc_number": disc_number,
            }
        }
    
    # Download the audio file
    import time
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream("GET", audio_url) as resp:
                resp.raise_for_status()
                
                total_size = int(resp.headers.get("content-length", 0))
                bytes_downloaded = 0
                start_time = time.time()
                last_progress_time = start_time
                
                temp_path = final_path.with_suffix(".tmp")
                with open(temp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        bytes_downloaded += len(chunk)
                        
                        # Progress callback
                        now = time.time()
                        if progress_callback and (now - last_progress_time > 0.3):
                            elapsed = now - start_time
                            speed = bytes_downloaded / elapsed if elapsed > 0 else 0
                            progress_callback('download', bytes_downloaded, total_size, bytes_downloaded, speed)
                            last_progress_time = now
                
                # Final progress
                if progress_callback:
                    elapsed = time.time() - start_time
                    speed = bytes_downloaded / elapsed if elapsed > 0 else 0
                    progress_callback('download', bytes_downloaded, total_size, bytes_downloaded, speed)
        
        # Move temp to final
        temp_path.rename(final_path)
        print(f"[PRIVATE TRACK] Downloaded {bytes_downloaded:,} bytes to {final_path}", flush=True)
        
    except Exception as e:
        print(f"[PRIVATE TRACK] Download failed: {e}", flush=True)
        if temp_path.exists():
            temp_path.unlink()
        return None
    
    # Apply metadata tags
    try:
        audio = MP4(final_path)
        audio["\xa9nam"] = track_name  # Title
        audio["\xa9ART"] = artist_name  # Artist
        audio["\xa9alb"] = album_name  # Album
        audio["aART"] = artist_name  # Album Artist
        if genre:
            audio["\xa9gen"] = genre
        if year > 0:
            audio["\xa9day"] = str(year)
        if track_number > 0:
            audio["trkn"] = [(track_number, metadata.get("trackCount", 0))]
        if disc_number > 0:
            audio["disk"] = [(disc_number, metadata.get("discCount", 0))]
        
        # Download and embed artwork if available
        if artwork_url:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    art_resp = await client.get(artwork_url)
                    if art_resp.status_code == 200:
                        content_type = art_resp.headers.get("content-type", "")
                        if "jpeg" in content_type or "jpg" in content_type:
                            image_format = MP4Cover.FORMAT_JPEG
                        else:
                            image_format = MP4Cover.FORMAT_PNG
                        audio["covr"] = [MP4Cover(art_resp.content, imageformat=image_format)]
                        print(f"[PRIVATE TRACK] Embedded artwork", flush=True)
            except Exception as art_err:
                print(f"[PRIVATE TRACK] Could not embed artwork: {art_err}", flush=True)
        
        audio.save()
        print(f"[PRIVATE TRACK] Applied metadata tags", flush=True)
        
    except Exception as e:
        print(f"[PRIVATE TRACK] Error applying tags: {e}", flush=True)
        # File is still valid, just without tags
    
    return {
        "file_path": str(final_path),
        "library_id": library_id,
        "already_exists": False,
        "metadata": {
            "title": track_name,
            "artist": artist_name,
            "album": album_name,
            "duration_ms": duration_ms,
            "genre": genre,
            "year": year,
            "track_number": track_number,
            "disc_number": disc_number,
            "artwork_url": artwork_url,
        }
    }


import subprocess
import re


def get_animated_cover_url(album_attrs: dict) -> str | None:
    """
    Extract the best quality animated cover (motion artwork) URL from album attributes.
    Returns the HLS m3u8 URL if available, None otherwise.
    """
    try:
        editorial_video = album_attrs.get("editorialVideo", {})
        if not editorial_video:
            print(f"[ANIMATED COVER] No editorialVideo field in album attributes", flush=True)
            return None
        
        print(f"[ANIMATED COVER] Found editorialVideo with keys: {list(editorial_video.keys())}", flush=True)
        
        # Try different motion artwork variants in order of preference
        # motionDetailSquare is typically used for album art
        variants = [
            "motionDetailSquare",
            "motionSquareVideo1x1",
            "motionDetailTall",
            "motionTallVideo3x4",
        ]
        
        for variant in variants:
            video_data = editorial_video.get(variant, {})
            video_url = video_data.get("video")
            if video_url:
                print(f"[ANIMATED COVER] Found {variant}: {video_url[:100]}...", flush=True)
                return video_url
        
        print(f"[ANIMATED COVER] No supported motion artwork variant found", flush=True)
        return None
    except Exception as e:
        print(f"[ANIMATED COVER] Error extracting URL: {e}", flush=True)
        return None


async def download_animated_cover(
    m3u8_url: str,
    output_dir: Path,
    album_id: str
) -> dict | None:
    """
    Download animated album cover from HLS stream and convert to MP4.
    Creates both full quality and web-optimized versions.
    Skips if files already exist.
    
    Returns dict with paths: {"full": path, "small": path} or None on failure.
    """
    try:
        full_path = output_dir / "cover-animated.gif"
        small_path = output_dir / "cover-animated-small.gif"
        
        # Also check for old MP4 versions
        old_full_path = output_dir / "cover-animated.mp4"
        old_small_path = output_dir / "cover-animated-small.mp4"
        
        # Check if GIF files already exist - skip re-encoding
        if full_path.exists() and small_path.exists():
            print(f"[ANIMATED COVER] ✅ GIF already exists, skipping: {full_path}", flush=True)
            return {
                "full": str(full_path),
                "small": str(small_path)
            }
        
        # If only full GIF exists, create small version
        if full_path.exists() and not small_path.exists():
            print(f"[ANIMATED COVER] Full GIF exists, creating small version only", flush=True)
            small_palette_path = output_dir / "palette_small.png"
            small_palette_cmd = [
                "ffmpeg", "-y",
                "-i", str(full_path),
                "-vf", "fps=15,scale=200:-1:flags=lanczos,palettegen",
                str(small_palette_path)
            ]
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(small_palette_cmd, capture_output=True, timeout=60)
            )
            if result.returncode == 0 and small_palette_path.exists():
                small_gif_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(full_path),
                    "-i", str(small_palette_path),
                    "-lavfi", "fps=15,scale=200:-1:flags=lanczos[x];[x][1:v]paletteuse",
                    "-loop", "0",
                    str(small_path)
                ]
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: subprocess.run(small_gif_cmd, capture_output=True, timeout=60)
                )
                if small_palette_path.exists():
                    small_palette_path.unlink()
            if small_path.exists():
                return {"full": str(full_path), "small": str(small_path)}
            return {"full": str(full_path), "small": None}
        
        print(f"[ANIMATED COVER] Downloading from: {m3u8_url[:80]}...", flush=True)
        
        # First, fetch the master playlist to find the best quality stream
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(m3u8_url)
            if response.status_code != 200:
                print(f"[ANIMATED COVER] Failed to fetch playlist: {response.status_code}", flush=True)
                return None
            
            playlist_content = response.text
        
        # Parse the master playlist to find the highest resolution variant
        best_stream_url = m3u8_url  # Default to master if parsing fails
        best_bandwidth = 0
        
        lines = playlist_content.strip().split('\n')
        for i, line in enumerate(lines):
            if line.startswith('#EXT-X-STREAM-INF'):
                # Extract bandwidth
                bandwidth_match = re.search(r'BANDWIDTH=(\d+)', line)
                if bandwidth_match:
                    bandwidth = int(bandwidth_match.group(1))
                    if bandwidth > best_bandwidth and i + 1 < len(lines):
                        best_bandwidth = bandwidth
                        variant_url = lines[i + 1].strip()
                        # Handle relative URLs
                        if not variant_url.startswith('http'):
                            base_url = m3u8_url.rsplit('/', 1)[0]
                            variant_url = f"{base_url}/{variant_url}"
                        best_stream_url = variant_url
        
        print(f"[ANIMATED COVER] Selected best quality (bandwidth: {best_bandwidth})", flush=True)
        
        # Step 1: Download best quality MP4 (preserving full duration)
        # Using -c copy to avoid transcoding issues with HEVC HLS streams that cause duration truncation
        mp4_path = output_dir / "cover-animated.mp4"
        if not mp4_path.exists():
            # Two-step approach to ensure full duration is captured:
            # 1. First download with -c copy to preserve the complete HLS stream
            mp4_cmd = [
                "ffmpeg", "-y",
                "-i", best_stream_url,
                "-c", "copy",  # No transcoding - preserves full duration
                "-an",          # No audio
                "-movflags", "+faststart",
                str(mp4_path)
            ]
            
            print(f"[ANIMATED COVER] Downloading best quality MP4 (copy mode)...", flush=True)
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(mp4_cmd, capture_output=True, timeout=300)  # Increased timeout for full download
            )
            
            if result.returncode != 0:
                print(f"[ANIMATED COVER] MP4 download failed: {result.stderr.decode()[:500]}", flush=True)
                return None
            
            # Verify the downloaded file has reasonable duration
            try:
                probe_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(mp4_path)]
                probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                if probe_res.returncode == 0:
                    duration = float(probe_res.stdout.strip())
                    print(f"[ANIMATED COVER] Downloaded MP4 duration: {duration:.1f}s", flush=True)
            except Exception as e:
                print(f"[ANIMATED COVER] Could not probe duration: {e}", flush=True)
        else:
            print(f"[ANIMATED COVER] MP4 already exists, using existing", flush=True)
        
        # Step 2: Create high-quality GIF from MP4 (works with CSS backdrop-blur)
        palette_path = output_dir / "palette.png"
        
        # Generate palette from MP4
        palette_cmd = [
            "ffmpeg", "-y",
            "-i", str(mp4_path),
            "-vf", "fps=25,scale=600:-1:flags=lanczos,palettegen=stats_mode=diff",
            str(palette_path)
        ]
        
        print(f"[ANIMATED COVER] Generating color palette for GIF...", flush=True)
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(palette_cmd, capture_output=True, timeout=120)
        )
        
        if result.returncode != 0:
            print(f"[ANIMATED COVER] Palette generation failed: {result.stderr.decode()[:500]}", flush=True)
            # Generate small, optimized GIF (seamless loop)
            # Resize filter should be part of the complex filter chain?
            # Or we can just use the same filter logic but change scale.
            
            filter_complex_small = (
                f"[0]split[body][pre];"
                f"[pre]trim=start={start_trim}:duration={fade_dur},setpts=PTS-STARTPTS[fade];"
                f"[fade]format=yuva420p,fade=t=out:st=0:d={fade_dur}:alpha=1,setpts=PTS-STARTPTS+(0/TB)[faded];"
                f"[body]trim=duration={duration},setpts=PTS-STARTPTS[main];"
                f"[main][faded]overlay=0:0:enable='between(t,0,{fade_dur})'[out];"
                f"[out]trim=duration={out_dur}[final];"
                f"[final]fps=15,scale=200:-1:flags=lanczos[x];"
                f"[x]split[x1][x2];[x1]palettegen[p];[x2][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
            )
            
            small_cmd = [
                "ffmpeg", "-y",
                "-i", str(mp4_path),
                "-filter_complex", filter_complex_small,
                "-loop", "0",
                str(small_path)
            ]
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(small_cmd, capture_output=True, timeout=120)
            )
        else:
            # Use palette for high quality GIF with seamless loop crossfade
            # Crossfade logic:
            # 1. Split input into two streams
            # 2. Trim stream 1 to exclude the fade-out part (start=4:duration=1 is assuming 5s total, but we need to be dynamic)
            # Actually, since we don't know exact duration here, we rely on the fact that most are short loops.
            # But the complex filter derived earlier was specific to 5s.
            # For a generic solution, we should probably stick to a simple loop if we can't guarantee 5s.
            # However, the user issue was specifcally about the abrupt jump.
            # Providing a generic crossfade filter for "end to start" overlap:
            # We will use a safe 0.5s crossfade.
            
            # Simple Palette Generation (unchanged, just scale/fps)
            # We can't easily do complex filter in palettegen if we don't know duration.
            # So we will just generate palette from the raw MP4 (it's fine, colors won't change much).
            
            # But the final GIF generation needs the filter.
            # The filter used in the script was:
            # [0]split[body][pre];
            # [pre]trim=start=4:duration=1...
            # This requires knowing the duration (5s) and start time (4s).
            # To do this generically in python, we need to probe the file first.
            
            # Since I cannot easily add probing logic here without refactoring, 
            # and the user confirmed the MP4 is 5.0s, I will apply the filter assuming 5s for now 
            # OR I can add a quick probe.
            
            # PROBING DURATION:
            # We already have mp4_path.
            cmd_probe = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(mp4_path)]
            try:
                probe_res = subprocess.run(cmd_probe, capture_output=True, text=True)
                duration = float(probe_res.stdout.strip())
                fade_dur = 1.0
                if duration < 2.0: fade_dur = 0.2
                start_trim = duration - fade_dur
                out_dur = duration - fade_dur
                
                filter_complex = (
                    f"[0]split[body][pre];"
                    f"[pre]trim=start={start_trim}:duration={fade_dur},setpts=PTS-STARTPTS[fade];"
                    f"[fade]format=yuva420p,fade=t=out:st=0:d={fade_dur}:alpha=1,setpts=PTS-STARTPTS+(0/TB)[faded];"
                    f"[body]trim=duration={duration},setpts=PTS-STARTPTS[main];"
                    f"[main][faded]overlay=0:0:enable='between(t,0,{fade_dur})'[out];"
                    f"[out]trim=duration={out_dur}[final];"
                    f"[final]fps=25,scale=600:-1:flags=lanczos[x];"
                    f"[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
                )
                
                gif_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(mp4_path),
                    "-i", str(palette_path),
                    "-filter_complex", filter_complex,
                    "-loop", "0",
                    str(full_path)
                ]
            except Exception as e:
                print(f"[ANIMATED COVER] Failed to probe duration for crossfade: {e}, falling back to simple loop", flush=True)
                gif_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(mp4_path),
                    "-i", str(palette_path),
                    "-lavfi", "fps=25,scale=600:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                    "-loop", "0",
                    str(full_path)
                ]
            
            print(f"[ANIMATED COVER] Converting MP4 to high-quality GIF...", flush=True)
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(gif_cmd, capture_output=True, timeout=120)
            )
            
            # Clean up palette
            if palette_path.exists():
                palette_path.unlink()
        
        if result.returncode != 0:
            print(f"[ANIMATED COVER] GIF conversion failed: {result.stderr.decode()[:500]}", flush=True)
            return None
        
        if not full_path.exists():
            print(f"[ANIMATED COVER] GIF output file not created", flush=True)
            return None
        
        # Step 3: Create smaller GIF version for player
        small_palette_path = output_dir / "palette_small.png"
        
        small_palette_cmd = [
            "ffmpeg", "-y",
            "-i", str(full_path),
            "-vf", "fps=15,scale=200:-1:flags=lanczos,palettegen",
            str(small_palette_path)
        ]
        
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(small_palette_cmd, capture_output=True, timeout=60)
        )
        
        if result.returncode == 0 and small_palette_path.exists():
            small_gif_cmd = [
                "ffmpeg", "-y",
                "-i", str(full_path),
                "-i", str(small_palette_path),
                "-lavfi", "fps=15,scale=200:-1:flags=lanczos[x];[x][1:v]paletteuse",
                "-loop", "0",
                str(small_path)
            ]
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(small_gif_cmd, capture_output=True, timeout=60)
            )
            if small_palette_path.exists():
                small_palette_path.unlink()
        else:
            # Fallback without palette
            small_cmd = [
                "ffmpeg", "-y",
                "-i", str(full_path),
                "-vf", "fps=15,scale=200:-1",
                "-loop", "0",
                str(small_path)
            ]
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(small_cmd, capture_output=True, timeout=60)
            )
        
        if result.returncode != 0:
            print(f"[ANIMATED COVER] Small GIF failed: {result.stderr.decode()[:500]}", flush=True)
            return {"full": str(full_path), "small": None}
        
        print(f"[ANIMATED COVER] ✅ Downloaded MP4 + created both GIF versions", flush=True)
        return {
            "full": str(full_path),
            "small": str(small_path) if small_path.exists() else None
        }
        
    except asyncio.TimeoutError:
        print(f"[ANIMATED COVER] Download timed out", flush=True)
        return None
    except Exception as e:
        print(f"[ANIMATED COVER] Error downloading: {e}", flush=True)
        traceback.print_exc()
        return None


async def download_artist_hero_media(
    artist_name: str,
    artist_attrs: dict,
    media_library_path: Path
) -> dict:
    """
    Download artist hero media (animated video and static images) to .metadata folder.

    Returns dict with paths:
    {
        "heroAnimatedPath": path to hero-animated.mp4 (or None),
        "heroStaticPath": path to hero-static.jpg (always downloaded),
        "profileImagePath": path to profile.jpg (always downloaded)
    }
    """
    result = {
        "heroAnimatedPath": None,
        "heroStaticPath": None,
        "profileImagePath": None
    }

    try:
        # Sanitize artist name for folder path
        safe_artist_name = re.sub(r'[<>:"/\\|?*]', '_', artist_name)
        artist_folder = media_library_path / safe_artist_name
        metadata_folder = artist_folder / ".metadata"
        metadata_folder.mkdir(parents=True, exist_ok=True)

        print(f"[ARTIST HERO] Processing hero media for: {artist_name}", flush=True)

        # Extract URLs from artist attributes
        editorial_video = artist_attrs.get("editorialVideo", {})
        artwork = artist_attrs.get("artwork", {})

        # 1. Download animated hero video (motionArtistWide16x9)
        motion_wide = editorial_video.get("motionArtistWide16x9", {})
        hero_m3u8_url = motion_wide.get("video")

        if hero_m3u8_url:
            hero_mp4_path = metadata_folder / "hero-animated.mp4"

            if hero_mp4_path.exists():
                print(f"[ARTIST HERO] ✅ Hero video already exists: {hero_mp4_path}", flush=True)
                result["heroAnimatedPath"] = str(hero_mp4_path)
            else:
                print(f"[ARTIST HERO] Downloading hero video from: {hero_m3u8_url[:80]}...", flush=True)

                # Fetch master playlist and find a reasonable quality stream (1080p AVC)
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.get(hero_m3u8_url)
                    if response.status_code == 200:
                        playlist_content = response.text

                        # Find a 1080p AVC stream (good quality but not too heavy)
                        # Prefer AVC (h264) over HEVC for better compatibility
                        best_stream_url = hero_m3u8_url
                        target_stream_url = None

                        lines = playlist_content.strip().split('\n')
                        for i, line in enumerate(lines):
                            if line.startswith('#EXT-X-STREAM-INF'):
                                # Look for 1080p AVC stream
                                if 'avc1' in line and '1920x1080' in line and i + 1 < len(lines):
                                    variant_url = lines[i + 1].strip()
                                    if not variant_url.startswith('http'):
                                        base_url = hero_m3u8_url.rsplit('/', 1)[0]
                                        variant_url = f"{base_url}/{variant_url}"
                                    target_stream_url = variant_url
                                    # Get bandwidth for logging
                                    bandwidth_match = re.search(r'BANDWIDTH=(\d+)', line)
                                    bandwidth = int(bandwidth_match.group(1)) if bandwidth_match else 0
                                    print(f"[ARTIST HERO] Selected 1080p AVC stream (bandwidth: {bandwidth})", flush=True)
                                    break

                        # Fallback to 720p if no 1080p found
                        if not target_stream_url:
                            for i, line in enumerate(lines):
                                if line.startswith('#EXT-X-STREAM-INF'):
                                    if 'avc1' in line and '1280x720' in line and i + 1 < len(lines):
                                        variant_url = lines[i + 1].strip()
                                        if not variant_url.startswith('http'):
                                            base_url = hero_m3u8_url.rsplit('/', 1)[0]
                                            variant_url = f"{base_url}/{variant_url}"
                                        target_stream_url = variant_url
                                        print(f"[ARTIST HERO] Selected 720p AVC stream (fallback)", flush=True)
                                        break

                        # Use the master URL if no specific variant found (let ffmpeg pick)
                        if not target_stream_url:
                            target_stream_url = hero_m3u8_url
                            print(f"[ARTIST HERO] Using master playlist (ffmpeg will select)", flush=True)

                        # Download as MP4 with longer timeout and copy codec when possible
                        mp4_cmd = [
                            "ffmpeg", "-y",
                            "-i", target_stream_url,
                            "-c:v", "libx264",
                            "-preset", "fast",
                            "-crf", "22",
                            "-an",  # No audio
                            "-movflags", "+faststart",
                            str(hero_mp4_path)
                        ]

                        print(f"[ARTIST HERO] Starting ffmpeg download (this may take a while)...", flush=True)

                        ffmpeg_result = await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda: subprocess.run(mp4_cmd, capture_output=True, timeout=600)  # 10 min timeout
                        )

                        if ffmpeg_result.returncode == 0 and hero_mp4_path.exists():
                            # Check duration
                            probe_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(hero_mp4_path)]
                            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
                            duration = float(probe_result.stdout.strip()) if probe_result.stdout.strip() else 0
                            print(f"[ARTIST HERO] ✅ Hero video downloaded: {hero_mp4_path} ({duration:.1f}s)", flush=True)
                            result["heroAnimatedPath"] = str(hero_mp4_path)
                        else:
                            print(f"[ARTIST HERO] Hero video download failed: {ffmpeg_result.stderr.decode()[:300]}", flush=True)

        # 2. Download static hero image (from previewFrame or fallback to artwork)
        hero_static_path = metadata_folder / "hero-static.jpg"

        if not hero_static_path.exists():
            # Try previewFrame from motionArtistWide16x9 first
            preview_frame = motion_wide.get("previewFrame", {})
            static_url = preview_frame.get("url") if preview_frame else None

            if static_url:
                # Transform URL template
                static_url = static_url.replace("{w}", "3840").replace("{h}", "2160").replace("{c}", "").replace("{f}", "jpg")
            else:
                # Fallback to regular artwork (square, use larger size)
                artwork_url = artwork.get("url")
                if artwork_url:
                    static_url = artwork_url.replace("{w}", "2400").replace("{h}", "2400").replace("{c}", "").replace("{f}", "jpg")

            if static_url:
                print(f"[ARTIST HERO] Downloading static hero: {static_url[:80]}...", flush=True)
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.get(static_url)
                    if response.status_code == 200:
                        hero_static_path.write_bytes(response.content)
                        print(f"[ARTIST HERO] ✅ Static hero downloaded: {hero_static_path}", flush=True)
                        result["heroStaticPath"] = str(hero_static_path)
                    else:
                        print(f"[ARTIST HERO] Static hero download failed: {response.status_code}", flush=True)
        else:
            print(f"[ARTIST HERO] ✅ Static hero already exists: {hero_static_path}", flush=True)
            result["heroStaticPath"] = str(hero_static_path)

        # 3. Download profile image (from artwork)
        profile_path = metadata_folder / "profile.jpg"

        if not profile_path.exists():
            artwork_url = artwork.get("url")
            if artwork_url:
                profile_url = artwork_url.replace("{w}", "1200").replace("{h}", "1200").replace("{c}", "").replace("{f}", "jpg")
                print(f"[ARTIST HERO] Downloading profile image: {profile_url[:80]}...", flush=True)
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.get(profile_url)
                    if response.status_code == 200:
                        profile_path.write_bytes(response.content)
                        print(f"[ARTIST HERO] ✅ Profile image downloaded: {profile_path}", flush=True)
                        result["profileImagePath"] = str(profile_path)
                    else:
                        print(f"[ARTIST HERO] Profile image download failed: {response.status_code}", flush=True)
        else:
            print(f"[ARTIST HERO] ✅ Profile image already exists: {profile_path}", flush=True)
            result["profileImagePath"] = str(profile_path)

        return result

    except Exception as e:
        print(f"[ARTIST HERO] Error downloading hero media: {e}", flush=True)
        traceback.print_exc()
        return result


async def background_download_artist_hero(
    artist_id: str,
    artist_name: str,
    artist_attrs: dict,
    media_library_path: Path,
    db_path: str
):
    """
    Background task to download artist hero media and save to database.
    This runs asynchronously so it doesn't block the API response.
    """
    try:
        print(f"[ARTIST HERO BG] Starting background download for: {artist_name}", flush=True)

        # Download hero media
        hero_paths = await download_artist_hero_media(artist_name, artist_attrs, media_library_path)

        # Save paths to database
        if any(hero_paths.values()):
            import sqlite3
            save_conn = sqlite3.connect(db_path)
            save_cursor = save_conn.cursor()
            update_query = """
                UPDATE Artist SET
                    heroAnimatedPath = COALESCE(?, heroAnimatedPath),
                    heroStaticPath = COALESCE(?, heroStaticPath),
                    profileImagePath = COALESCE(?, profileImagePath),
                    updatedAt = datetime('now')
                WHERE appleMusicId = ?
            """
            save_cursor.execute(update_query, (
                hero_paths.get("heroAnimatedPath"),
                hero_paths.get("heroStaticPath"),
                hero_paths.get("profileImagePath"),
                artist_id
            ))
            save_conn.commit()
            save_conn.close()
            print(f"[ARTIST HERO BG] ✅ Saved hero paths for {artist_name}", flush=True)
        else:
            print(f"[ARTIST HERO BG] No hero paths to save for {artist_name}", flush=True)

    except Exception as e:
        print(f"[ARTIST HERO BG] Error in background download: {e}", flush=True)
        traceback.print_exc()


def extract_track_info_for_ws(download_item) -> dict:
    """Extract track info from download_item for WebSocket broadcast events."""
    info = {
        "track_id": None,
        "title": "Unknown",
        "artist": "Unknown Artist",
        "album": "Unknown Album"
    }
    
    try:
        # Try media_metadata first (dict with 'id' and 'attributes')
        if hasattr(download_item, 'media_metadata') and download_item.media_metadata:
            mm = download_item.media_metadata
            if isinstance(mm, dict):
                info["track_id"] = mm.get("id")
                attrs = mm.get("attributes", {})
                if attrs:
                    info["title"] = attrs.get("name", info["title"])
                    info["artist"] = attrs.get("artistName", info["artist"])
                    info["album"] = attrs.get("albumName", info["album"])
        
        # Fallback to media_tags (object with properties)
        if hasattr(download_item, 'media_tags') and download_item.media_tags:
            mt = download_item.media_tags
            if hasattr(mt, 'title') and mt.title:
                info["title"] = str(mt.title)
            if hasattr(mt, 'artist') and mt.artist:
                info["artist"] = str(mt.artist)
            if hasattr(mt, 'album') and mt.album:
                info["album"] = str(mt.album)
            if hasattr(mt, 'title_id') and mt.title_id:
                info["track_id"] = str(mt.title_id)
    except Exception as e:
        print(f"[WS] Error extracting track info: {e}", flush=True)
    
    return info


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global _scheduler
    
    print("🎵 gamdl service starting...", flush=True)
    
    # Pre-warm the AppleMusicApi in the background
    # This fetches the auth token early so first request is fast
    asyncio.create_task(prewarm_api())
    
    # Initialize and start the background scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.start()
    print("📅 Background scheduler started", flush=True)
    
    # Start WebSocket server
    asyncio.create_task(start_websocket_server())
    
    # Start the sync scheduler configuration task
    asyncio.create_task(configure_sync_scheduler())
    
    yield
    
    # Shutdown wrapper subprocess
    print("🔧 Stopping wrapper subprocess...", flush=True)
    stop_wrapper()
    
    # Shutdown WebSocket server
    global _ws_server
    if _ws_server:
        _ws_server.close()
        await _ws_server.wait_closed()
        print("🔌 WebSocket server stopped", flush=True)
    
    # Shutdown scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        print("📅 Background scheduler stopped", flush=True)
    
    print("🎵 gamdl service shutting down...", flush=True)


async def start_websocket_server():
    """Start the WebSocket server on port 5101."""
    global _ws_server
    
    try:
        _ws_server = await websockets.serve(websocket_handler, "0.0.0.0", 5101)
        print("🔌 WebSocket server started on ws://0.0.0.0:5101", flush=True)
    except Exception as e:
        print(f"❌ Failed to start WebSocket server: {e}", flush=True)


async def websocket_handler(websocket):
    """Handle WebSocket connections from Next.js backend."""
    global _ws_clients
    
    _ws_clients.add(websocket)
    client_id = id(websocket)
    print(f"[WS] Client {client_id} connected. Total clients: {len(_ws_clients)}", flush=True)
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                response = await handle_ws_message(data, websocket)
                if response:
                    await websocket.send(json.dumps(response))
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON"}))
            except Exception as e:
                print(f"[WS] Error handling message: {e}", flush=True)
                await websocket.send(json.dumps({"error": str(e)}))
    except websockets.ConnectionClosed:
        pass
    finally:
        _ws_clients.discard(websocket)
        print(f"[WS] Client {client_id} disconnected. Total clients: {len(_ws_clients)}", flush=True)


async def handle_ws_message(data: dict, websocket) -> Optional[dict]:
    """Handle incoming WebSocket messages and route to appropriate handlers."""
    msg_type = data.get("type")
    request_id = data.get("requestId")
    
    if msg_type == "ping":
        return {"type": "pong", "requestId": request_id}
    
    elif msg_type == "validate":
        # Validate a URL
        result = await ws_handle_validate(data)
        return {"type": "validate_result", "requestId": request_id, "data": result}
    
    elif msg_type == "validate_batch":
        # Validate multiple URLs
        result = await ws_handle_validate_batch(data)
        return {"type": "validate_batch_result", "requestId": request_id, "data": result}
    
    elif msg_type == "download":
        # Start a download - progress will be sent via separate events
        asyncio.create_task(ws_handle_download(data, websocket, request_id))
        return {"type": "download_started", "requestId": request_id}
    
    elif msg_type == "sync_playlist":
        # Sync a specific playlist
        asyncio.create_task(ws_handle_sync_playlist(data, websocket, request_id))
        return {"type": "sync_started", "requestId": request_id}
    
    elif msg_type == "get_playlist_tracks":
        # Get tracks for a playlist from Apple Music
        result = await ws_handle_get_playlist_tracks(data)
        return {"type": "playlist_tracks", "requestId": request_id, "data": result}
    
    else:
        return {"type": "error", "requestId": request_id, "error": f"Unknown message type: {msg_type}"}


async def broadcast_ws_event(event_type: str, data: dict):
    """Broadcast an event to all connected WebSocket clients."""
    client_count = len(_ws_clients)
    # Only log non-progress events to reduce console spam
    if event_type != "download_progress":
        print(f"[WS BROADCAST] {event_type} -> {client_count} clients", flush=True)
    
    if not _ws_clients:
        return
    
    message = json.dumps({"type": event_type, "data": data})
    
    disconnected = set()
    for client in _ws_clients:
        try:
            await client.send(message)
        except websockets.ConnectionClosed:
            disconnected.add(client)
    
    _ws_clients.difference_update(disconnected)


# ============ WebSocket Message Handlers ============

async def ws_handle_validate(data: dict) -> dict:
    """Handle URL validation via WebSocket."""
    url = data.get("url")
    cookies = data.get("cookies")
    
    if not url:
        return {"valid": False, "error": "URL is required"}
    
    try:
        # Use existing validation logic
        url_info = parse_apple_music_url(url)
        if not url_info.get("valid"):
            return {"valid": False, "error": url_info.get("error", "Invalid URL")}
        
        if cookies:
            api = await get_or_create_api(cookies)
            metadata = await fetch_metadata_for_url(api, url_info)
            if metadata:
                return metadata
        
        return {
            "valid": True,
            "type": url_info.get("type"),
            "apple_music_id": url_info.get("id") or url_info.get("track_id"),
            "extracted_url": url_info.get("extracted_url"),
        }
    except Exception as e:
        return {"valid": False, "error": str(e)}


async def ws_handle_validate_batch(data: dict) -> dict:
    """Handle batch URL validation via WebSocket."""
    text = data.get("text")
    cookies = data.get("cookies")
    
    if not text:
        return {"items": [], "total_found": 0}
    
    # Use existing batch validation logic (simplified)
    parsed_urls = find_all_apple_music_urls(text)
    if not parsed_urls:
        return {"items": [], "total_found": 0}
    
    items = []
    for url_info in parsed_urls:
        try:
            item = {
                "valid": True,
                "type": url_info.get("type"),
                "apple_music_id": url_info.get("id") or url_info.get("track_id"),
                "extracted_url": url_info.get("extracted_url"),
            }
            
            if cookies:
                api = await get_or_create_api(cookies)
                metadata = await fetch_metadata_for_url(api, url_info)
                if metadata:
                    item.update(metadata)
            
            items.append(item)
        except Exception as e:
            items.append({"valid": False, "error": str(e), "extracted_url": url_info.get("extracted_url")})
    
    return {"items": items, "total_found": len(items)}


async def ws_handle_download(data: dict, websocket, request_id: str):
    """Handle download request via WebSocket with progress streaming."""
    url = data.get("url")
    cookies = data.get("cookies")
    output_dir = data.get("output_dir")
    
    try:
        # Send progress updates via WebSocket instead of SSE
        async def send_progress(event: str, event_data: dict):
            await websocket.send(json.dumps({
                "type": f"download_{event}",
                "requestId": request_id,
                "data": event_data
            }))
        
        await send_progress("started", {"url": url})
        
        # Use existing download logic
        result = await perform_download(url, cookies, output_dir, send_progress)
        
        await send_progress("complete", result)
        
    except Exception as e:
        await websocket.send(json.dumps({
            "type": "download_error",
            "requestId": request_id,
            "error": str(e)
        }))


async def ws_handle_sync_playlist(data: dict, websocket, request_id: str):
    """Handle playlist sync request via WebSocket."""
    playlist_id = data.get("playlistId")
    apple_music_id = data.get("appleMusicId")
    global_id = data.get("globalId")
    cookies = data.get("cookies")
    
    try:
        async def send_progress(event: str, event_data: dict):
            await websocket.send(json.dumps({
                "type": f"sync_{event}",
                "requestId": request_id,
                "data": event_data
            }))
        
        await send_progress("started", {"playlistId": playlist_id})
        
        # Get current tracks from Apple Music
        api = await get_or_create_api(cookies)
        
        # Prefer globalId for fetching
        fetch_id = global_id or apple_music_id
        is_library = fetch_id.startswith(("p.", "i.", "l.")) if fetch_id else False
        
        if is_library:
            playlist_data = await api.get_library_playlist(fetch_id)
        else:
            playlist_data = await api.get_playlist(fetch_id)
        
        if not playlist_data:
            await send_progress("error", {"error": "Could not fetch playlist from Apple Music"})
            return
        
        if isinstance(playlist_data, dict) and 'data' in playlist_data:
            playlist_data = playlist_data['data'][0] if playlist_data['data'] else None
        
        if not playlist_data:
            await send_progress("error", {"error": "Empty playlist data from Apple Music"})
            return
        
        attrs = playlist_data.get("attributes", {})
        rels = playlist_data.get("relationships", {})
        tracks_data = rels.get("tracks", {}).get("data", [])
        
        await send_progress("tracks_found", {
            "playlistId": playlist_id,
            "trackCount": len(tracks_data),
            "playlistName": attrs.get("name"),
            "lastModifiedDate": attrs.get("lastModifiedDate")
        })
        
        # Return track list for Next.js to compare and sync
        remote_tracks = []
        for i, track in enumerate(tracks_data):
            track_attrs = track.get("attributes", {})
            remote_tracks.append({
                "position": i,
                "appleMusicId": track.get("id"),
                "title": track_attrs.get("name"),
                "artistName": track_attrs.get("artistName"),
                "albumName": track_attrs.get("albumName"),
                "durationMs": track_attrs.get("durationInMillis"),
            })
        
        await send_progress("complete", {
            "playlistId": playlist_id,
            "remoteTracks": remote_tracks,
            "lastModifiedDate": attrs.get("lastModifiedDate")
        })
        
    except Exception as e:
        await websocket.send(json.dumps({
            "type": "sync_error",
            "requestId": request_id,
            "error": str(e)
        }))


async def ws_handle_get_playlist_tracks(data: dict) -> dict:
    """Get playlist tracks from Apple Music API."""
    apple_music_id = data.get("appleMusicId")
    global_id = data.get("globalId")
    cookies = data.get("cookies")
    
    try:
        api = await get_or_create_api(cookies)
        
        fetch_id = global_id or apple_music_id
        is_library = fetch_id.startswith(("p.", "i.", "l.")) if fetch_id else False
        
        if is_library:
            playlist_data = await api.get_library_playlist(fetch_id)
        else:
            playlist_data = await api.get_playlist(fetch_id)
        
        if not playlist_data:
            return {"error": "Could not fetch playlist"}
        
        if isinstance(playlist_data, dict) and 'data' in playlist_data:
            playlist_data = playlist_data['data'][0] if playlist_data['data'] else None
        
        tracks_data = playlist_data.get("relationships", {}).get("tracks", {}).get("data", [])
        
        tracks = []
        for i, track in enumerate(tracks_data):
            attrs = track.get("attributes", {})
            tracks.append({
                "position": i,
                "appleMusicId": track.get("id"),
                "title": attrs.get("name"),
                "artistName": attrs.get("artistName"),
                "albumName": attrs.get("albumName"),
            })
        
        return {"tracks": tracks, "count": len(tracks)}
        
    except Exception as e:
        return {"error": str(e)}


async def configure_sync_scheduler():
    """Configure the sync scheduler based on database settings."""
    global _scheduler
    import sqlite3
    
    # Wait for server to fully start
    await asyncio.sleep(2)
    
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        db_path = os.path.join(project_root, "library.db")
        
        if not os.path.exists(db_path):
            print("[SYNC SCHEDULER] Database not found, skipping scheduler setup", flush=True)
            return
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT syncEnabled, syncInterval FROM GamdlSettings WHERE id = 'singleton'")
        row = cursor.fetchone()
        conn.close()
        
        if row:
            sync_enabled, sync_interval = row
            if sync_enabled:
                # Remove any existing sync job
                try:
                    _scheduler.remove_job("playlist_sync_job")
                except Exception:
                    pass
                
                # Add new job with configured interval
                _scheduler.add_job(
                    run_sync_check,
                    trigger=IntervalTrigger(minutes=sync_interval),
                    id="playlist_sync_job",
                    replace_existing=True
                )
                print(f"[SYNC SCHEDULER] ✅ Playlist sync enabled (every {sync_interval} min)", flush=True)
            else:
                print("[SYNC SCHEDULER] Sync disabled in settings", flush=True)
        else:
            print("[SYNC SCHEDULER] No settings found", flush=True)
    except Exception as e:
        print(f"[SYNC SCHEDULER] Error configuring scheduler: {e}", flush=True)


async def download_tracks_for_sync(
    track_ids: list[str],
    playlist_id: str,
    cookies: str,
    cursor,
    playlist_name: str = ""
) -> int:
    """Download tracks that are missing from library and add them to playlist.
    
    Returns the number of tracks successfully downloaded and added.
    """
    import uuid
    import tempfile
    from pathlib import Path
    
    if not track_ids:
        return 0
    
    downloaded_count = 0
    
    try:
        # Import gamdl components
        from gamdl.api import AppleMusicApi, ItunesApi
        from gamdl.downloader import (
            AppleMusicDownloader,
            AppleMusicBaseDownloader,
            AppleMusicSongDownloader,
            AppleMusicMusicVideoDownloader,
            AppleMusicUploadedVideoDownloader,
        )
        from gamdl.interface import (
            AppleMusicInterface,
            AppleMusicSongInterface,
            AppleMusicMusicVideoInterface,
            AppleMusicUploadedVideoInterface,
        )
        from gamdl.interface.enums import SongCodec, SyncedLyricsFormat
        from gamdl.downloader.enums import CoverFormat
        
        # Get settings for output path and codec
        cursor.execute("SELECT mediaLibraryPath, songCodec, lyricsFormat FROM GamdlSettings WHERE id = 'singleton'")
        settings_row = cursor.fetchone()
        
        if not settings_row or not settings_row[0]:
            print(f"[SYNC] No output path configured, skipping download", flush=True)
            return 0
        
        output_path = Path(settings_row[0])
        song_codec = settings_row[1] or "aac-legacy"
        lyrics_format = settings_row[2] or "lrc"
        
        # Initialize API
        apple_music_api = await get_or_create_api(cookies)
        if not apple_music_api.active_subscription:
            print(f"[SYNC] No active Apple Music subscription", flush=True)
            return 0
        
        itunes_api = ItunesApi(
            apple_music_api.storefront,
            apple_music_api.language,
        )
        
        # Set up downloaders
        interface = AppleMusicInterface(apple_music_api, itunes_api)
        song_interface = AppleMusicSongInterface(interface)
        
        base_downloader = AppleMusicBaseDownloader(
            wvd_path=str(WVD_PATH) if WVD_PATH.exists() else None,
            output_path=output_path,
            temp_path=Path(tempfile.gettempdir()),
            overwrite=False,
            save_cover=True,
            cover_size=1200,
            cover_format=CoverFormat.JPG,
        )
        
        codec_enum = SongCodec(song_codec)
        lyrics_format_enum = SyncedLyricsFormat(lyrics_format) if lyrics_format != "none" else None
        
        song_downloader = AppleMusicSongDownloader(
            base_downloader=base_downloader,
            interface=song_interface,
            codec=codec_enum,
            synced_lyrics_format=lyrics_format_enum if lyrics_format_enum else SyncedLyricsFormat.LRC,
            no_synced_lyrics=(lyrics_format == "none"),
        )
        
        music_video_interface = AppleMusicMusicVideoInterface(interface)
        uploaded_video_interface = AppleMusicUploadedVideoInterface(interface)
        
        music_video_downloader = AppleMusicMusicVideoDownloader(
            base_downloader=base_downloader,
            interface=music_video_interface,
        )
        
        uploaded_video_downloader = AppleMusicUploadedVideoDownloader(
            base_downloader=base_downloader,
            interface=uploaded_video_interface,
        )
        
        downloader = AppleMusicDownloader(
            interface=interface,
            base_downloader=base_downloader,
            song_downloader=song_downloader,
            music_video_downloader=music_video_downloader,
            uploaded_video_downloader=uploaded_video_downloader,
        )
        
        # Check if wrapper is required for this codec
        use_wrapper = is_wrapper_required(song_codec)
        wrapper_downloader = None
        
        if use_wrapper:
            # Create WrapperSongDownloader for FairPlay-encrypted streams
            wrapper_downloader = WrapperSongDownloader(
                base_downloader=base_downloader,
                interface=song_interface,
                codec=codec_enum,
            )
            
            # Check wrapper availability
            if not wrapper_downloader.is_wrapper_available():
                print(f"[SYNC] ⚠️ Wrapper not available but required for codec '{song_codec}'", flush=True)
                print(f"[SYNC]    Only aac-legacy and aac-he-legacy work without wrapper", flush=True)
                return 0
        
        # Download each missing track
        for track_id in track_ids:
            try:
                # Handle library tracks (IDs starting with i.)
                if track_id.startswith("i."):
                    # Try to download as private/uploaded track first
                    print(f"[SYNC] Processing library track {track_id}", flush=True)
                    
                    # Attempt private track download (unencrypted blobstore)
                    result = await download_private_library_track(
                        api=apple_music_api,
                        library_id=track_id,
                        output_path=output_path
                    )
                    
                    if result:
                        # Private track downloaded successfully
                        final_path = result["file_path"]
                        meta = result["metadata"]
                        
                        # Import to library database
                        # Find or create artist
                        cursor.execute("SELECT id FROM Artist WHERE name = ?", (meta["artist"],))
                        artist_row = cursor.fetchone()
                        if artist_row:
                            artist_id = artist_row[0]
                        else:
                            artist_id = str(uuid.uuid4())
                            cursor.execute("INSERT INTO Artist (id, name) VALUES (?, ?)", (artist_id, meta["artist"]))
                        
                        # Find or create album
                        cursor.execute("SELECT id FROM Album WHERE title = ? AND artistId = ?", (meta["album"], artist_id))
                        album_row = cursor.fetchone()
                        if album_row:
                            album_id = album_row[0]
                        else:
                            album_id = str(uuid.uuid4())
                            cursor.execute(
                                "INSERT INTO Album (id, title, artistId) VALUES (?, ?, ?)",
                                (album_id, meta["album"], artist_id)
                            )
                        
                        # Create track
                        new_track_id = str(uuid.uuid4())
                        cursor.execute(
                            """INSERT INTO Track (id, title, filePath, duration, albumId, appleMusicId, trackNumber, isPrivateLibrary) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (new_track_id, meta["title"], final_path, meta["duration_ms"], album_id, track_id, meta.get("track_number", 1), True)
                        )
                        
                        # Add to playlist
                        cursor.execute("SELECT MAX(position) FROM PlaylistTrack WHERE playlistId = ?", (playlist_id,))
                        max_pos = cursor.fetchone()[0] or 0
                        
                        cursor.execute(
                            "INSERT INTO PlaylistTrack (id, playlistId, trackId, position) VALUES (?, ?, ?, ?)",
                            (str(uuid.uuid4()), playlist_id, new_track_id, max_pos + 1)
                        )
                        
                        downloaded_count += 1
                        print(f"[SYNC] ✅ Downloaded private track '{meta['title']}' to playlist '{playlist_name}'", flush=True)
                        continue
                    else:
                        # Private track download failed, skip
                        print(f"[SYNC] Could not download private library track {track_id}", flush=True)
                        continue
                
                song_url = f"https://music.apple.com/us/song/{track_id}"
                
                url_info = downloader.get_url_info(song_url)
                if not url_info:
                    print(f"[SYNC] Could not parse URL for track {track_id}", flush=True)
                    continue
                
                download_queue = await downloader.get_download_queue(url_info)
                if not download_queue:
                    print(f"[SYNC] No downloadable content for track {track_id}", flush=True)
                    continue
                
                # Download the track
                for item in download_queue:
                    try:
                        # Use wrapper for FairPlay-encrypted codecs, gamdl native for legacy AAC
                        if use_wrapper and wrapper_downloader:
                            final_path = await wrapper_downloader.download(item)
                        else:
                            final_path = await downloader.download(item)
                        
                        if final_path:
                            print(f"[SYNC] Downloaded track to: {final_path}", flush=True)
                            
                            # Import to library using mutagen to get metadata
                            import mutagen
                            from mutagen.mp4 import MP4
                            from mutagen.flac import FLAC
                            
                            audio = mutagen.File(final_path)
                            duration = int(audio.info.length * 1000) if audio and audio.info else 0
                            
                            # Get metadata
                            title = "Unknown"
                            artist_name = "Unknown Artist"
                            album_name = "Unknown Album"
                            
                            if isinstance(audio, MP4):
                                title = audio.tags.get("©nam", [title])[0] if audio.tags else title
                                artist_name = audio.tags.get("©ART", [artist_name])[0] if audio.tags else artist_name
                                album_name = audio.tags.get("©alb", [album_name])[0] if audio.tags else album_name
                            
                            # Find or create artist
                            cursor.execute("SELECT id FROM Artist WHERE name = ?", (artist_name,))
                            artist_row = cursor.fetchone()
                            if artist_row:
                                artist_id = artist_row[0]
                            else:
                                artist_id = str(uuid.uuid4())
                                cursor.execute("INSERT INTO Artist (id, name) VALUES (?, ?)", (artist_id, artist_name))
                            
                            # Find or create album
                            cursor.execute("SELECT id FROM Album WHERE title = ? AND artistId = ?", (album_name, artist_id))
                            album_row = cursor.fetchone()
                            if album_row:
                                album_id = album_row[0]
                            else:
                                album_id = str(uuid.uuid4())
                                cursor.execute(
                                    "INSERT INTO Album (id, title, artistId) VALUES (?, ?, ?)",
                                    (album_id, album_name, artist_id)
                                )
                            
                            # Create track
                            new_track_id = str(uuid.uuid4())
                            cursor.execute(
                                """INSERT INTO Track (id, title, filePath, duration, albumId, appleMusicId, trackNumber) 
                                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                                (new_track_id, title, str(final_path), duration, album_id, track_id, 1)
                            )
                            
                            # Add to playlist
                            cursor.execute("SELECT MAX(position) FROM PlaylistTrack WHERE playlistId = ?", (playlist_id,))
                            max_pos = cursor.fetchone()[0] or 0
                            
                            cursor.execute(
                                "INSERT INTO PlaylistTrack (id, playlistId, trackId, position) VALUES (?, ?, ?, ?)",
                                (str(uuid.uuid4()), playlist_id, new_track_id, max_pos + 1)
                            )
                            
                            downloaded_count += 1
                            print(f"[SYNC] ✅ Added '{title}' to playlist '{playlist_name}'", flush=True)
                            
                    except Exception as item_err:
                        error_msg = str(item_err)
                        # Handle "file already exists" - the track is on disk but maybe not in DB with this ID
                        if "already exists at path:" in error_msg:
                            # Extract path from error message
                            try:
                                existing_path = error_msg.split("already exists at path:")[1].strip()
                                print(f"[SYNC] Track already exists at: {existing_path}", flush=True)
                                
                                # Find track in our library by file path
                                cursor.execute("SELECT id FROM Track WHERE filePath = ?", (existing_path,))
                                existing_track = cursor.fetchone()
                                
                                if existing_track:
                                    # Track found in library! Add to playlist
                                    existing_track_id = existing_track[0]
                                    
                                    # Check if already in this playlist
                                    cursor.execute(
                                        "SELECT id FROM PlaylistTrack WHERE playlistId = ? AND trackId = ?",
                                        (playlist_id, existing_track_id)
                                    )
                                    if not cursor.fetchone():
                                        # Add to playlist
                                        cursor.execute("SELECT MAX(position) FROM PlaylistTrack WHERE playlistId = ?", (playlist_id,))
                                        max_pos = cursor.fetchone()[0] or 0
                                        
                                        cursor.execute(
                                            "INSERT INTO PlaylistTrack (id, playlistId, trackId, position) VALUES (?, ?, ?, ?)",
                                            (str(uuid.uuid4()), playlist_id, existing_track_id, max_pos + 1)
                                        )
                                        
                                        # Also update the track's appleMusicId if it's different
                                        cursor.execute(
                                            "UPDATE Track SET appleMusicId = ? WHERE id = ? AND (appleMusicId IS NULL OR appleMusicId != ?)",
                                            (track_id, existing_track_id, track_id)
                                        )
                                        
                                        downloaded_count += 1
                                        print(f"[SYNC] ✅ Added existing track to playlist '{playlist_name}'", flush=True)
                                    else:
                                        print(f"[SYNC] Track already in playlist", flush=True)
                                else:
                                    print(f"[SYNC] Track file exists but not in library DB", flush=True)
                            except Exception as parse_err:
                                print(f"[SYNC] Could not parse existing path: {parse_err}", flush=True)
                        else:
                            print(f"[SYNC] Error downloading item: {item_err}", flush=True)
                        
            except Exception as track_err:
                print(f"[SYNC] Error downloading track {track_id}: {track_err}", flush=True)
                
    except ImportError as e:
        print(f"[SYNC] gamdl import error: {e}", flush=True)
    except Exception as e:
        print(f"[SYNC] Download error: {e}", flush=True)
        import traceback
        traceback.print_exc()
    
    return downloaded_count


async def download_missing_codecs_for_sync(
    missing_tracks: list[tuple[str, list[str]]],  # [(apple_music_id, [missing_codecs]), ...]
    selected_codecs: str,
    cookies: str,
    cursor
) -> int:
    """Download specific missing codecs for tracks already in library.
    
    Returns the number of codec files successfully downloaded.
    """
    import tempfile
    from pathlib import Path
    
    if not missing_tracks:
        return 0
    
    downloaded_count = 0
    
    try:
        from gamdl.api import AppleMusicApi, ItunesApi
        from gamdl.downloader import (
            AppleMusicDownloader,
            AppleMusicBaseDownloader,
            AppleMusicSongDownloader,
            AppleMusicMusicVideoDownloader,
            AppleMusicUploadedVideoDownloader,
        )
        from gamdl.interface import (
            AppleMusicInterface,
            AppleMusicSongInterface,
            AppleMusicMusicVideoInterface,
            AppleMusicUploadedVideoInterface,
        )
        from gamdl.interface.enums import SongCodec, SyncedLyricsFormat
        from gamdl.downloader.enums import CoverFormat
        
        # Get settings for output path
        cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
        settings_row = cursor.fetchone()
        
        if not settings_row or not settings_row[0]:
            print(f"[SYNC CODEC] No output path configured", flush=True)
            return 0
        
        output_path = Path(settings_row[0])
        
        apple_music_api = await get_or_create_api(cookies)
        if not apple_music_api.active_subscription:
            print(f"[SYNC CODEC] No active Apple Music subscription", flush=True)
            return 0
        
        itunes_api = ItunesApi(
            apple_music_api.storefront,
            apple_music_api.language,
        )
        
        # Set up base interface and downloader
        interface = AppleMusicInterface(apple_music_api, itunes_api)
        song_interface = AppleMusicSongInterface(interface)
        
        base_downloader = AppleMusicBaseDownloader(
            wvd_path=str(WVD_PATH) if WVD_PATH.exists() else None,
            output_path=output_path,
            temp_path=Path(tempfile.gettempdir()),
            overwrite=True,  # Allow overwrite since we only download codecs missing from DB
            save_cover=True,
            cover_size=1200,
            cover_format=CoverFormat.JPG,
        )
        
        # Create video interfaces (required by AppleMusicDownloader)
        music_video_interface = AppleMusicMusicVideoInterface(interface)
        uploaded_video_interface = AppleMusicUploadedVideoInterface(interface)
        
        music_video_downloader = AppleMusicMusicVideoDownloader(
            base_downloader=base_downloader,
            interface=music_video_interface,
        )
        
        uploaded_video_downloader = AppleMusicUploadedVideoDownloader(
            base_downloader=base_downloader,
            interface=uploaded_video_interface,
        )
        
        for apple_id, missing_codecs in missing_tracks:
            try:
                # Build song URL
                song_url = f"https://music.apple.com/us/song/{apple_id}"
                
                # Process each missing codec
                for codec_str in missing_codecs:
                    try:
                        # Convert codec string to enum
                        codec_key = codec_str.replace('-', '_').upper()
                        if not hasattr(SongCodec, codec_key):
                            print(f"[SYNC CODEC] Unknown codec: {codec_str}", flush=True)
                            continue
                        
                        codec_enum = SongCodec[codec_key]
                        
                        # Check if wrapper is needed for this codec
                        use_wrapper = is_wrapper_required(codec_str)
                        
                        # Create song downloader for this specific codec
                        song_downloader = AppleMusicSongDownloader(
                            base_downloader=base_downloader,
                            interface=song_interface,
                            codec=codec_enum,
                            synced_lyrics_format=SyncedLyricsFormat.LRC,
                            no_synced_lyrics=True,  # Skip lyrics for codec-only download
                        )
                        
                        # Build full downloader
                        downloader = AppleMusicDownloader(
                            interface=interface,
                            base_downloader=base_downloader,
                            song_downloader=song_downloader,
                            music_video_downloader=music_video_downloader,
                            uploaded_video_downloader=uploaded_video_downloader,
                        )
                        
                        # Parse URL and get download queue
                        url_info = downloader.get_url_info(song_url)
                        if not url_info:
                            print(f"[SYNC CODEC] Could not parse URL for {apple_id}", flush=True)
                            continue
                        
                        download_queue = await downloader.get_download_queue(url_info)
                        if not download_queue:
                            print(f"[SYNC CODEC] No downloadable content for {apple_id}", flush=True)
                            continue
                        
                        # Download the track with this codec
                        for download_item in download_queue:
                            try:
                                # Check wrapper availability if needed
                                if use_wrapper:
                                    wrapper_dlr = WrapperSongDownloader(
                                        base_downloader=base_downloader,
                                        interface=song_interface,
                                        codec=codec_enum,
                                    )
                                    if not wrapper_dlr.is_wrapper_available():
                                        print(f"[SYNC CODEC] Wrapper not available for {codec_str}, skipping", flush=True)
                                        break
                                    final_path = await wrapper_dlr.download(download_item)
                                else:
                                    final_path = await downloader.download(download_item)
                                
                                if final_path:
                                    print(f"[SYNC CODEC] ✅ Downloaded {codec_str} for track {apple_id}", flush=True)
                                    
                                    # Update track's codecPaths in database
                                    cursor.execute("SELECT codecPaths FROM Track WHERE appleMusicId = ?", (apple_id,))
                                    row = cursor.fetchone()
                                    existing_paths = {}
                                    if row and row[0]:
                                        try:
                                            existing_paths = json.loads(row[0])
                                        except:
                                            pass
                                    
                                    existing_paths[codec_str] = str(final_path)
                                    
                                    cursor.execute(
                                        "UPDATE Track SET codecPaths = ? WHERE appleMusicId = ?",
                                        (json.dumps(existing_paths), apple_id)
                                    )
                                    cursor.connection.commit()
                                    downloaded_count += 1
                                    break  # Only need one download_item per codec
                            except Exception as dl_err:
                                print(f"[SYNC CODEC] Download error for {apple_id} ({codec_str}): {dl_err}", flush=True)
                    except Exception as codec_err:
                        print(f"[SYNC CODEC] Error downloading {codec_str} for {apple_id}: {codec_err}", flush=True)
            except Exception as track_err:
                print(f"[SYNC CODEC] Error processing track {apple_id}: {track_err}", flush=True)
    
    except Exception as e:
        print(f"[SYNC CODEC] Download error: {e}", flush=True)
        import traceback
        traceback.print_exc()
    
    return downloaded_count


async def run_sync_check():
    """Background task to check all synced playlists for updates."""
    import sqlite3
    
    print("[SYNC CHECK] Starting scheduled sync check...", flush=True)
    
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        db_path = os.path.join(project_root, "library.db")
        
        if not os.path.exists(db_path):
            return
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get cookies and settings
        cursor.execute("SELECT cookies, syncEnabled, autoSyncOnChange FROM GamdlSettings WHERE id = 'singleton'")
        settings = cursor.fetchone()
        
        if not settings or not settings[0] or not settings[1]:
            conn.close()
            print("[SYNC CHECK] Sync disabled or no cookies", flush=True)
            return
        
        cookies, _, auto_sync = settings
        
        # Get all synced playlists with their local track count and selectedCodecs
        cursor.execute("""
            SELECT p.id, p.name, p.appleMusicId, p.appleLastModifiedDate, 
                   (SELECT COUNT(*) FROM PlaylistTrack pt WHERE pt.playlistId = p.id) as trackCount,
                   p.selectedCodecs
            FROM Playlist p 
            WHERE p.isSynced = 1 AND p.appleMusicId IS NOT NULL
        """)
        playlists = cursor.fetchall()
        
        # Update lastSyncCheck timestamp
        cursor.execute("UPDATE GamdlSettings SET lastSyncCheck = ? WHERE id = 'singleton'", (datetime.now().isoformat(),))
        conn.commit()
        # Don't close - we need connection for the rest of sync check
        
        if not playlists:
            print("[SYNC CHECK] No synced playlists to check", flush=True)
            conn.close()
            return
        
        print(f"[SYNC CHECK] Checking {len(playlists)} synced playlists...", flush=True)
        
        # Get local track IDs and codecPaths for all playlists in one query for efficiency
        cursor.execute("""
            SELECT pt.playlistId, t.appleMusicId, pt.position, t.codecPaths
            FROM PlaylistTrack pt 
            JOIN Track t ON pt.trackId = t.id 
            WHERE pt.playlistId IN (SELECT id FROM Playlist WHERE isSynced = 1)
            ORDER BY pt.playlistId, pt.position
        """)
        local_tracks_all = cursor.fetchall()
        
        # Group by playlist - now includes codecPaths
        local_playlist_tracks = {}
        for playlist_id, apple_id, position, codec_paths in local_tracks_all:
            if playlist_id not in local_playlist_tracks:
                local_playlist_tracks[playlist_id] = []
            local_playlist_tracks[playlist_id].append((apple_id, position, codec_paths))
        
        # Also fetch local playlist name, description, and artwork URL
        cursor.execute("SELECT id, name, description, artworkUrl FROM Playlist WHERE isSynced = 1")
        local_metadata = {row[0]: (row[1], row[2], row[3]) for row in cursor.fetchall()}
        
        # Don't close connection yet - we may need it for auto_sync
        
        needs_sync = []
        sync_reasons = {}  # Track why each playlist needs sync
        
        for playlist_id, name, apple_music_id, local_modified, local_track_count, selected_codecs in playlists:
            try:
                apple_music_api = await get_or_create_api(cookies)
                
                is_library = apple_music_id.startswith(("p.", "i.", "l."))
                if is_library:
                    playlist_data = await apple_music_api.get_library_playlist(apple_music_id)
                else:
                    playlist_data = await apple_music_api.get_playlist(apple_music_id)
                
                if not playlist_data:
                    continue
                
                if isinstance(playlist_data, dict) and 'data' in playlist_data:
                    data_list = playlist_data.get('data', [])
                    if data_list:
                        playlist_data = data_list[0]
                
                attrs = playlist_data.get("attributes", {}) if isinstance(playlist_data, dict) else {}
                rels = playlist_data.get("relationships", {}) if isinstance(playlist_data, dict) else {}
                
                # Get remote track IDs in order
                tracks_data = rels.get("tracks", {}).get("data", [])
                remote_track_ids = [t.get("id") for t in tracks_data if t.get("id")]
                
                # Get local track IDs, positions, and codecPaths
                local_tracks = local_playlist_tracks.get(playlist_id, [])
                local_track_ids = [t[0] for t in sorted(local_tracks, key=lambda x: x[1]) if t[0]]
                
                # Build a map of apple_id -> codecPaths for missing codec detection
                local_codec_map = {}
                for apple_id, pos, codec_paths in local_tracks:
                    if apple_id:
                        try:
                            local_codec_map[apple_id] = json.loads(codec_paths) if codec_paths else {}
                        except:
                            local_codec_map[apple_id] = {}
                
                # Check how many remote tracks exist in our library at all
                library_track_ids = set()
                if remote_track_ids:
                    cursor.execute(
                        "SELECT appleMusicId FROM Track WHERE appleMusicId IN ({})".format(
                            ','.join('?' * len(remote_track_ids))
                        ),
                        remote_track_ids
                    )
                    library_track_ids = set(row[0] for row in cursor.fetchall())
                
                # Filter remote tracks to only those in library - these are the ones we can sync
                syncable_remote_ids = [t for t in remote_track_ids if t in library_track_ids]
                pending_download_ids = [t for t in remote_track_ids if t not in library_track_ids]
                
                # Check for missing codecs on existing tracks
                missing_codec_tracks = []
                wanted_codecs = set(selected_codecs.split(',')) if selected_codecs else set()
                if wanted_codecs:
                    for apple_id in syncable_remote_ids:
                        existing_codecs = set(local_codec_map.get(apple_id, {}).keys())
                        missing = wanted_codecs - existing_codecs
                        if missing:
                            missing_codec_tracks.append((apple_id, list(missing)))
                
                # Debug: show comparison
                print(f"[SYNC DEBUG] '{name}': remote={len(remote_track_ids)}, in library={len(syncable_remote_ids)}, in playlist={len(local_track_ids)}, pending_dl={len(pending_download_ids)}, missing_codecs={len(missing_codec_tracks)}", flush=True)
                
                # Log the actual IDs to diagnose mismatches
                if pending_download_ids:
                    print(f"[SYNC DEBUG] '{name}' pending_download IDs: {pending_download_ids}", flush=True)
                    print(f"[SYNC DEBUG] '{name}' remote IDs: {remote_track_ids}", flush=True)
                    print(f"[SYNC DEBUG] '{name}' library matched IDs: {list(library_track_ids)}", flush=True)
                
                if missing_codec_tracks:
                    print(f"[SYNC DEBUG] '{name}' tracks need additional codecs: {len(missing_codec_tracks)}", flush=True)
                
                if syncable_remote_ids != local_track_ids:
                    print(f"[SYNC DEBUG] '{name}' syncable_remote: {syncable_remote_ids[:3]}...", flush=True)
                    print(f"[SYNC DEBUG] '{name}' local_playlist: {local_track_ids[:3]}...", flush=True)
                
                # IMPORTANT: Also trigger sync if there are pending downloads or missing codecs!
                has_pending_downloads = len(pending_download_ids) > 0
                has_missing_codecs = len(missing_codec_tracks) > 0

                
                # Compare only syncable tracks vs local tracks
                tracks_differ = syncable_remote_ids != local_track_ids or has_pending_downloads
                
                # Compare name and description
                remote_name = attrs.get("name", "")
                remote_desc = attrs.get("description", {})
                if isinstance(remote_desc, dict):
                    remote_desc = remote_desc.get("standard", "")
                
                # Get remote artwork URL
                artwork = attrs.get("artwork", {})
                remote_artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else ""
                
                local_name, local_desc, local_artwork_url = local_metadata.get(playlist_id, ("", "", ""))
                name_differs = remote_name != local_name
                desc_differs = (remote_desc or "") != (local_desc or "")
                artwork_differs = (remote_artwork_url or "") != (local_artwork_url or "")
                
                reasons = []
                if tracks_differ:
                    if len(syncable_remote_ids) != len(local_track_ids):
                        reasons.append(f"track count ({len(syncable_remote_ids)} vs {len(local_track_ids)})")
                    else:
                        reasons.append("track order/content")
                if name_differs:
                    reasons.append(f"name ('{remote_name}' vs '{local_name}')")
                if desc_differs:
                    reasons.append("description")
                if artwork_differs:
                    reasons.append("artwork")
                if has_missing_codecs:
                    reasons.append(f"missing codecs ({len(missing_codec_tracks)} tracks)")
                
                if reasons:
                    print(f"[SYNC DEBUG] '{name}' needs sync: {', '.join(reasons)}", flush=True)
                    needs_sync.append((playlist_id, name, apple_music_id))
                    sync_reasons[playlist_id] = {
                        "tracks_differ": tracks_differ,
                        "name_differs": name_differs,
                        "desc_differs": desc_differs,
                        "artwork_differs": artwork_differs,
                        "remote_name": remote_name,
                        "remote_desc": remote_desc,
                        "remote_artwork_url": remote_artwork_url,
                        "missing_codec_tracks": missing_codec_tracks,
                        "selected_codecs": selected_codecs
                    }
                else:
                    print(f"[SYNC DEBUG] '{name}' up to date", flush=True)
                    
            except Exception as e:
                print(f"[SYNC CHECK] Error checking playlist {name}: {e}", flush=True)
        
        if needs_sync:
            print(f"[SYNC CHECK] ⚠️ {len(needs_sync)} playlists need sync: {[n for _, n, _ in needs_sync]}", flush=True)
            
            if auto_sync:
                print("[SYNC CHECK] Auto-sync enabled, triggering sync...", flush=True)
                
                try:
                    script_dir = os.path.dirname(os.path.abspath(__file__))
                    project_root = os.path.dirname(script_dir)
                    db_path = os.path.join(project_root, "library.db")
                    
                    conn = sqlite3.connect(db_path)
                    cursor = conn.cursor()
                    
                    for playlist_id, name, apple_music_id in needs_sync:
                        try:
                            apple_music_api = await get_or_create_api(cookies)
                            is_library = apple_music_id.startswith(("p.", "i.", "l."))
                            if is_library:
                                playlist_data = await apple_music_api.get_library_playlist(apple_music_id)
                            else:
                                playlist_data = await apple_music_api.get_playlist(apple_music_id)
                            
                            if not playlist_data:
                                print(f"[SYNC CHECK] Could not fetch '{name}' from Apple Music", flush=True)
                                continue
                            
                            if isinstance(playlist_data, dict) and 'data' in playlist_data:
                                data_list = playlist_data.get('data', [])
                                if data_list:
                                    playlist_data = data_list[0]
                            
                            attrs = playlist_data.get("attributes", {}) if isinstance(playlist_data, dict) else {}
                            rels = playlist_data.get("relationships", {}) if isinstance(playlist_data, dict) else {}
                            
                            # Get remote tracks with their Apple Music IDs
                            remote_tracks = rels.get("tracks", {}).get("data", [])
                            remote_track_ids = set()
                            for track in remote_tracks:
                                track_id = track.get("id")
                                if track_id:
                                    remote_track_ids.add(track_id)
                            
                            # Get local tracks with their Apple Music IDs
                            cursor.execute("""
                                SELECT pt.id, t.appleMusicId, pt.position 
                                FROM PlaylistTrack pt 
                                JOIN Track t ON pt.trackId = t.id 
                                WHERE pt.playlistId = ?
                            """, (playlist_id,))
                            local_tracks = cursor.fetchall()
                            local_track_map = {row[1]: row[0] for row in local_tracks if row[1]}  # appleMusicId -> playlistTrack.id
                            local_track_ids = set(local_track_map.keys())
                            
                            # Find tracks to remove (in local but not in remote)
                            tracks_to_remove = local_track_ids - remote_track_ids
                            
                            # Find tracks to add (in remote but not in local)
                            tracks_to_add = remote_track_ids - local_track_ids
                            
                            removed_count = 0
                            if tracks_to_remove:
                                for track_id in tracks_to_remove:
                                    pt_id = local_track_map.get(track_id)
                                    if pt_id:
                                        cursor.execute("DELETE FROM PlaylistTrack WHERE id = ?", (pt_id,))
                                        removed_count += 1
                                print(f"[SYNC CHECK] Removed {removed_count} tracks from '{name}'", flush=True)
                            
                            added_count = 0
                            if tracks_to_add:
                                # For tracks we need to add, check if they exist in library
                                for remote_track in remote_tracks:
                                    track_id = remote_track.get("id")
                                    if track_id in tracks_to_add:
                                        # Check if this track exists in our library
                                        cursor.execute("SELECT id FROM Track WHERE appleMusicId = ?", (track_id,))
                                        existing = cursor.fetchone()
                                        if existing:
                                            # Get max position
                                            cursor.execute("SELECT MAX(position) FROM PlaylistTrack WHERE playlistId = ?", (playlist_id,))
                                            max_pos = cursor.fetchone()[0] or 0
                                            # Add to playlist
                                            import uuid
                                            cursor.execute(
                                                "INSERT INTO PlaylistTrack (id, playlistId, trackId, position) VALUES (?, ?, ?, ?)",
                                                (str(uuid.uuid4()), playlist_id, existing[0], max_pos + 1)
                                            )
                                            added_count += 1
                                if added_count > 0:
                                    print(f"[SYNC CHECK] Added {added_count} tracks to '{name}' (from library)", flush=True)
                                
                                # Download tracks that aren't in the library yet
                                tracks_needing_download = list(tracks_to_add - set(
                                    t.get("id") for t in remote_tracks 
                                    if cursor.execute("SELECT id FROM Track WHERE appleMusicId = ?", (t.get("id"),)).fetchone()
                                ))
                                
                                if tracks_needing_download:
                                    print(f"[SYNC CHECK] Downloading {len(tracks_needing_download)} missing tracks for '{name}'...", flush=True)
                                    downloaded = await download_tracks_for_sync(
                                        track_ids=tracks_needing_download,
                                        playlist_id=playlist_id,
                                        cookies=cookies,
                                        cursor=cursor,
                                        playlist_name=name
                                    )
                                    if downloaded > 0:
                                        added_count += downloaded
                                        print(f"[SYNC CHECK] ✅ Downloaded and added {downloaded} tracks", flush=True)
                            
                            # Download missing codecs for existing tracks
                            reason_data = sync_reasons.get(playlist_id, {})
                            missing_codec_tracks = reason_data.get("missing_codec_tracks", [])
                            selected_codecs = reason_data.get("selected_codecs", "")
                            
                            if missing_codec_tracks and selected_codecs:
                                print(f"[SYNC CHECK] Downloading missing codecs for {len(missing_codec_tracks)} tracks in '{name}'...", flush=True)
                                codec_downloaded = await download_missing_codecs_for_sync(
                                    missing_tracks=missing_codec_tracks,
                                    selected_codecs=selected_codecs,
                                    cookies=cookies,
                                    cursor=cursor
                                )
                                if codec_downloaded > 0:
                                    print(f"[SYNC CHECK] ✅ Downloaded {codec_downloaded} missing codec files", flush=True)
                            
                            # Update track positions to match remote order
                            cursor.execute("""
                                SELECT pt.id, t.appleMusicId 
                                FROM PlaylistTrack pt 
                                JOIN Track t ON pt.trackId = t.id 
                                WHERE pt.playlistId = ?
                            """, (playlist_id,))
                            current_tracks = cursor.fetchall()
                            local_id_to_pt_id = {row[1]: row[0] for row in current_tracks if row[1]}
                            
                            # Build position map from remote order
                            for new_pos, remote_track in enumerate(remote_tracks):
                                remote_id = remote_track.get("id")
                                if remote_id in local_id_to_pt_id:
                                    pt_id = local_id_to_pt_id[remote_id]
                                    cursor.execute("UPDATE PlaylistTrack SET position = ? WHERE id = ?", (new_pos, pt_id))
                            
                            # Update playlist name and description if changed
                            reason_data = sync_reasons.get(playlist_id, {})
                            remote_name = reason_data.get("remote_name") or attrs.get("name")
                            remote_desc = reason_data.get("remote_desc")
                            if remote_desc is None:
                                remote_desc = attrs.get("description", {})
                                if isinstance(remote_desc, dict):
                                    remote_desc = remote_desc.get("standard", "")
                            
                            if reason_data.get("name_differs") or reason_data.get("desc_differs") or reason_data.get("artwork_differs"):
                                remote_artwork = reason_data.get("remote_artwork_url") or ""
                                cursor.execute(
                                    "UPDATE Playlist SET name = ?, description = ?, artworkUrl = ? WHERE id = ?",
                                    (remote_name, remote_desc or "", remote_artwork, playlist_id)
                                )
                                if reason_data.get("name_differs"):
                                    print(f"[SYNC CHECK] Updated playlist name to '{remote_name}'", flush=True)
                                if reason_data.get("desc_differs"):
                                    print(f"[SYNC CHECK] Updated playlist description", flush=True)
                                if reason_data.get("artwork_differs"):
                                    print(f"[SYNC CHECK] Updated playlist artwork", flush=True)
                            
                            # Update lastModifiedDate
                            apple_last_modified = attrs.get("lastModifiedDate") or datetime.now().isoformat()
                            cursor.execute(
                                "UPDATE Playlist SET appleLastModifiedDate = ?, lastSyncedAt = ? WHERE id = ?",
                                (apple_last_modified, datetime.now().isoformat(), playlist_id)
                            )
                            
                            print(f"[SYNC CHECK] ✅ Synced '{remote_name or name}': -{removed_count} tracks, +{added_count} tracks", flush=True)
                            
                        except Exception as e:
                            print(f"[SYNC CHECK] Error syncing playlist '{name}': {e}", flush=True)
                            traceback.print_exc()
                    
                    conn.commit()
                    conn.close()
                    print(f"[SYNC CHECK] ✅ Sync complete for {len(needs_sync)} playlist(s)", flush=True)
                except Exception as e:
                    print(f"[SYNC CHECK] Error during sync update: {e}", flush=True)
                    traceback.print_exc()
            else:
                print("[SYNC CHECK] Auto-sync disabled, changes detected but not syncing", flush=True)
                conn.close()
        else:
            print("[SYNC CHECK] ✅ All playlists are up to date", flush=True)
            conn.close()
            
    except Exception as e:
        print(f"[SYNC CHECK] Error during sync check: {e}", flush=True)
        traceback.print_exc()


async def prewarm_api():
    """Pre-warm the AppleMusicApi by fetching cookies from the database and initializing."""
    import sqlite3
    import os
    
    # Wait a moment for server to fully start
    await asyncio.sleep(1)
    
    try:
        # Try to find the database path (it's at project root, not in prisma folder)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        db_path = os.path.join(project_root, "library.db")
        
        print(f"[PREWARM] Looking for database at: {db_path}", flush=True)
        
        if not os.path.exists(db_path):
            print("[PREWARM] Database not found, skipping API pre-warm", flush=True)
            return
        
        # Read cookies from database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT cookies FROM GamdlSettings WHERE id = 'singleton'")
        row = cursor.fetchone()
        conn.close()
        
        if row and row[0]:
            cookies = row[0]
            print("[PREWARM] Found cookies, initializing AppleMusicApi...", flush=True)
            
            # Also fetch the library path for wrapper initialization
            cursor2 = conn = sqlite3.connect(db_path)
            cursor2 = conn.cursor()
            cursor2.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
            lib_row = cursor2.fetchone()
            conn.close()
            library_root = Path(lib_row[0]) if lib_row and lib_row[0] else Path("./music")
            
            # Retry logic for timeout errors
            max_retries = 3
            api = None
            for attempt in range(max_retries):
                try:
                    api = await get_or_create_api(cookies)
                    print("[PREWARM] ✅ AppleMusicApi pre-warmed successfully!", flush=True)
                    break
                except Exception as init_error:
                    error_str = str(init_error).lower()
                    if "timeout" in error_str or "readtimeout" in error_str:
                        if attempt < max_retries - 1:
                            wait_time = (attempt + 1) * 5  # 5s, 10s, 15s
                            print(f"[PREWARM] Timeout on attempt {attempt + 1}, retrying in {wait_time}s...", flush=True)
                            await asyncio.sleep(wait_time)
                        else:
                            print("[PREWARM] ⚠️ All retries failed. API will initialize on first request.", flush=True)
                    else:
                        print(f"[PREWARM] ⚠️ Non-timeout error: {init_error}", flush=True)
                        break
            
            # Try to start wrapper after API is ready
            if api:
                await start_wrapper_if_available(api, library_root)
        else:
            print("[PREWARM] No cookies configured, skipping API pre-warm", flush=True)
    except Exception as e:
        print(f"[PREWARM] ⚠️ Pre-warm failed (non-critical): {e}", flush=True)


async def start_wrapper_if_available(api, library_root: Path):
    """
    Start the wrapper Docker container.
    
    The wrapper uses saved session from previous login, or starts in
    headless mode for web-based authentication. No token extraction needed.
    
    ALAC/Atmos downloads require the wrapper. AAC-legacy works without it.
    
    Args:
        api: The AppleMusicApi instance
        library_root: Path to the media library (from database mediaLibraryPath setting)
    """
    from wrapper_manager import get_wrapper_manager, check_wrapper_available, init_wrapper_manager
    
    try:
        # Initialize wrapper manager with library root path
        init_wrapper_manager(library_root)
        
        # Check if Docker and wrapper image are available
        available, message = check_wrapper_available()
        if not available:
            print(f"[WRAPPER] ⚠️ {message}", flush=True)
            print("[WRAPPER]    Only AAC-legacy and HE-AAC-legacy downloads available", flush=True)
            return False
        
        print("[WRAPPER] Docker and wrapper image found ✓", flush=True)
        
        wrapper_manager = get_wrapper_manager()
        
        # Check if we have a saved session
        if wrapper_manager.has_saved_session():
            print("[WRAPPER] Found saved session, starting wrapper...", flush=True)
        else:
            print("[WRAPPER] No saved session - web login required", flush=True)
            print("[WRAPPER] Starting in headless mode for web-based authentication", flush=True)
        
        # Start wrapper (uses saved session or headless mode)
        success = wrapper_manager.start()
        
        if success:
            # Wait for wrapper to be ready
            if await wrapper_manager.wait_ready(timeout=30.0):
                print("[WRAPPER] ✅ Wrapper ready for ALAC/Atmos downloads", flush=True)
                return True
            else:
                print("[WRAPPER] ⚠️ Wrapper started but not responding", flush=True)
                logs = wrapper_manager.get_container_logs(lines=20)
                if logs:
                    print(f"[WRAPPER] Logs:\n{logs}", flush=True)
                return False
        else:
            print("[WRAPPER] ⚠️ Failed to start wrapper container", flush=True)
            return False
            
    except Exception as e:
        print(f"[WRAPPER] ⚠️ Wrapper startup failed: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return False



app = FastAPI(
    title="gamdl Service",
    description="Apple Music download service powered by gamdl",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic Models ---


class HealthResponse(BaseModel):
    status: str
    gamdl_version: str
    python_version: str


class ValidateUrlRequest(BaseModel):
    url: str
    cookies: Optional[str] = None


class ValidateUrlResponse(BaseModel):
    valid: bool
    type: str  # song, album, playlist, artist
    title: str
    artist: Optional[str] = None
    artwork_url: Optional[str] = None
    track_count: Optional[int] = None
    apple_music_id: Optional[str] = None
    global_id: Optional[str] = None  # For playlist sync (pl.u-xxx)
    description: Optional[str] = None  # Playlist/album description
    extracted_url: Optional[str] = None  # Clean URL extracted from input
    available_codecs: Optional[list] = None  # List of available audio codecs for songs
    downloaded_codecs: Optional[list] = None  # Codecs already downloaded for this track
    error: Optional[str] = None


class ValidateBatchRequest(BaseModel):
    text: str  # Text that may contain multiple URLs
    cookies: Optional[str] = None


class ValidateBatchResponse(BaseModel):
    items: list[ValidateUrlResponse]
    total_found: int


class DownloadRequest(BaseModel):
    url: str
    cookies: str
    output_path: str = "./music"
    song_codecs: str = "aac-legacy"  # Comma-separated list of codecs
    lyrics_format: str = "lrc"
    cover_size: int = 1200
    save_cover: bool = True
    language: str = "en-US"
    overwrite: bool = False
    # Multi-language lyrics settings
    lyrics_translation_langs: str = ""  # Comma-separated language codes
    lyrics_pronunciation_langs: str = ""  # Comma-separated script codes


class DownloadStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    current_track: int
    total_tracks: int


# --- Helper Functions ---


def get_gamdl_version() -> str:
    """Get the installed gamdl version."""
    try:
        import gamdl
        return getattr(gamdl, "__version__", "unknown")
    except ImportError:
        return "not installed"


def parse_apple_music_url(url: str) -> dict:
    """Parse an Apple Music URL to extract type and ID."""
    import re
    
    # Public catalog URL patterns - capture the full URL match
    patterns = [
        # Song from album: /us/album/song-name/123456?i=789
        ("song", r"(https?://music\.apple\.com/\w+/album/[^/]+/(\d+)\?i=(\d+))"),
        # Direct song: /us/song/song-name/123456
        ("song", r"(https?://music\.apple\.com/\w+/song/[^/]+/(\d+))"),
        # Album: /us/album/album-name/123456
        ("album", r"(https?://music\.apple\.com/\w+/album/[^/]+/(\d+))(?!\?i=)"),
        # Playlist: /us/playlist/name/pl.xxx (include hyphens in ID)
        ("playlist", r"(https?://music\.apple\.com/\w+/playlist/[^/]+/(pl\.[a-zA-Z0-9-]+))"),
        # Artist: /us/artist/name/123456
        ("artist", r"(https?://music\.apple\.com/\w+/artist/[^/]+/(\d+))"),
        # Library album: /library/albums/l.xxx (include hyphens)
        ("album", r"(https?://music\.apple\.com/library/albums/(l\.[a-zA-Z0-9-]+))"),
        # Library playlist: /library/playlist/p.xxx (include hyphens)
        ("playlist", r"(https?://music\.apple\.com/library/playlist/(p\.[a-zA-Z0-9-]+))"),
        # Library song (if any pattern exists)
        ("song", r"(https?://music\.apple\.com/library/songs/(i\.[a-zA-Z0-9-]+))"),
    ]
    
    for url_type, pattern in patterns:
        match = re.search(pattern, url)
        if match:
            full_url = match.group(1)  # First group is always the full URL
            if url_type == "song" and len(match.groups()) == 3:
                return {"type": url_type, "album_id": match.group(2), "track_id": match.group(3), "extracted_url": full_url}
            return {"type": url_type, "id": match.group(2), "extracted_url": full_url}
    
    return {"type": "unknown", "id": None, "extracted_url": None}


def find_all_apple_music_urls(text: str) -> list[dict]:
    """Find ALL valid Apple Music URLs in a text and return parsed info for each."""
    import re
    
    # Find all potential Apple Music URLs in the text
    url_pattern = r"https?://music\.apple\.com/[^\s<>\"']*"
    potential_urls = re.findall(url_pattern, text)
    
    # Parse each and filter valid ones
    results = []
    seen_ids = set()  # Avoid duplicates
    
    for url in potential_urls:
        parsed = parse_apple_music_url(url)
        if parsed["type"] != "unknown":
            # Create a unique key for deduplication
            unique_key = f"{parsed['type']}:{parsed.get('id') or parsed.get('track_id')}"
            if unique_key not in seen_ids:
                seen_ids.add(unique_key)
                results.append(parsed)
    
    return results


def parse_webplayback_codecs(webplayback_data: dict, song_attributes: dict = None) -> list:
    """Parse webplayback response and song attributes to extract available codec identifiers.
    
    Webplayback provides AAC flavors, while song attributes' audioTraits indicates
    availability of lossless, atmos, and spatial audio.
    
    audioTraits values: 'lossless', 'hi-res-lossless', 'atmos', 'spatial', 'lossy-stereo'
    """
    FLAVOR_TO_CODEC = {
        'cbcp256': 'aac-legacy',
        'cbcp64': 'aac-he-legacy',
        'ctrp256': 'aac',
        'ctrp64': 'aac-he',
        'ibhp256': 'aac-binaural',
        'ibhp64': 'aac-he-binaural',
        'aac256': 'aac-legacy',
        'aac64': 'aac-he-legacy',
        # Downmix variants
        'dbhp256': 'aac-downmix',
        'dbhp64': 'aac-he-downmix',
    }
    
    codecs = set()
    
    # Parse webplayback flavors (AAC variants)
    song_list = webplayback_data.get("songList", [])
    for song in song_list:
        assets = song.get("assets", [])
        for asset in assets:
            flavor = asset.get("flavor", "")
            # Extract the codec part after the colon (e.g., "30:cbcp256" -> "cbcp256")
            if ":" in flavor:
                flavor_codec = flavor.split(":")[-1]
            else:
                flavor_codec = flavor
            
            # Map to our codec IDs
            if flavor_codec in FLAVOR_TO_CODEC:
                codecs.add(FLAVOR_TO_CODEC[flavor_codec])
            elif 'dolby' in flavor.lower() or 'atmos' in flavor.lower():
                codecs.add('atmos')
            elif 'alac' in flavor.lower():
                codecs.add('alac')
            elif 'binaural' in flavor.lower() or 'ibhp' in flavor.lower():
                # Distinguish between standard and HE binaural
                if 'he' in flavor.lower() or '64' in flavor:
                    codecs.add('aac-he-binaural')
                else:
                    codecs.add('aac-binaural')
            elif 'downmix' in flavor.lower() or 'dbhp' in flavor.lower():
                # Distinguish between standard and HE downmix
                if 'he' in flavor.lower() or '64' in flavor:
                    codecs.add('aac-he-downmix')
                else:
                    codecs.add('aac-downmix')
            elif 'ac3' in flavor.lower():
                codecs.add('ac3')
    
    # Check song attributes' audioTraits for lossless/atmos availability
    if song_attributes:
        audio_traits = song_attributes.get("audioTraits", [])
        extended_urls = song_attributes.get("extendedAssetUrls", {})
        
        # Add lossless if available (check audioTraits and enhancedHls URL)
        if 'lossless' in audio_traits or 'hi-res-lossless' in audio_traits:
            if extended_urls.get("enhancedHls"):
                codecs.add('alac')
        
        # Add atmos if available
        if 'atmos' in audio_traits:
            codecs.add('atmos')
        
        # Add spatial if available (already detected via ibhp flavors, but double-check)
        if 'spatial' in audio_traits:
            # Spatial audio is typically delivered via binaural (ibhp) flavors
            # Already handled above, but ensure aac-binaural is present
            if 'aac-binaural' not in codecs:
                codecs.add('aac-binaural')
    
    # Sort by quality preference (standard -> hires -> spatial)
    CODEC_ORDER = ['aac-legacy', 'aac-he-legacy', 'aac', 'aac-he', 'alac', 
                   'aac-binaural', 'aac-he-binaural', 'aac-downmix', 'aac-he-downmix', 'atmos', 'ac3']
    sorted_codecs = sorted(list(codecs), key=lambda c: CODEC_ORDER.index(c) if c in CODEC_ORDER else 99)
    
    return sorted_codecs



async def create_temp_cookies_file(cookies_content: str) -> str:
    """Create a temporary cookies file from the cookies string."""
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="gamdl_cookies_")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(cookies_content)
        return path
    except Exception:
        os.close(fd)
        raise


async def get_or_create_api(cookies: str):
    """Get cached AppleMusicApi or create new one if cookies changed."""
    import hashlib
    from gamdl.api import AppleMusicApi
    
    cookies_hash = hashlib.md5(cookies.encode()).hexdigest()
    
    # Check if we have a valid cached API with same cookies
    if (_cached_api["api"] is not None and 
        _cached_api["cookies_hash"] == cookies_hash):
        _cached_api["last_used"] = datetime.now()
        print("[DEBUG] Using cached AppleMusicApi instance")
        return _cached_api["api"]
    
    print("[DEBUG] Creating new AppleMusicApi instance...")
    
    # Create new API instance
    cookies_path = await create_temp_cookies_file(cookies)
    try:
        api = await AppleMusicApi.create_from_netscape_cookies(
            cookies_path=cookies_path,
        )
        
        # Cache it
        _cached_api["api"] = api
        _cached_api["cookies_hash"] = cookies_hash
        _cached_api["last_used"] = datetime.now()
        
        print("[DEBUG] AppleMusicApi instance created and cached")
        return api
    finally:
        # Clean up temp cookies file
        try:
            os.unlink(cookies_path)
        except:
            pass


# ============ Word-Synced Lyrics Functions ============

async def get_syllable_lyrics(
    api, 
    song_id: str, 
    language: str = "en-gb",  # Default to English for best translation availability
    translation_lang: str | None = None,
    script_lang: str | None = None
) -> dict | None:
    """
    Fetch word-by-word (syllable) lyrics from Apple Music.
    
    Args:
        api: AppleMusicApi instance
        song_id: Apple Music song ID
        language: Base language for request (default: en-gb for best translations)
        translation_lang: Optional translation language code (e.g., 'it', 'en')
        script_lang: Optional script/romanization (e.g., 'ja-Latn', 'ko-Latn')
    
    Returns TTML with <span> elements for each word, potentially containing
    multiple language versions embedded via xml:lang attributes.
    """
    try:
        url = f"https://amp-api.music.apple.com/v1/catalog/{api.storefront}/songs/{song_id}/syllable-lyrics"
        
        # Build params according to Apple Music API spec
        # Use l[lyrics] for translation requests, l[script] for romanization
        params = {"extend": "ttmlLocalizations"}
        
        # Set lyrics language - this determines what translations are included
        if translation_lang:
            params["l[lyrics]"] = translation_lang
        else:
            params["l[lyrics]"] = language  # Use English by default for translations
        
        # Add script/romanization if specified (e.g., ko-Latn for Korean romanization)
        if script_lang:
            params["l[script]"] = script_lang
        else:
            # Default to English-Latin script for romanization
            params["l[script]"] = "en-Latn"
        
        print(f"[LYRICS] Requesting syllable-lyrics with params: {params}", flush=True)
        response = await api.client.get(url, params=params)
        
        if response.status_code != 200:
            return None
        
        data = response.json()
        if not data.get("data") or len(data["data"]) == 0:
            return None
        
        attributes = data["data"][0].get("attributes", {})
        ttml = attributes.get("ttml")
        
        # Fallback to ttmlLocalizations if ttml is missing (common for some regions/songs)
        if not ttml:
            ttml = attributes.get("ttmlLocalizations")

        if not ttml:
            return None
        
        # Check if it actually has word-level timing (span elements)
        has_word_timing = "<span" in ttml
        
        # Debug: show structure to understand what we're getting
        if not has_word_timing:
            print(f"[LYRICS] TTML has no <span> elements (line-only). First 500 chars: {ttml[:500]}", flush=True)
        else:
            print(f"[LYRICS] TTML has <span> elements (word-synced)!", flush=True)
        
        # Extract available languages from xml:lang attributes in TTML
        # Note: The root <tt xml:lang="en"> is just a default, not an actual translation
        # Real translations only exist when there are MULTIPLE distinct language sections
        import re
        lang_matches = re.findall(r'xml:lang="([^"]+)"', ttml)
        available_langs = list(set(lang_matches))
        
        # Separate translations (e.g., "en-US", "ko") from pronunciations (e.g., "ko-Latn")
        non_latn_langs = [l for l in available_langs if "-Latn" not in l and l != "und"]
        pronunciations = [l for l in available_langs if "-Latn" in l]
        
        # Only consider translations if there are MULTIPLE non-Latn languages
        # A single language (even if labeled "en") just means the original lyrics, not a translation
        if len(non_latn_langs) > 1:
            translations = non_latn_langs
        else:
            translations = []  # Single language = no translations available
        
        print(f"[LYRICS] TTML languages found: {available_langs}, translations: {translations}, pronunciations: {pronunciations}", flush=True)
        
        return {
            "type": "syllable" if has_word_timing else "line",
            "ttml": ttml,
            "has_word_timing": has_word_timing,
            "translation_lang": translation_lang,
            "script_lang": script_lang,
            "available_translations": translations,
            "available_pronunciations": pronunciations
        }
    except Exception as e:
        print(f"[LYRICS] Error fetching syllable-lyrics for {song_id}: {e}", flush=True)
        return None


async def probe_lyrics_availability(
    api,
    song_id: str,
    translation_langs: list[str],
    pronunciation_scripts: list[str]
) -> dict:
    """
    Probe which translations and pronunciations are available for a song.
    
    Returns dict with:
        - available_translations: list of language codes that have translations
        - available_pronunciations: list of script codes that have pronunciations
        - has_word_sync: whether word-by-word sync is available
    """
    result = {
        "available_translations": [],
        "available_pronunciations": [],
        "has_word_sync": False
    }
    
    # First check if base syllable lyrics exist
    base_lyrics = await get_syllable_lyrics(api, song_id, api.storefront)
    if base_lyrics:
        result["has_word_sync"] = base_lyrics.get("has_word_timing", False)
    
    # Probe translations
    for lang in translation_langs:
        try:
            lyrics = await get_syllable_lyrics(api, song_id, translation_lang=lang)
            if lyrics and lyrics.get("ttml"):
                result["available_translations"].append(lang)
        except:
            pass
    
    # Probe pronunciations (romanization)
    for script in pronunciation_scripts:
        try:
            lyrics = await get_syllable_lyrics(api, song_id, script_lang=script)
            if lyrics and lyrics.get("ttml"):
                result["available_pronunciations"].append(script)
        except:
            pass
    
    return result


async def get_line_lyrics(api, song_id: str, language: str = "en-US") -> dict | None:
    """
    Fetch line-by-line synced lyrics from Apple Music.
    Returns TTML with <p> elements for each line.
    """
    try:
        url = f"https://amp-api.music.apple.com/v1/catalog/{api.storefront}/songs/{song_id}/lyrics"
        response = await api.client.get(url, params={"l": language})
        
        if response.status_code != 200:
            return None
        
        data = response.json()
        if not data.get("data") or len(data["data"]) == 0:
            return None
        
        ttml = data["data"][0].get("attributes", {}).get("ttml")
        if not ttml:
            return None
        
        return {
            "type": "line",
            "ttml": ttml,
            "has_word_timing": False
        }
    except Exception as e:
        print(f"[LYRICS] Error fetching line-lyrics for {song_id}: {e}", flush=True)
        return None


async def get_lyrics_with_fallback(api, song_id: str, language: str = "en-US") -> dict | None:
    """
    Get lyrics with fallback priority:
    1. Word-by-word synced (syllable-lyrics with <span> elements)
    2. Line-by-line synced (lyrics endpoint or syllable-lyrics without spans)
    3. Unsynced (from song metadata hasLyrics flag)
    4. None
    
    Returns dict with keys: type, ttml (optional), has_word_timing
    """
    print(f"[LYRICS] Fetching lyrics for song {song_id} with fallback...", flush=True)
    
    # 1. Try syllable-lyrics first (may have word or line timing)
    result = await get_syllable_lyrics(api, song_id, language)
    if result:
        print(f"[LYRICS] Got {result['type']} lyrics from syllable-lyrics endpoint", flush=True)
        return result
    
    # 2. Try line lyrics endpoint
    result = await get_line_lyrics(api, song_id, language)
    if result:
        print(f"[LYRICS] Got line lyrics from lyrics endpoint", flush=True)
        return result
    
    # 3. Check if song has unsynced lyrics (hasLyrics flag)
    try:
        song_data = await api.get_song(song_id)
        if song_data and song_data.get("data"):
            attrs = song_data["data"][0].get("attributes", {})
            if attrs.get("hasLyrics"):
                print(f"[LYRICS] Song has unsynced lyrics (hasLyrics=True)", flush=True)
                return {
                    "type": "unsynced",
                    "ttml": None,
                    "has_word_timing": False
                }
    except Exception as e:
        print(f"[LYRICS] Error checking hasLyrics: {e}", flush=True)
    
    print(f"[LYRICS] No lyrics available for song {song_id}", flush=True)
    return None


async def get_song_audio_locale(api, song_id: str) -> str | None:
    """Get the audioLocale (native language) from song metadata."""
    try:
        url = f"https://amp-api.music.apple.com/v1/catalog/{api.storefront}/songs/{song_id}"
        response = await api.client.get(url)
        if response.status_code == 200:
            data = response.json()
            if data.get("data"):
                return data["data"][0].get("attributes", {}).get("audioLocale")
    except Exception as e:
        print(f"[LYRICS] Error getting audioLocale: {e}", flush=True)
    return None


async def fetch_all_lyrics_variants(
    api,
    song_id: str,
    translation_langs: list[str],
    storefront: str = "it"
) -> dict:
    """
    Fetch all lyrics variants for a song.
    
    Args:
        api: AppleMusicApi instance
        song_id: Apple Music song ID
        translation_langs: List of translation languages to try (e.g., ['en', 'it'])
        storefront: Storefront for romanization preference
    
    Returns dict with:
        - audio_locale: Native language of the song
        - original: dict with ttml, has_word_timing, type (or None)
        - translations: dict mapping lang -> ttml content
        - romanization: ttml content (or None)
        - romanization_script: which script was used (e.g., 'en-Latn')
    """
    result = {
        "audio_locale": None,
        "original": None,
        "translations": {},
        "romanization": None,
        "romanization_script": None
    }
    
    # 1. Get audioLocale (native language)
    audio_locale = await get_song_audio_locale(api, song_id)
    result["audio_locale"] = audio_locale
    print(f"[LYRICS] Song audioLocale: {audio_locale}", flush=True)
    
    if not audio_locale:
        # Fallback to storefront language if no audioLocale
        audio_locale = storefront
        print(f"[LYRICS] No audioLocale found, using storefront: {audio_locale}", flush=True)
    
    # 2. Fetch original lyrics in native language (with syllable -> line fallback)
    print(f"[LYRICS] Fetching original lyrics in {audio_locale}...", flush=True)
    original = await get_syllable_lyrics(api, song_id, language=audio_locale)
    if not original:
        original = await get_line_lyrics(api, song_id, language=audio_locale)
    
    if original and original.get("ttml"):
        result["original"] = original
        print(f"[LYRICS] Got original lyrics: {len(original['ttml'])} bytes, word_sync={original.get('has_word_timing')}", flush=True)
    else:
        print(f"[LYRICS] No original lyrics available", flush=True)
    
    # 3. Fetch translations for each selected language != audioLocale
    for lang in translation_langs:
        # Normalize language codes for comparison
        lang_base = lang.split('-')[0].lower()
        audio_locale_base = audio_locale.split('-')[0].lower() if audio_locale else ""
        
        if lang_base == audio_locale_base:
            print(f"[LYRICS] Skipping translation for {lang} (same as native)", flush=True)
            continue
        
        print(f"[LYRICS] Trying translation: {lang}...", flush=True)
        trans_result = await get_syllable_lyrics(api, song_id, language=lang)
        if not trans_result:
            trans_result = await get_line_lyrics(api, song_id, language=lang)
        
        if trans_result and trans_result.get("ttml"):
            # Check if this is actually different from original (has translation content)
            if result["original"] and trans_result["ttml"] != result["original"]["ttml"]:
                result["translations"][lang] = trans_result["ttml"]
                print(f"[LYRICS] Got translation for {lang}: {len(trans_result['ttml'])} bytes", flush=True)
            else:
                print(f"[LYRICS] Translation for {lang} is same as original, skipping", flush=True)
        else:
            print(f"[LYRICS] No translation available for {lang}", flush=True)
    
    # 4. Romanization handling
    # Check if original already has romanization embedded
    if result["original"]:
        orig_pronunciations = result["original"].get("available_pronunciations", [])
        if orig_pronunciations:
            # Romanization is already in the original file
            result["romanization_script"] = ",".join(orig_pronunciations)
            result["romanization"] = "embedded"  # Mark as embedded, not separate file
            print(f"[LYRICS] Romanization already embedded in original: {orig_pronunciations}", flush=True)
        else:
            # Try to fetch romanization: try <storefront>-Latn, fallback to en-Latn
            romanization_scripts = [f"{storefront}-Latn", "en-Latn"]
            for script in romanization_scripts:
                print(f"[LYRICS] Trying romanization: {script}...", flush=True)
                roman_result = await get_syllable_lyrics(api, song_id, language=audio_locale, script_lang=script)
                
                if roman_result and roman_result.get("ttml"):
                    # Check if romanization is actually present (different from original)
                    if result["original"] and roman_result["ttml"] != result["original"]["ttml"]:
                        result["romanization"] = roman_result["ttml"]
                        result["romanization_script"] = script
                        print(f"[LYRICS] Got romanization ({script}): {len(roman_result['ttml'])} bytes", flush=True)
                        break
                    else:
                        print(f"[LYRICS] Romanization {script} same as original, trying next...", flush=True)
                else:
                    print(f"[LYRICS] No romanization for {script}", flush=True)
    
    return result


def extract_metadata_from_file(file_path: str) -> dict:
    """Extract metadata from a downloaded audio file using mutagen."""
    try:
        from mutagen.mp4 import MP4
        
        audio = MP4(file_path)
        tags = audio.tags or {}
        
        # Map MP4 tags to our metadata format
        def get_tag(key, default=None):
            val = tags.get(key)
            if val:
                return val[0] if isinstance(val, list) else val
            return default
        
        # Get duration in seconds
        duration = audio.info.length if audio.info else None
        
        return {
            "title": get_tag("\xa9nam", "Unknown Title"),
            "artist": get_tag("\xa9ART", "Unknown Artist"),
            "album": get_tag("\xa9alb", "Unknown Album"),
            "albumArtist": get_tag("aART", get_tag("\xa9ART", "Unknown Artist")),
            "duration": duration,
            "trackNumber": get_tag("trkn", (0, 0))[0] if isinstance(get_tag("trkn"), tuple) else None,
            "trackTotal": get_tag("trkn", (0, 0))[1] if isinstance(get_tag("trkn"), tuple) else None,
            "discNumber": get_tag("disk", (0, 0))[0] if isinstance(get_tag("disk"), tuple) else None,
            "discTotal": get_tag("disk", (0, 0))[1] if isinstance(get_tag("disk"), tuple) else None,
            "genre": get_tag("\xa9gen"),
            "composer": get_tag("\xa9wrt"),
            "comment": get_tag("\xa9cmt"),
            "copyright": get_tag("cprt"),
            "rating": None,  # Apple rating is complex to parse
            "isGapless": bool(get_tag("pgap")),
            "isCompilation": bool(get_tag("cpil")),
            "releaseDate": get_tag("\xa9day"),
            "lyrics": get_tag("\xa9lyr"),
            "titleSort": get_tag("sonm"),
            "artistSort": get_tag("soar"),
            "albumSort": get_tag("soal"),
            "composerSort": get_tag("soco"),
        }
    except Exception as e:
        print(f"Error extracting metadata from {file_path}: {e}")
        return {}


def extract_apple_music_ids_from_item(download_item) -> dict:
    """Extract Apple Music IDs from a gamdl DownloadItem for database storage."""
    result = {}
    
    try:
        # Get track ID from media_metadata
        if hasattr(download_item, 'media_metadata') and download_item.media_metadata:
            mm = download_item.media_metadata
            if isinstance(mm, dict):
                # Track Apple Music ID
                result['appleMusicId'] = mm.get('id')
                
                # Get album ID from relationships
                relationships = mm.get('relationships', {})
                albums = relationships.get('albums', {}).get('data', [])
                if albums and len(albums) > 0:
                    result['albumAppleMusicId'] = albums[0].get('id')

                # Get artist ID from relationships
                artists = relationships.get('artists', {}).get('data', [])
                if artists and len(artists) > 0:
                    result['artistId'] = artists[0].get('id')

                # Get attributes for extra metadata
                attrs = mm.get('attributes', {})
                if attrs:
                    result['storefront'] = attrs.get('playParams', {}).get('id')
        
        # Also try media_tags which has album_id and title_id
        if hasattr(download_item, 'media_tags') and download_item.media_tags:
            mt = download_item.media_tags
            if hasattr(mt, 'title_id') and mt.title_id:
                result['appleMusicId'] = str(mt.title_id)
            if hasattr(mt, 'album_id') and mt.album_id:
                result['albumAppleMusicId'] = str(mt.album_id)
            if hasattr(mt, 'storefront') and mt.storefront:
                result['storefront'] = str(mt.storefront)
    except Exception as e:
        print(f"Error extracting Apple Music IDs: {e}")
    
    return result

async def extract_album_metadata_from_api(apple_music_api, content_id: str, is_library: bool = False) -> dict:
    """Extract extended album metadata from Apple Music API, including animated cover."""
    try:
        if is_library:
            album_data = await apple_music_api.get_library_album(content_id)
        else:
            # Request editorialVideo for animated covers along with extendedAssetUrls
            album_data = await apple_music_api.get_album(
                content_id, 
                extend="extendedAssetUrls,editorialVideo"
            )
        
        if not album_data:
            return {}
        
        # Unwrap data array if present
        if isinstance(album_data, dict) and 'data' in album_data:
            data_list = album_data.get('data', [])
            if data_list and len(data_list) > 0:
                album_data = data_list[0]
        
        attrs = album_data.get("attributes", {}) if isinstance(album_data, dict) else {}
        artwork = attrs.get("artwork", {})
        
        # Extract editorial notes/description
        description = None
        editorial_notes = attrs.get("editorialNotes", {})
        if editorial_notes:
            description = editorial_notes.get("standard") or editorial_notes.get("short")
        
        # Extract animated cover URL (motion artwork)
        animated_cover_url = get_animated_cover_url(attrs)
        
        return {
            # Core album metadata
            "copyright": attrs.get("copyright"),
            "genre": attrs.get("genreNames", [None])[0] if attrs.get("genreNames") else None,
            "releaseDate": attrs.get("releaseDate"),
            # Extended metadata
            "description": description,
            "recordLabel": attrs.get("recordLabel"),
            "upc": attrs.get("upc"),
            "isSingle": attrs.get("isSingle", False),
            "isMasteredForItunes": attrs.get("isMasteredForItunes", False),
            "artworkBgColor": artwork.get("bgColor"),
            "artworkTextColor1": artwork.get("textColor1"),
            "artworkTextColor2": artwork.get("textColor2"),
            "artworkTextColor3": artwork.get("textColor3"),
            "artworkTextColor4": artwork.get("textColor4"),
            "albumAppleMusicId": attrs.get("playParams", {}).get("id") or content_id,
            # Animated cover (motion artwork)
            "animatedCoverUrl": animated_cover_url,
        }
    except Exception as e:
        print(f"Error extracting album metadata from API: {e}")
        return {}


def extract_metadata_from_download_item(download_item, file_path: str = None) -> dict:
    """
    Extract track metadata from gamdl download_item using API data.
    This uses media_metadata (API response) and media_tags instead of reading file tags.
    """
    metadata = {}
    
    try:
        # Primary source: media_metadata from Apple Music API
        if hasattr(download_item, 'media_metadata') and download_item.media_metadata:
            mm = download_item.media_metadata
            if isinstance(mm, dict):
                attrs = mm.get('attributes', {})
                if attrs:
                    metadata['title'] = attrs.get('name')
                    metadata['artist'] = attrs.get('artistName')
                    metadata['album'] = attrs.get('albumName')
                    metadata['albumArtist'] = attrs.get('albumName')  # Will be overwritten by media_tags if available
                    metadata['genre'] = attrs.get('genreNames', [None])[0] if attrs.get('genreNames') else None
                    metadata['composer'] = attrs.get('composerName')
                    metadata['releaseDate'] = attrs.get('releaseDate')
                    metadata['trackNumber'] = attrs.get('trackNumber')
                    metadata['discNumber'] = attrs.get('discNumber')
                    metadata['durationInMillis'] = attrs.get('durationInMillis')
                    if metadata.get('durationInMillis'):
                        metadata['duration'] = metadata['durationInMillis'] / 1000.0
                    metadata['isrc'] = attrs.get('isrc')
                    metadata['audioLocale'] = attrs.get('audioLocale')
                    
                    # Lyrics (plain text from API if available)
                    if attrs.get('hasLyrics'):
                        # Lyrics content is fetched separately by lyrics module
                        pass
        
        # Secondary source: media_tags from gamdl (has more detailed info)
        if hasattr(download_item, 'media_tags') and download_item.media_tags:
            mt = download_item.media_tags
            
            # Override with media_tags values (more accurate)
            if hasattr(mt, 'title') and mt.title:
                metadata['title'] = str(mt.title)
            if hasattr(mt, 'artist') and mt.artist:
                metadata['artist'] = str(mt.artist)
            if hasattr(mt, 'album') and mt.album:
                metadata['album'] = str(mt.album)
            if hasattr(mt, 'album_artist') and mt.album_artist:
                metadata['albumArtist'] = str(mt.album_artist)
            if hasattr(mt, 'genre') and mt.genre:
                metadata['genre'] = str(mt.genre)
            if hasattr(mt, 'composer') and mt.composer:
                metadata['composer'] = str(mt.composer)
            if hasattr(mt, 'copyright') and mt.copyright:
                metadata['copyright'] = str(mt.copyright)
            if hasattr(mt, 'release_date') and mt.release_date:
                metadata['releaseDate'] = str(mt.release_date)
            if hasattr(mt, 'track') and mt.track:
                metadata['trackNumber'] = mt.track
            if hasattr(mt, 'track_total') and mt.track_total:
                metadata['trackTotal'] = mt.track_total
            if hasattr(mt, 'disc') and mt.disc:
                metadata['discNumber'] = mt.disc
            if hasattr(mt, 'disc_total') and mt.disc_total:
                metadata['discTotal'] = mt.disc_total
            if hasattr(mt, 'lyrics') and mt.lyrics:
                metadata['lyrics'] = str(mt.lyrics)
            if hasattr(mt, 'rating') and mt.rating is not None:
                # Convert MediaRating enum to int value for JSON serialization
                rating = mt.rating
                if hasattr(rating, 'value'):
                    metadata['rating'] = rating.value
                else:
                    metadata['rating'] = int(rating) if rating else None
            if hasattr(mt, 'gapless') and mt.gapless is not None:
                metadata['isGapless'] = mt.gapless
            if hasattr(mt, 'compilation') and mt.compilation is not None:
                metadata['isCompilation'] = mt.compilation
            
            # Sort names
            if hasattr(mt, 'title_sort') and mt.title_sort:
                metadata['titleSort'] = str(mt.title_sort)
            if hasattr(mt, 'artist_sort') and mt.artist_sort:
                metadata['artistSort'] = str(mt.artist_sort)
            if hasattr(mt, 'album_sort') and mt.album_sort:
                metadata['albumSort'] = str(mt.album_sort)
            if hasattr(mt, 'composer_sort') and mt.composer_sort:
                metadata['composerSort'] = str(mt.composer_sort)
        
        # Get duration from file if not in API data (fallback)
        if not metadata.get('duration') and file_path:
            try:
                from mutagen.mp4 import MP4
                audio = MP4(file_path)
                if audio.info and audio.info.length:
                    metadata['duration'] = audio.info.length
            except:
                pass
        
        # Ensure we have sensible defaults
        if not metadata.get('title'):
            metadata['title'] = 'Unknown Title'
        if not metadata.get('artist'):
            metadata['artist'] = 'Unknown Artist'
        if not metadata.get('album'):
            metadata['album'] = 'Unknown Album'
        if not metadata.get('albumArtist'):
            metadata['albumArtist'] = metadata.get('artist', 'Unknown Artist')
            
    except Exception as e:
        print(f"Error extracting metadata from download_item: {e}")
        import traceback
        traceback.print_exc()
    
    return metadata


# --- API Endpoints ---


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        gamdl_version=get_gamdl_version(),
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    )


@app.post("/wrapper/start")
async def start_wrapper_endpoint():
    """Manually start the wrapper Docker container."""
    import sqlite3
    import os
    from wrapper_manager import get_wrapper_manager
    
    # Get library path from database
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        db_path = os.path.join(project_root, "library.db")
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
        row = cursor.fetchone()
        conn.close()
        
        library_root = Path(row[0]) if row and row[0] else Path("./music")
        
        if _cached_api.get("api"):
            result = await start_wrapper_if_available(_cached_api["api"], library_root)
            if result:
                return {"success": True, "message": "Wrapper started successfully"}
            else:
                return {"success": False, "message": "Failed to start wrapper - check logs"}
        else:
            return {"success": False, "message": "No API initialized - configure cookies first"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/wrapper/stop")
async def stop_wrapper_endpoint():
    """Stop the wrapper Docker container."""
    from wrapper_manager import stop_wrapper
    
    stop_wrapper()
    return {"success": True, "message": "Wrapper stopped"}


@app.get("/test-sse")
async def test_sse():
    """Test SSE endpoint to verify streaming works."""
    async def test_generator():
        print("[TEST-SSE] Generator started", flush=True)
        for i in range(3):
            yield {
                "event": "test",
                "data": json.dumps({"count": i + 1, "message": f"Test event {i + 1}"}),
            }
            print(f"[TEST-SSE] Yielded event {i + 1}", flush=True)
            await asyncio.sleep(1)
        yield {
            "event": "complete",
            "data": json.dumps({"status": "done"}),
        }
        print("[TEST-SSE] Generator complete", flush=True)
    
    print("[TEST-SSE] Creating EventSourceResponse...", flush=True)
    return EventSourceResponse(test_generator())


@app.post("/validate-url", response_model=ValidateUrlResponse)
async def validate_url(request: ValidateUrlRequest):
    """Validate an Apple Music URL and return preview information."""
    url_info = parse_apple_music_url(request.url)
    
    if url_info["type"] == "unknown":
        return ValidateUrlResponse(
            valid=False,
            type="unknown",
            title="",
            error="Invalid Apple Music URL format",
        )
    
    # If cookies provided, try to fetch actual metadata
    if request.cookies and request.cookies.strip():
        try:
            # Use cached API to avoid re-initialization timeout
            apple_music_api = await get_or_create_api(request.cookies)
            
            # Parse the URL to get the content type and ID
            url_parsed = parse_apple_music_url(request.url)
            content_id = url_parsed.get("id") or url_parsed.get("track_id")
            content_type = url_parsed["type"]
            
            if content_id and content_type in ("album", "playlist", "song"):
                # Detect if this is a library item (IDs starting with l., p., i.)
                is_library_item = content_id.startswith(("l.", "p.", "i."))
                
                # Fetch metadata directly from Apple Music API
                metadata = None
                
                if content_type == "album":
                    # Fetch album metadata
                    try:
                        if is_library_item:
                            album_data = await apple_music_api.get_library_album(content_id)
                        else:
                            album_data = await apple_music_api.get_album(content_id)
                        
                        if album_data:
                            # Response is wrapped in 'data' array: {'data': [{'attributes': {...}}]}
                            if isinstance(album_data, dict) and 'data' in album_data:
                                data_list = album_data.get('data', [])
                                if data_list and len(data_list) > 0:
                                    album_data = data_list[0]
                            
                            # Now extract attributes
                            attrs = album_data.get("attributes", {}) if isinstance(album_data, dict) else {}
                            name = attrs.get("name")
                            artist_name = attrs.get("artistName")
                            artwork = attrs.get("artwork", {})
                            track_count = attrs.get("trackCount")
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            # Get description from editorialNotes
                            editorial_notes = attrs.get("editorialNotes", {})
                            description = editorial_notes.get("standard") or editorial_notes.get("short") if isinstance(editorial_notes, dict) else None
                            
                            if name:
                                return ValidateUrlResponse(
                                    valid=True,
                                    type=content_type,
                                    title=name,
                                    artist=artist_name,
                                    artwork_url=artwork_url,
                                    track_count=track_count,
                                    apple_music_id=content_id,
                                    description=description,
                                    extracted_url=url_parsed.get("extracted_url"),
                                )
                    except Exception as e:
                        print(f"Failed to fetch album: {e}")
                        import traceback
                        traceback.print_exc()
                
                elif content_type == "playlist":
                    # Fetch playlist metadata
                    try:
                        if is_library_item:
                            playlist_data = await apple_music_api.get_library_playlist(content_id)
                        else:
                            playlist_data = await apple_music_api.get_playlist(content_id)
                        
                        if playlist_data:
                            # Response is wrapped in 'data' array
                            if isinstance(playlist_data, dict) and 'data' in playlist_data:
                                data_list = playlist_data.get('data', [])
                                if data_list and len(data_list) > 0:
                                    playlist_data = data_list[0]
                            
                            attrs = playlist_data.get("attributes", {}) if isinstance(playlist_data, dict) else {}
                            relationships = playlist_data.get("relationships", {}) if isinstance(playlist_data, dict) else {}
                            
                            artwork = attrs.get("artwork", {})
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            # Get track count from attributes first, then from relationships.tracks.meta.total
                            track_count = attrs.get("trackCount")
                            if not track_count:
                                tracks_meta = relationships.get("tracks", {}).get("meta", {})
                                track_count = tracks_meta.get("total")
                            
                            # Get the globalId for sync (persists across devices)
                            # playParams.globalId is the catalog ID for library playlists
                            play_params = attrs.get("playParams", {})
                            global_id = play_params.get("globalId")  # e.g., pl.u-76oNlvMtxkVrl2
                            sync_id = global_id or content_id  # Use globalId if available, else library ID
                            
                            # Get description
                            description_obj = attrs.get("description", {})
                            description = description_obj.get("standard") if isinstance(description_obj, dict) else None
                            
                            name = attrs.get("name")
                            if name:
                                return ValidateUrlResponse(
                                    valid=True,
                                    type=content_type,
                                    title=name,
                                    artist=attrs.get("curatorName"),
                                    artwork_url=artwork_url,
                                    track_count=track_count,
                                    apple_music_id=content_id,  # Library ID for local reference
                                    global_id=global_id,  # Global ID for sync
                                    description=description,
                                    extracted_url=url_parsed.get("extracted_url"),
                                )
                    except Exception as e:
                        print(f"Failed to fetch playlist: {e}")
                        import traceback
                        traceback.print_exc()
                        
                elif content_type == "song":
                    # Fetch song metadata
                    try:
                        song_data = await apple_music_api.get_song(content_id)
                        if song_data:
                            # Response is wrapped in 'data' array
                            if isinstance(song_data, dict) and 'data' in song_data:
                                data_list = song_data.get('data', [])
                                if data_list and len(data_list) > 0:
                                    song_data = data_list[0]
                            
                            attrs = song_data.get("attributes", {}) if isinstance(song_data, dict) else {}
                            artwork = attrs.get("artwork", {})
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            # Fetch webplayback to get available codecs
                            available_codecs = None
                            try:
                                webplayback = await apple_music_api.get_webplayback(content_id)
                                if webplayback:
                                    # Pass attrs to check audioTraits for lossless/atmos
                                    available_codecs = parse_webplayback_codecs(webplayback, attrs)
                                    print(f"[DEBUG] Available codecs for {content_id}: {available_codecs}")
                            except Exception as wp_e:
                                print(f"Failed to fetch webplayback for codecs: {wp_e}")
                            
                            name = attrs.get("name")
                            if name:
                                return ValidateUrlResponse(
                                    valid=True,
                                    type=content_type,
                                    title=name,
                                    artist=attrs.get("artistName"),
                                    artwork_url=artwork_url,
                                    track_count=1,
                                    apple_music_id=content_id,
                                    extracted_url=url_parsed.get("extracted_url"),
                                    available_codecs=available_codecs,
                                )
                    except Exception as e:
                        print(f"Failed to fetch song: {e}")
                    
        except Exception as e:
            print(f"Failed to fetch metadata: {e}")
            import traceback
            traceback.print_exc()
    
    # Fallback: return basic info from URL parsing
    return ValidateUrlResponse(
        valid=True,
        type=url_info["type"],
        title=f"Apple Music {url_info['type'].title()}",
        apple_music_id=url_info.get("id") or url_info.get("track_id"),
        extracted_url=url_info.get("extracted_url"),
    )


@app.post("/validate-batch", response_model=ValidateBatchResponse)
async def validate_batch(request: ValidateBatchRequest):
    """Validate multiple Apple Music URLs from a text and return preview information for all.
    Deduplicates by catalog Apple Music ID to avoid importing the same content twice.
    """
    # Find all valid URLs in the text
    print(f"[DEBUG] validate_batch input text: {request.text[:200]}...", flush=True)
    parsed_urls = find_all_apple_music_urls(request.text)
    print(f"[DEBUG] find_all_apple_music_urls result: {parsed_urls}", flush=True)
    
    if not parsed_urls:
        print(f"[DEBUG] No URLs found, returning empty", flush=True)
        return ValidateBatchResponse(items=[], total_found=0)
    
    items = []
    seen_catalog_ids = set()  # Track by catalog ID to avoid duplicates
    
    # If cookies provided, try to fetch actual metadata for each
    if request.cookies and request.cookies.strip():
        try:
            apple_music_api = await get_or_create_api(request.cookies)
            
            for url_parsed in parsed_urls:
                content_id = url_parsed.get("id") or url_parsed.get("track_id")
                content_type = url_parsed["type"]
                
                if not content_id:
                    continue
                
                try:
                    is_library_item = content_id.startswith(("l.", "p.", "i."))
                    
                    if content_type == "album":
                        if is_library_item:
                            data = await apple_music_api.get_library_album(content_id)
                        else:
                            data = await apple_music_api.get_album(content_id)
                        
                        if data:
                            if isinstance(data, dict) and 'data' in data:
                                data_list = data.get('data', [])
                                if data_list:
                                    data = data_list[0]
                            
                            attrs = data.get("attributes", {}) if isinstance(data, dict) else {}
                            relationships = data.get("relationships", {}) if isinstance(data, dict) else {}
                            
                            # Get catalog ID - check multiple sources:
                            # 1. playParams.catalogId (newer API)
                            # 2. relationships.catalog.data[0].id (library items link to catalog)
                            # 3. playParams.id (for catalog items, this IS the catalog ID)
                            # 4. content_id as fallback
                            play_params = attrs.get("playParams", {})
                            catalog_id = play_params.get("catalogId")
                            
                            if not catalog_id:
                                # Check relationships.catalog for library items
                                catalog_rel = relationships.get("catalog", {}).get("data", [])
                                if catalog_rel and len(catalog_rel) > 0:
                                    catalog_id = catalog_rel[0].get("id")
                            
                            if not catalog_id:
                                # For catalog items, playParams.id is the catalog ID
                                if not is_library_item:
                                    catalog_id = play_params.get("id") or content_id
                                else:
                                    catalog_id = content_id
                            
                            print(f"[DEBUG] Album {content_id}: playParams={play_params}, catalog_id={catalog_id}, is_library={is_library_item}")
                            
                            # Skip if we've already seen this catalog ID
                            dedup_key = f"album:{catalog_id}"
                            if dedup_key in seen_catalog_ids:
                                print(f"[DEBUG] Skipping duplicate album: {catalog_id}")
                                continue
                            seen_catalog_ids.add(dedup_key)
                            
                            artwork = attrs.get("artwork", {})
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            items.append(ValidateUrlResponse(
                                valid=True,
                                type=content_type,
                                title=attrs.get("name", "Unknown Album"),
                                artist=attrs.get("artistName"),
                                artwork_url=artwork_url,
                                track_count=attrs.get("trackCount"),
                                apple_music_id=catalog_id,  # Use catalog ID for consistency
                                extracted_url=url_parsed.get("extracted_url"),
                            ))
                    
                    elif content_type == "playlist":
                        if is_library_item:
                            data = await apple_music_api.get_library_playlist(content_id)
                        else:
                            data = await apple_music_api.get_playlist(content_id)
                        
                        if data:
                            if isinstance(data, dict) and 'data' in data:
                                data_list = data.get('data', [])
                                if data_list:
                                    data = data_list[0]
                            
                            attrs = data.get("attributes", {}) if isinstance(data, dict) else {}
                            relationships = data.get("relationships", {}) if isinstance(data, dict) else {}
                            
                            # Get global ID for playlists (unique across devices)
                            play_params = attrs.get("playParams", {})
                            global_id = play_params.get("globalId") or content_id
                            
                            # Skip duplicates
                            dedup_key = f"playlist:{global_id}"
                            if dedup_key in seen_catalog_ids:
                                print(f"[DEBUG] Skipping duplicate playlist: {global_id}")
                                continue
                            seen_catalog_ids.add(dedup_key)
                            
                            artwork = attrs.get("artwork", {})
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            track_count = attrs.get("trackCount")
                            if not track_count:
                                track_count = relationships.get("tracks", {}).get("meta", {}).get("total")
                            
                            # Get description
                            description_obj = attrs.get("description", {})
                            description = description_obj.get("standard") if isinstance(description_obj, dict) else None
                            
                            items.append(ValidateUrlResponse(
                                valid=True,
                                type=content_type,
                                title=attrs.get("name", "Unknown Playlist"),
                                artist=attrs.get("curatorName"),
                                artwork_url=artwork_url,
                                track_count=track_count,
                                apple_music_id=content_id,  # Keep library ID for playlist
                                global_id=global_id,
                                description=description,
                                extracted_url=url_parsed.get("extracted_url"),
                            ))
                    
                    elif content_type == "song":
                        print(f"[DEBUG] Fetching song: {content_id} (API storefront: {apple_music_api.storefront})", flush=True)
                        data = await apple_music_api.get_song(content_id)
                        print(f"[DEBUG] Song data received: {data is not None}", flush=True)
                        
                        if data:
                            if isinstance(data, dict) and 'data' in data:
                                data_list = data.get('data', [])
                                if data_list:
                                    data = data_list[0]
                            
                            attrs = data.get("attributes", {}) if isinstance(data, dict) else {}
                            print(f"[DEBUG] Song attrs keys: {list(attrs.keys())[:5]}", flush=True)
                            
                            # Get catalog ID for song
                            play_params = attrs.get("playParams", {})
                            catalog_id = play_params.get("catalogId") or play_params.get("id") or content_id
                            
                            # Skip duplicates
                            dedup_key = f"song:{catalog_id}"
                            if dedup_key in seen_catalog_ids:
                                print(f"[DEBUG] Skipping duplicate song: {catalog_id}")
                                continue
                            seen_catalog_ids.add(dedup_key)
                            
                            artwork = attrs.get("artwork", {})
                            artwork_url = artwork.get("url", "").replace("{w}", "1200").replace("{h}", "1200") if artwork else None
                            
                            # Fetch webplayback to get available codecs
                            available_codecs = None
                            try:
                                webplayback = await apple_music_api.get_webplayback(content_id)
                                if webplayback:
                                    # Pass attrs to check audioTraits for lossless/atmos
                                    available_codecs = parse_webplayback_codecs(webplayback, attrs)
                                    print(f"[DEBUG] Available codecs for {content_id}: {available_codecs}")
                            except Exception as wp_e:
                                print(f"Failed to fetch webplayback for codecs: {wp_e}")
                            
                            song_name = attrs.get("name", "Unknown Song")
                            print(f"[DEBUG] Adding song to items: {song_name}", flush=True)
                            items.append(ValidateUrlResponse(
                                valid=True,
                                type=content_type,
                                title=song_name,
                                artist=attrs.get("artistName"),
                                artwork_url=artwork_url,
                                track_count=1,
                                apple_music_id=catalog_id,
                                extracted_url=url_parsed.get("extracted_url"),
                                available_codecs=available_codecs,
                            ))
                        else:
                            print(f"[DEBUG] Song data was None/empty - likely not available in storefront '{apple_music_api.storefront}'", flush=True)
                            # Add an entry with error message about storefront
                            items.append(ValidateUrlResponse(
                                valid=False,
                                type=content_type,
                                title="Content not available",
                                apple_music_id=content_id,
                                extracted_url=url_parsed.get("extracted_url"),
                                error=f"This content is not available in your Apple Music region ({apple_music_api.storefront.upper()}). Try using a URL from your region."
                            ))
                
                except Exception as e:
                    print(f"Error fetching metadata for {content_type} {content_id}: {e}")
                    # Add fallback entry (with basic dedup)
                    dedup_key = f"{content_type}:{content_id}"
                    if dedup_key not in seen_catalog_ids:
                        seen_catalog_ids.add(dedup_key)
                        items.append(ValidateUrlResponse(
                            valid=True,
                            type=content_type,
                            title=f"Apple Music {content_type.title()}",
                            apple_music_id=content_id,
                            extracted_url=url_parsed.get("extracted_url"),
                        ))
        
        except Exception as e:
            print(f"Error in batch validation: {e}")
            # Add fallback entries for all URLs
            for url_parsed in parsed_urls:
                content_id = url_parsed.get("id") or url_parsed.get("track_id")
                dedup_key = f"{url_parsed['type']}:{content_id}"
                if dedup_key not in seen_catalog_ids:
                    seen_catalog_ids.add(dedup_key)
                    items.append(ValidateUrlResponse(
                        valid=True,
                        type=url_parsed["type"],
                        title=f"Apple Music {url_parsed['type'].title()}",
                        apple_music_id=content_id,
                        extracted_url=url_parsed.get("extracted_url"),
                    ))
    else:
        # No cookies - return basic info only (limited dedup)
        for url_parsed in parsed_urls:
            content_id = url_parsed.get("id") or url_parsed.get("track_id")
            dedup_key = f"{url_parsed['type']}:{content_id}"
            if dedup_key not in seen_catalog_ids:
                seen_catalog_ids.add(dedup_key)
                items.append(ValidateUrlResponse(
                    valid=True,
                    type=url_parsed["type"],
                    title=f"Apple Music {url_parsed['type'].title()}",
                    apple_music_id=content_id,
                    extracted_url=url_parsed.get("extracted_url"),
                ))
    
    return ValidateBatchResponse(items=items, total_found=len(items))


# --- Apple Music Catalog Search ---


class SearchRequest(BaseModel):
    term: str
    cookies: Optional[str] = None
    types: str = "songs,albums"
    limit: int = 25


class SearchResultItem(BaseModel):
    type: str  # 'song' or 'album'
    apple_music_id: str
    title: str
    artist: Optional[str] = None
    artwork_url: Optional[str] = None
    track_count: Optional[int] = None  # For albums
    album_name: Optional[str] = None  # For songs
    duration_ms: Optional[int] = None  # For songs


class SearchResponse(BaseModel):
    songs: list[SearchResultItem]
    albums: list[SearchResultItem]
    term: str
    storefront: str  # e.g., "it", "us", "gb"


@app.post("/search", response_model=SearchResponse)
async def search_catalog(request: SearchRequest):
    """Search Apple Music catalog for songs and albums.

    Returns results organized by type. Codec availability is NOT included
    in search results - it requires a separate validation call per track.
    """
    if not request.term or len(request.term) < 2:
        return SearchResponse(songs=[], albums=[], term=request.term or "", storefront="")

    if not request.cookies or not request.cookies.strip():
        raise HTTPException(status_code=400, detail="Cookies required for search")

    try:
        apple_music_api = await get_or_create_api(request.cookies)

        # Use the existing get_search_results method from ami.py
        search_results = await apple_music_api.get_search_results(
            term=request.term,
            types=request.types,
            limit=request.limit
        )

        results = search_results.get("results", {})

        songs = []
        albums = []

        # Parse songs
        songs_data = results.get("songs", {}).get("data", [])
        for song in songs_data:
            attrs = song.get("attributes", {})
            artwork = attrs.get("artwork", {})
            artwork_url = artwork.get("url", "").replace("{w}", "300").replace("{h}", "300") if artwork else None

            songs.append(SearchResultItem(
                type="song",
                apple_music_id=song.get("id"),
                title=attrs.get("name", "Unknown"),
                artist=attrs.get("artistName"),
                artwork_url=artwork_url,
                album_name=attrs.get("albumName"),
                duration_ms=attrs.get("durationInMillis"),
            ))

        # Parse albums
        albums_data = results.get("albums", {}).get("data", [])
        for album in albums_data:
            attrs = album.get("attributes", {})
            artwork = attrs.get("artwork", {})
            artwork_url = artwork.get("url", "").replace("{w}", "300").replace("{h}", "300") if artwork else None

            albums.append(SearchResultItem(
                type="album",
                apple_music_id=album.get("id"),
                title=attrs.get("name", "Unknown"),
                artist=attrs.get("artistName"),
                artwork_url=artwork_url,
                track_count=attrs.get("trackCount"),
            ))

        return SearchResponse(
            songs=songs,
            albums=albums,
            term=request.term,
            storefront=apple_music_api.storefront
        )

    except Exception as e:
        print(f"Search error: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


# --- Artist Info ---


class ArtistRequest(BaseModel):
    artist_id: str
    cookies: Optional[str] = None


class ArtistAlbumItem(BaseModel):
    apple_music_id: str
    title: str
    artwork_url: Optional[str] = None
    release_date: Optional[str] = None
    track_count: Optional[int] = None
    is_single: bool = False


class ArtistResponse(BaseModel):
    apple_music_id: str
    name: str
    artwork_url: Optional[str] = None
    bio: Optional[str] = None
    genre: Optional[str] = None
    origin: Optional[str] = None
    birth_date: Optional[str] = None
    url: Optional[str] = None
    albums: list[ArtistAlbumItem]
    singles: list[ArtistAlbumItem]
    storefront: str
    # Extended metadata
    is_group: Optional[bool] = None
    plain_editorial_notes: Optional[str] = None
    # Hero media URLs (HLS m3u8 or static images)
    hero_video_url: Optional[str] = None          # motionArtistWide16x9 video URL
    hero_static_url: Optional[str] = None         # previewFrame URL for static fallback
    profile_video_url: Optional[str] = None       # motionArtistSquare1x1 video URL


def transform_artwork_url(url: Optional[str], size: int = 600) -> Optional[str]:
    """Transform Apple Music artwork URL template to actual URL."""
    if not url:
        return None
    return url.replace("{w}", str(size)).replace("{h}", str(size))


@app.post("/artist", response_model=ArtistResponse)
async def get_artist_info(request: ArtistRequest):
    """Get artist information from Apple Music API with extended metadata."""
    try:
        apple_music_api = await get_or_create_api(request.cookies)

        # Make direct HTTP request with extend parameter (gamdl doesn't support it)
        from gamdl.utils import raise_for_status, safe_json
        response = await apple_music_api.client.get(
            f"https://amp-api.music.apple.com/v1/catalog/{apple_music_api.storefront}/artists/{request.artist_id}",
            params={
                "include": "albums,music-videos",
                "extend": "artistBio,bornOrFormed,editorialArtwork,editorialVideo,hero,isGroup,origin,plainEditorialNotes",
                "limit[albums]": 100,
                "limit[music-videos]": 100,
            },
        )
        raise_for_status(response, {200, 404})

        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Artist not found")

        artist_data = safe_json(response)
        if not artist_data or "data" not in artist_data or len(artist_data["data"]) == 0:
            raise HTTPException(status_code=404, detail="Artist not found")

        artist = artist_data["data"][0]
        attrs = artist.get("attributes", {})
        relationships = artist.get("relationships", {})
        artist_id = artist.get("id")
        artist_name = attrs.get("name", "Unknown Artist")

        # Extract albums from relationships
        albums = []
        singles = []
        for album in relationships.get("albums", {}).get("data", []):
            album_attrs = album.get("attributes", {})
            artwork = album_attrs.get("artwork", {})
            item = ArtistAlbumItem(
                apple_music_id=album.get("id"),
                title=album_attrs.get("name", ""),
                artwork_url=transform_artwork_url(artwork.get("url") if artwork else None),
                release_date=album_attrs.get("releaseDate"),
                track_count=album_attrs.get("trackCount"),
                is_single=album_attrs.get("isSingle", False)
            )
            if item.is_single:
                singles.append(item)
            else:
                albums.append(item)

        # Get bio - try artistBio first (from extend param), then fall back to editorialNotes
        bio = attrs.get("artistBio")
        if not bio:
            editorial_notes = attrs.get("editorialNotes") or {}
            bio = editorial_notes.get("standard") or editorial_notes.get("short")

        # Get plain editorial notes (no HTML)
        plain_editorial_notes = attrs.get("plainEditorialNotes") or attrs.get("artistBio")

        # Get genre names
        genre_names = attrs.get("genreNames", [])
        genre = genre_names[0] if genre_names else None

        # Get artwork (profile image)
        artwork = attrs.get("artwork", {})
        artwork_url = transform_artwork_url(artwork.get("url") if artwork else None, 1200)

        # Get extended metadata
        is_group = attrs.get("isGroup")

        # Get bornOrFormed (birth date or formation date)
        birth_date = attrs.get("bornOrFormed") or attrs.get("birthDate")

        # Get hero media URLs - check local cache first, use remote as fallback
        hero_video_url = None
        hero_static_url = None
        profile_video_url = None

        try:
            import sqlite3
            import os
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            db_path = os.path.join(project_root, "library.db")

            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # Check if we already have cached hero files for this artist
            cursor.execute("""
                SELECT heroAnimatedPath, heroStaticPath, profileImagePath
                FROM Artist WHERE appleMusicId = ?
            """, (artist_id,))
            cached = cursor.fetchone()

            # Get media library path for potential background download
            cursor.execute("SELECT mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
            settings_row = cursor.fetchone()
            conn.close()

            media_library_path = Path(settings_row[0]) if settings_row and settings_row[0] else Path("./music")
            if not media_library_path.is_absolute():
                media_library_path = Path(project_root) / media_library_path

            # Check for existing cached files
            if cached:
                animated_path, static_path, profile_path = cached
                if animated_path and Path(animated_path).exists():
                    hero_video_url = f"/api/artist-hero/{artist_id}/hero-animated.mp4"
                if static_path and Path(static_path).exists():
                    hero_static_url = f"/api/artist-hero/{artist_id}/hero-static.jpg"
                if profile_path and Path(profile_path).exists():
                    profile_video_url = f"/api/artist-hero/{artist_id}/profile.jpg"

            # If we don't have local files, use remote URLs and trigger background download
            if not hero_static_url:
                # Use remote URLs immediately
                editorial_video = attrs.get("editorialVideo", {})
                motion_wide = editorial_video.get("motionArtistWide16x9", {})

                if motion_wide:
                    # For animated, pass HLS URL (frontend can't use it but we need to download)
                    hero_m3u8 = motion_wide.get("video")
                    preview_frame = motion_wide.get("previewFrame", {})
                    if preview_frame and preview_frame.get("url"):
                        # Use static preview frame as fallback
                        hero_static_url = transform_artwork_url(preview_frame.get("url"), 3840)

                if not hero_static_url and artwork_url:
                    hero_static_url = artwork_url

                # Trigger background download (don't wait for it)
                asyncio.create_task(
                    background_download_artist_hero(
                        artist_id, artist_name, attrs, media_library_path, db_path
                    )
                )
                print(f"[ARTIST] Background hero download started for {artist_name}", flush=True)

        except Exception as hero_err:
            print(f"[ARTIST] Error processing hero media: {hero_err}", flush=True)
            # Fallback to remote URLs
            editorial_video = attrs.get("editorialVideo", {})
            motion_wide = editorial_video.get("motionArtistWide16x9", {})
            if motion_wide:
                preview_frame = motion_wide.get("previewFrame", {})
                if preview_frame and preview_frame.get("url"):
                    hero_static_url = transform_artwork_url(preview_frame.get("url"), 3840)
            if not hero_static_url and artwork_url:
                hero_static_url = artwork_url

        return ArtistResponse(
            apple_music_id=artist_id,
            name=artist_name,
            artwork_url=artwork_url,
            bio=bio,
            genre=genre,
            origin=attrs.get("origin"),
            birth_date=birth_date,
            url=attrs.get("url"),
            albums=albums,
            singles=singles,
            storefront=apple_music_api.storefront,
            # Extended fields
            is_group=is_group,
            plain_editorial_notes=plain_editorial_notes,
            hero_video_url=hero_video_url,
            hero_static_url=hero_static_url,
            profile_video_url=profile_video_url,
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Artist info error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# --- Playlist Sync ---


class CheckSyncRequest(BaseModel):
    playlist_id: str  # Apple Music playlist ID (library ID like p.xxx)
    cookies: str
    local_last_modified: Optional[str] = None  # ISO format datetime string


class CheckSyncResponse(BaseModel):
    needs_sync: bool
    apple_last_modified: Optional[str] = None  # ISO format datetime string
    message: str


class PlaylistTracksRequest(BaseModel):
    appleMusicId: str
    globalId: Optional[str] = None
    cookies: str


class PlaylistTrackItem(BaseModel):
    position: int
    appleMusicId: str
    title: str
    artistName: str
    albumName: Optional[str] = None
    durationMs: Optional[int] = None


class PlaylistTracksResponse(BaseModel):
    tracks: list[PlaylistTrackItem]
    count: int
    lastModifiedDate: Optional[str] = None


@app.post("/playlist-tracks", response_model=PlaylistTracksResponse)
async def get_playlist_tracks(request: PlaylistTracksRequest):
    """Get all tracks for a playlist from Apple Music API."""
    try:
        api = await get_or_create_api(request.cookies)
        
        # Prefer globalId for fetching
        fetch_id = request.globalId or request.appleMusicId
        is_library = fetch_id.startswith(("p.", "i.", "l."))
        
        if is_library:
            playlist_data = await api.get_library_playlist(fetch_id)
        else:
            playlist_data = await api.get_playlist(fetch_id)
        
        if not playlist_data:
            return PlaylistTracksResponse(tracks=[], count=0)
        
        if isinstance(playlist_data, dict) and 'data' in playlist_data:
            playlist_data = playlist_data['data'][0] if playlist_data['data'] else None
        
        if not playlist_data:
            return PlaylistTracksResponse(tracks=[], count=0)
        
        attrs = playlist_data.get("attributes", {})
        rels = playlist_data.get("relationships", {})
        tracks_data = rels.get("tracks", {}).get("data", [])
        
        tracks = []
        for i, track in enumerate(tracks_data):
            track_attrs = track.get("attributes", {})
            tracks.append(PlaylistTrackItem(
                position=i,
                appleMusicId=track.get("id", ""),
                title=track_attrs.get("name", "Unknown"),
                artistName=track_attrs.get("artistName", "Unknown"),
                albumName=track_attrs.get("albumName"),
                durationMs=track_attrs.get("durationInMillis"),
            ))
        
        return PlaylistTracksResponse(
            tracks=tracks,
            count=len(tracks),
            lastModifiedDate=attrs.get("lastModifiedDate")
        )
        
    except Exception as e:
        print(f"Error fetching playlist tracks: {e}", flush=True)
        return PlaylistTracksResponse(tracks=[], count=0)


@app.post("/check-playlist-sync", response_model=CheckSyncResponse)
async def check_playlist_sync(request: CheckSyncRequest):
    """Check if a playlist needs to be synced by comparing lastModifiedDate."""
    try:
        if not request.cookies or not request.cookies.strip():
            return CheckSyncResponse(
                needs_sync=False,
                message="No cookies provided"
            )
        
        apple_music_api = await get_or_create_api(request.cookies)
        
        # Determine if this is a library playlist
        is_library = request.playlist_id.startswith(("p.", "i.", "l."))
        
        try:
            if is_library:
                playlist_data = await apple_music_api.get_library_playlist(request.playlist_id)
            else:
                playlist_data = await apple_music_api.get_playlist(request.playlist_id)
            
            if not playlist_data:
                return CheckSyncResponse(
                    needs_sync=False,
                    message="Playlist not found on Apple Music"
                )
            
            # Extract data from response
            if isinstance(playlist_data, dict) and 'data' in playlist_data:
                data_list = playlist_data.get('data', [])
                if data_list and len(data_list) > 0:
                    playlist_data = data_list[0]
            
            attrs = playlist_data.get("attributes", {}) if isinstance(playlist_data, dict) else {}
            
            # Get lastModifiedDate from Apple Music
            apple_last_modified = attrs.get("lastModifiedDate")
            
            if not apple_last_modified:
                return CheckSyncResponse(
                    needs_sync=False,
                    message="No lastModifiedDate in Apple Music response"
                )
            
            # Compare with local version
            if not request.local_last_modified:
                # No local date means we've never synced, so we need to sync
                return CheckSyncResponse(
                    needs_sync=True,
                    apple_last_modified=apple_last_modified,
                    message="No local sync date, needs initial sync"
                )
            
            # Parse and compare dates
            from dateutil import parser
            try:
                apple_date = parser.isoparse(apple_last_modified)
                local_date = parser.isoparse(request.local_last_modified)
                
                if apple_date > local_date:
                    return CheckSyncResponse(
                        needs_sync=True,
                        apple_last_modified=apple_last_modified,
                        message=f"Apple Music playlist was modified ({apple_date}) after local sync ({local_date})"
                    )
                else:
                    return CheckSyncResponse(
                        needs_sync=False,
                        apple_last_modified=apple_last_modified,
                        message="Playlist is up to date"
                    )
            except Exception as parse_err:
                print(f"Error parsing dates: {parse_err}")
                return CheckSyncResponse(
                    needs_sync=True,
                    apple_last_modified=apple_last_modified,
                    message="Could not parse dates, recommending sync"
                )
                
        except Exception as e:
            print(f"Error fetching playlist for sync check: {e}")
            return CheckSyncResponse(
                needs_sync=False,
                message=f"Error fetching playlist: {str(e)}"
            )
            
    except Exception as e:
        print(f"Sync check error: {e}")
        return CheckSyncResponse(
            needs_sync=False,
            message=f"Error: {str(e)}"
        )

@app.post("/reconfigure-scheduler")
async def reconfigure_scheduler():
    """Reconfigure the background sync scheduler based on current database settings."""
    await configure_sync_scheduler()
    return {"message": "Scheduler reconfigured"}


@app.post("/trigger-sync-check")
async def trigger_sync_check():
    """Manually trigger a sync check for all synced playlists."""
    await run_sync_check()
    return {"message": "Sync check triggered"}


async def run_download_bg(request: DownloadRequest):
    """Run download in background by consuming the generator."""
    print(f"[BG] Starting background download for {request.url}", flush=True)
    try:
        async for _ in download_song(request):
            pass  # Just execute the generator
    except Exception as e:
        print(f"[BG] Error in background download: {e}", flush=True)
        traceback.print_exc()

@app.post("/download")
async def download_endpoint(request: DownloadRequest, background_tasks: BackgroundTasks):
    """
    Start download in background.
    Events will be broadcast via WebSocket.
    """
    print(f"[API] Received download request for: {request.url}", flush=True)
    
    # Start background task
    background_tasks.add_task(run_download_bg, request)
    
    return {
        "status": "started",
        "message": "Download started in background",
        "url": request.url
    }

# The original content of `start_download` and `event_generator` is moved here
# and adapted to be a generator function `download_song`.
async def download_song(request: DownloadRequest):
    """Start a download job and stream progress via SSE."""
    print("[DEBUG] download_song() called - starting...", flush=True)
    cookies_path = None
    try:
        # Create temporary cookies file
        cookies_path = await create_temp_cookies_file(request.cookies)
        print(f"[DEBUG] Cookies file created at: {cookies_path}", flush=True)

        
        # Yield initial event
        yield {
            "event": "started",
            "data": json.dumps({"status": "initializing", "message": "Starting download..."}),
        }
        print("[DEBUG] Yielded 'started' event", flush=True)
        
        # Import gamdl components
        try:
            from gamdl.api import AppleMusicApi, ItunesApi
            from gamdl.downloader import (
                AppleMusicDownloader,
                AppleMusicBaseDownloader,
                AppleMusicSongDownloader,
                AppleMusicMusicVideoDownloader,
                AppleMusicUploadedVideoDownloader,
            )
            from gamdl.interface import (
                AppleMusicInterface,
                AppleMusicSongInterface,
                AppleMusicMusicVideoInterface,
                AppleMusicUploadedVideoInterface,
            )
            from gamdl.interface.enums import SongCodec, SyncedLyricsFormat
            from gamdl.downloader.enums import CoverFormat
        except ImportError as e:
            yield {
                "event": "error",
                "data": json.dumps({"message": f"gamdl not installed: {e}"}),
            }
            return
        
        # Initialize gamdl API (use cached if available)
        print("[DEBUG] Starting download - getting API...", flush=True)
        yield {
            "event": "progress",
            "data": json.dumps({"percent": 5, "message": "Initializing Apple Music API..."}),
        }
        
        try:
            # Use the cached API to avoid 30-60s initialization delay
            print("[DEBUG] Using get_or_create_api with cookies...", flush=True)
            apple_music_api = await get_or_create_api(request.cookies)
            print("[DEBUG] AppleMusicApi obtained!", flush=True)
            
            itunes_api = ItunesApi(
                apple_music_api.storefront,
                apple_music_api.language,
            )
        except Exception as e:
            print(f"[DEBUG] API initialization failed: {e}", flush=True)
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Failed to initialize API: {e}"}),
            }
            return
        
        # Check subscription
        if not apple_music_api.active_subscription:
            yield {
                "event": "error",
                "data": json.dumps({"message": "No active Apple Music subscription found"}),
            }
            return
        
        yield {
            "event": "progress",
            "data": json.dumps({"percent": 10, "message": "API initialized, fetching content..."}),
        }
        
        # Set up interfaces and downloader
        interface = AppleMusicInterface(apple_music_api, itunes_api)
        song_interface = AppleMusicSongInterface(interface)
        
        base_downloader = AppleMusicBaseDownloader(
            wvd_path=str(WVD_PATH) if WVD_PATH.exists() else None,
            output_path=Path(request.output_path),
            temp_path=Path(tempfile.gettempdir()),
            overwrite=request.overwrite,
            save_cover=request.save_cover,
            cover_size=request.cover_size,
            cover_format=CoverFormat.JPG,
        )
        
        # Parse comma-separated codec list, use first as primary
        codec_list = [c.strip() for c in request.song_codecs.split(',') if c.strip()]
        if not codec_list:
            codec_list = ['aac-legacy']
        primary_codec = codec_list[0]
        print(f"[DEBUG] Requested codecs: {codec_list}, primary: {primary_codec}", flush=True)
        
        # Convert string settings to enums
        codec_enum = SongCodec(primary_codec)
        lyrics_format_enum = SyncedLyricsFormat(request.lyrics_format) if request.lyrics_format != "none" else None
        
        song_downloader = AppleMusicSongDownloader(
            base_downloader=base_downloader,
            interface=song_interface,
            codec=codec_enum,
            synced_lyrics_format=lyrics_format_enum if lyrics_format_enum else SyncedLyricsFormat.LRC,
            no_synced_lyrics=(request.lyrics_format == "none"),
        )
        
        # Create video interfaces and downloaders (required by AppleMusicDownloader)
        music_video_interface = AppleMusicMusicVideoInterface(interface)
        uploaded_video_interface = AppleMusicUploadedVideoInterface(interface)
        
        music_video_downloader = AppleMusicMusicVideoDownloader(
            base_downloader=base_downloader,
            interface=music_video_interface,
        )
        
        uploaded_video_downloader = AppleMusicUploadedVideoDownloader(
            base_downloader=base_downloader,
            interface=uploaded_video_interface,
        )
        
        downloader = AppleMusicDownloader(
            interface=interface,
            base_downloader=base_downloader,
            song_downloader=song_downloader,
            music_video_downloader=music_video_downloader,
            uploaded_video_downloader=uploaded_video_downloader,
        )
        print("[DEBUG] AppleMusicDownloader created successfully")
        
        # Get download queue
        print(f"[DEBUG] Getting URL info for: {request.url}")
        url_info = downloader.get_url_info(request.url)
        if not url_info:
            print("[DEBUG] Failed to parse URL")
            yield {
                "event": "error",
                "data": json.dumps({"message": "Failed to parse URL"}),
            }
            return
        
        print(f"[DEBUG] URL info: {url_info}")
        print("[DEBUG] Getting download queue...")
        download_queue = await downloader.get_download_queue(url_info)
        if not download_queue:
            print("[DEBUG] No downloadable content found")
            yield {
                "event": "error",
                "data": json.dumps({"message": "No downloadable content found"}),
            }
            return
        
        print(f"[DEBUG] Download queue has {len(download_queue)} items")
        total_tracks = len(download_queue)
        
        # Fetch extended album metadata from API
        album_metadata = {}
        url_parsed = parse_apple_music_url(request.url)
        content_id = url_parsed.get("id") or url_parsed.get("track_id")
        content_type = url_parsed.get("type")
        is_library = content_id and content_id.startswith(("l.", "p.", "i."))
        
        if content_id and content_type in ("album", "song"):
            # For songs, we need to get the album ID from the song data
            if content_type == "song":
                try:
                    # Get song data to find album ID
                    song_data = await apple_music_api.get_song(content_id)
                    if song_data:
                        if isinstance(song_data, dict) and 'data' in song_data:
                            data_list = song_data.get('data', [])
                            if data_list:
                                song_data = data_list[0]
                        
                        # Extract album ID from relationships
                        relationships = song_data.get("relationships", {})
                        albums = relationships.get("albums", {}).get("data", [])
                        if albums and len(albums) > 0:
                            album_id = albums[0].get("id")
                            if album_id:
                                print(f"[DEBUG] Song's album ID: {album_id}")
                                album_metadata = await extract_album_metadata_from_api(
                                    apple_music_api, album_id, False
                                )
                except Exception as e:
                    print(f"[DEBUG] Error getting album for song: {e}")
            else:
                # For albums, use the content ID directly
                album_metadata = await extract_album_metadata_from_api(
                    apple_music_api, content_id, is_library
                )
        
        yield {
            "event": "queue_ready",
            "data": json.dumps({
                "total_tracks": total_tracks,
                "type": url_info.type if hasattr(url_info, "type") else "unknown",
            }),
        }
        
        # Download each track
        completed = 0
        print(f"[DEBUG] Starting download loop for {total_tracks} tracks...", flush=True)
        for i, download_item in enumerate(download_queue):
            try:
                print(f"[DEBUG] Processing track {i + 1}/{total_tracks}", flush=True)
                yield {
                    "event": "track_starting",
                    "data": json.dumps({
                        "current": i + 1,
                        "total": total_tracks,
                        "percent": int(10 + (80 * i / total_tracks)),
                    }),
                }
                
                # Broadcast download_started to WebSocket clients
                track_info = extract_track_info_for_ws(download_item)
                asyncio.create_task(broadcast_ws_event("download_started", {
                    "track_id": track_info["track_id"],
                    "title": track_info["title"],
                    "artist": track_info["artist"],
                    "album": track_info["album"],
                    "current": i + 1,
                    "total": total_tracks,
                    "codecs": codec_list, # Add codecs list
                }))
                
                # Check if this is a private library track (user-uploaded, not in catalog)
                # A track is private if:
                # 1. It has a library ID (starts with i.)
                # 2. AND it has NO catalog ID (no catalogId in playParams, or empty catalog relationship)
                content_id = download_item.media_metadata.get("id")
                attributes = download_item.media_metadata.get("attributes", {})
                play_params = attributes.get("playParams", {})
                catalog_id = play_params.get("catalogId")
                
                # Also check the catalog relationship for mapped tracks
                relationships = download_item.media_metadata.get("relationships", {})
                catalog_data = relationships.get("catalog", {}).get("data", [])
                
                is_library_track = content_id and content_id.startswith("i.")
                has_catalog_mapping = bool(catalog_id) or len(catalog_data) > 0
                is_private_library_track = is_library_track and not has_catalog_mapping
                
                if is_private_library_track:
                    # Private library tracks use direct blobstore download (unencrypted)
                    print(f"[DEBUG] Track {i+1}: Private library track detected ({content_id}), no catalog mapping, using blobstore download", flush=True)
                    
                    try:
                        result = await download_private_library_track(
                            api=apple_music_api,
                            library_id=content_id,
                            output_path=Path(request.output_path)
                        )
                        
                        if result:
                            final_path = result["file_path"]
                            meta = result["metadata"]
                            
                            # Get file size for display
                            file_size = Path(final_path).stat().st_size if Path(final_path).exists() else 0
                            
                            # Broadcast codec completion with file size
                            asyncio.create_task(broadcast_ws_event("download_codec_complete", {
                                "track_id": content_id,
                                "codec": "private-library",
                                "path": final_path,
                                "success": True,
                                "total_bytes": file_size,
                                "bytes": file_size,  # Already complete
                            }))
                            
                            # Broadcast download_complete to WebSocket clients (same as catalog tracks)
                            # This is what triggers the frontend to import the track to the database
                            asyncio.create_task(broadcast_ws_event("download_complete", {
                                "track_id": content_id,
                                "title": meta.get("title", "Unknown"),
                                "artist": meta.get("artist", "Unknown"),
                                "album": meta.get("album", "Unknown"),
                                "file_path": final_path,
                                "file_size": file_size,
                                "codec_paths": {"private-library": final_path},
                                "lyrics_path": None,
                                "cover_path": None,
                                "metadata": {
                                    "title": meta.get("title", "Unknown"),
                                    "artist": meta.get("artist", "Unknown"),
                                    "album": meta.get("album", "Unknown"),
                                    "duration": meta.get("duration_ms", 0) / 1000.0,
                                    "trackNumber": meta.get("track_number"),
                                    "discNumber": meta.get("disc_number"),
                                    "genre": meta.get("genre"),
                                    "appleMusicId": content_id,
                                    "isPrivateLibrary": True,
                                },
                                "current": i + 1,
                                "total": total_tracks,
                            }))
                            
                            # Yield track complete event (for SSE stream if used)
                            completed += 1
                            track_complete_data = {
                                "filePath": final_path,
                                "codecPaths": {"private-library": final_path},
                                "metadata": {
                                    "title": meta.get("title", "Unknown"),
                                    "artist": meta.get("artist", "Unknown"),
                                    "album": meta.get("album", "Unknown"),
                                    "duration": meta.get("duration_ms", 0) / 1000.0,
                                    "trackNumber": meta.get("track_number"),
                                    "discNumber": meta.get("disc_number"),
                                    "genre": meta.get("genre"),
                                    "appleMusicId": content_id,
                                    "isPrivateLibrary": True,
                                },
                                "current": i + 1,
                                "total": total_tracks,
                            }
                            print(f"[DEBUG] 📤 Broadcast download_complete for private track: {meta.get('title')}", flush=True)
                            yield {
                                "event": "track_complete",
                                "data": json.dumps(track_complete_data),
                            }
                            
                            print(f"[DEBUG] ✅ Private track {i+1} complete: {meta.get('title')}", flush=True)
                            continue  # Skip the standard codec-based download loop
                        else:
                            print(f"[DEBUG] ❌ Failed to download private track {content_id}", flush=True)
                            yield {
                                "event": "track_error",
                                "data": json.dumps({
                                    "current": i + 1,
                                    "total": total_tracks,
                                    "error": f"Failed to download private library track {content_id}",
                                }),
                            }
                            continue  # Skip to next track
                    except Exception as private_err:
                        print(f"[DEBUG] ❌ Error downloading private track: {private_err}", flush=True)
                        yield {
                            "event": "track_error",
                            "data": json.dumps({
                                "current": i + 1,
                                "total": total_tracks,
                                "error": str(private_err),
                            }),
                        }
                        continue
                
                # For albums/playlists: Check per-track codec availability
                # This filters the requested codecs to only those actually available for this track
                track_codec_list = codec_list  # Default to full list
                try:
                    content_id = download_item.media_metadata.get("id")
                    if content_id and len(codec_list) > 1:  # Only check if multiple codecs requested
                        webplayback = await apple_music_api.get_webplayback(content_id)
                        if webplayback:
                            attrs = download_item.media_metadata.get("attributes", {})
                            available_codecs = parse_webplayback_codecs(webplayback, attrs)
                            # Filter to only requested codecs that are available
                            track_codec_list = [c for c in codec_list if c in available_codecs]
                            if not track_codec_list:
                                # Fallback to first requested codec if none match
                                track_codec_list = [codec_list[0]]
                                print(f"[DEBUG] Track {i+1}: No requested codecs available, falling back to {track_codec_list[0]}", flush=True)
                            elif len(track_codec_list) < len(codec_list):
                                skipped = set(codec_list) - set(track_codec_list)
                                print(f"[DEBUG] Track {i+1}: Skipping unavailable codecs: {skipped}", flush=True)
                except Exception as wp_e:
                    print(f"[DEBUG] Track {i+1}: Could not check codec availability, using all: {wp_e}", flush=True)
                
                # Perform download for each codec IN PARALLEL
                print(f"[DEBUG] Processing codecs: {track_codec_list} for track {i + 1} (PARALLEL)...", flush=True)
                
                import copy
                import shutil
                import uuid
                request_id = str(uuid.uuid4())[:8]
                primary_file_path = None
                primary_download_item = download_item
                codec_paths_map = {}
                
                # Create a PRISTINE copy of download_item BEFORE any downloads
                # This ensures gamdl-path downloads get unmodified stream_info
                pristine_download_item = copy.deepcopy(download_item)
                
                # Define async function for downloading a single codec
                async def download_single_codec(codec_idx: int, codec_name: str):
                    """Download a single codec and return (codec_name, final_path or None, error or None)"""
                    # Note: Uses pristine_download_item from closure (immutable reference)
                    try:
                        # Use a specific staging directory for this codec to prevent collisions
                        # and allow us to rename before moving to final destination
                        staging_dir = Path(tempfile.gettempdir()) / f"gamdl_stage_{request_id}_{i}_{codec_name}"
                        staging_dir.mkdir(parents=True, exist_ok=True)
                        
                        print(f"[DEBUG] Staging download for {codec_name} in: {staging_dir}", flush=True)
                        
                        # Re-initialize downloaders with staging output path
                        # Use staging_dir for both output and temp to avoid confusion/mkdirs issues
                        use_wrapper_for_codec = is_wrapper_required(codec_name)
                        c_base_dl = AppleMusicBaseDownloader(
                            wvd_path=str(WVD_PATH) if WVD_PATH.exists() else None,
                            output_path=staging_dir, # Download to staging first
                            temp_path=staging_dir,   # Use staging dir as temp root
                            overwrite=True, # Always overwrite in staging
                            save_cover=request.save_cover and (codec_idx == 0), # Only save cover once
                            cover_size=request.cover_size,
                            cover_format=CoverFormat.JPG,
                            use_wrapper=use_wrapper_for_codec,
                        )
                        
                        # Route Hi-Res/Spatial codecs (alac, atmos, etc.) to wrapper
                        # Standard codecs (aac-legacy, aac-he-legacy) use gamdl native
                        if use_wrapper_for_codec:
                            c_song_dl = WrapperSongDownloader(
                                base_downloader=c_base_dl,
                                interface=song_interface,
                                codec=SongCodec(codec_name),
                                synced_lyrics_format=lyrics_format_enum if lyrics_format_enum else SyncedLyricsFormat.LRC,
                                no_synced_lyrics=True, # Custom logic handles lyrics
                            )
                        else:
                            # Create a COMPLETELY FRESH interface chain for each gamdl-path download
                            # to avoid shared state corruption between sequential downloads
                            # The APIs cache track format info that gets modified after download
                            fresh_itunes_api = ItunesApi(
                                apple_music_api.storefront,
                                apple_music_api.language,
                            )
                            fresh_interface = AppleMusicInterface(apple_music_api, fresh_itunes_api)
                            fresh_song_interface = AppleMusicSongInterface(fresh_interface)
                            c_song_dl = AppleMusicSongDownloader(
                                base_downloader=c_base_dl,
                                interface=fresh_song_interface,
                                codec=SongCodec(codec_name),
                                synced_lyrics_format=lyrics_format_enum if lyrics_format_enum else SyncedLyricsFormat.LRC,
                                no_synced_lyrics=True, # Custom logic handles lyrics
                            )
                        
                        c_mv_dl = AppleMusicMusicVideoDownloader(base_downloader=c_base_dl, interface=music_video_interface)
                        c_uv_dl = AppleMusicUploadedVideoDownloader(base_downloader=c_base_dl, interface=uploaded_video_interface)
                        
                        c_downloader = AppleMusicDownloader(
                            interface=interface,
                            base_downloader=c_base_dl,
                            song_downloader=c_song_dl,
                            music_video_downloader=c_mv_dl,
                            uploaded_video_downloader=c_uv_dl,
                        )
                        
                        # Clone from PRISTINE copy to avoid mutations from parallel downloads
                        c_item = copy.deepcopy(pristine_download_item)
                        
                        # Regenerate random_uuid using the per-codec downloader
                        c_item.random_uuid = c_base_dl.get_random_uuid()
                        # Note: stream_info clearing for non-primary codecs is handled later at line ~3289
                        if c_item.stream_info and c_item.stream_info.file_format:
                            c_item.staged_path = c_base_dl.get_temp_path(
                                c_item.media_metadata["id"],
                                c_item.random_uuid,
                                "staged",
                                "." + c_item.stream_info.file_format.value,
                            )
                        else:
                            # Fallback for when stream_info is not available
                            c_item.staged_path = c_base_dl.get_temp_path(
                                c_item.media_metadata["id"],
                                c_item.random_uuid,
                                "staged",
                                ".m4a",
                            )
                        
                        print(f"[DEBUG] Downloading {codec_name}...", flush=True)

                        # Broadcast specific codec start event
                        asyncio.create_task(broadcast_ws_event("download_codec_started", {
                            "track_id": track_info["track_id"],
                            "codec": codec_name,
                            "current": i + 1
                        }))
                        
                        # For wrapper codecs, bypass gamdl's AppleMusicDownloader.download()
                        # which expects an external amdecrypt executable.
                        # Instead, call WrapperSongDownloader.download() directly
                        # which uses our Python amdecrypt.py module.
                        if use_wrapper_for_codec:
                            # Get the current event loop for thread-safe callback
                            main_loop = asyncio.get_running_loop()
                            
                            # Use a mutable container for last update time to keep state in closure
                            progress_state = {"last_update": 0.0}
                            
                            # Create progress callback for WebSocket broadcast
                            # This callback is called from a thread (via asyncio.to_thread)
                            # so we need to use run_coroutine_threadsafe instead of create_task
                            def wrapper_progress_callback(stage, current, total, bytes_done, speed):
                                import time
                                
                                # Rate limit updates to max 2 per second (every 500ms)
                                # Always send if complete (bytes_done == total) or first update
                                now = time.time()
                                is_complete = (total > 0 and bytes_done >= total)
                                if not is_complete and (now - progress_state["last_update"] < 0.5):
                                    return
                                    
                                progress_state["last_update"] = now

                                # Calculate ETA
                                if speed > 0 and total > 0 and bytes_done < total:
                                    remaining_bytes = total - bytes_done
                                    eta_seconds = remaining_bytes / speed
                                else:
                                    eta_seconds = 0
                                
                                # Use thread-safe coroutine scheduling
                                asyncio.run_coroutine_threadsafe(
                                    broadcast_ws_event("download_progress", {
                                        "track_id": track_info["track_id"],
                                        "title": track_info["title"],
                                        "artist": track_info["artist"],
                                        "stage": stage,  # 'download' or 'decrypt'
                                        "progress_pct": int((current / total * 100) if total > 0 else 0),
                                        "bytes": bytes_done,
                                        "total_bytes": total,
                                        "speed": speed,  # bytes/sec
                                        "eta_seconds": eta_seconds,
                                        "current": i + 1,
                                        "total": total_tracks,
                                        "codec": codec_name,  # Add codec info
                                        "codecs": codec_list  # Add full codec list for context
                                    }),
                                    main_loop
                                )
                            
                            wrapper_result = await c_song_dl.download(c_item, progress_callback=wrapper_progress_callback)
                            # WrapperSongDownloader.download() returns the final Path directly
                            if wrapper_result:
                                c_item.final_path = str(wrapper_result)
                            
                            c_result = c_item
                        else:
                            # Create a FRESH DownloadItem for this specific codec
                            # The song_downloader (c_song_dl) is configured with the correct codec
                            # so get_single_download_item_no_filter will fetch correct stream_info
                            fresh_item = await c_downloader.get_single_download_item_no_filter(
                                c_item.media_metadata,
                                c_item.playlist_metadata,
                            )
                            
                            if fresh_item.error:
                                raise fresh_item.error
                            
                            # Override paths to use our staging directory
                            if hasattr(c_item, "final_path") and c_item.final_path:
                                original_path = Path(c_item.final_path)
                                try:
                                    rel_path = original_path.relative_to(Path(request.output_path))
                                    fresh_item.final_path = str(staging_dir / rel_path)
                                except ValueError:
                                    fresh_item.final_path = str(staging_dir / original_path.name)

                            c_result = await c_downloader.download(fresh_item)
                            
                            # Native downloads don't have fine-grained progress callbacks yet
                            # So we manually send a "complete" progress event
                            native_file_size = 0
                            try:
                                # Try to get size from final path if available, or staging dir
                                if c_result and hasattr(c_result, "final_path") and c_result.final_path:
                                    if os.path.exists(c_result.final_path):
                                        native_file_size = os.path.getsize(c_result.final_path)
                                    # If not at final path yet (because we move it later), check staging_dir
                                    # But wait, c_result.final_path IS inside staging_dir at this point (line 3263)
                                    # So it should be there.
                            except Exception as e:
                                print(f"[WARN] Could not determine native file size: {e}")

                            asyncio.create_task(broadcast_ws_event("download_progress", {
                                "track_id": track_info["track_id"],
                                "title": track_info["title"],
                                "artist": track_info["artist"],
                                "stage": "download",
                                "progress_pct": 100,
                                "bytes": native_file_size,
                                "total_bytes": native_file_size,
                                "speed": 0,
                                "eta_seconds": 0,
                                "current": i + 1,
                                "total": total_tracks,
                                "codec": codec_name
                            }))
                        
                        # Move files from staging to final destination preserving structure
                        final_path_for_codec = None
                        if c_result and hasattr(c_result, "final_path") and c_result.final_path:
                            found_audio = False
                            for root, dirs, files in os.walk(staging_dir):
                                for file in files:
                                    src_path = Path(root) / file
                                    rel_path = src_path.relative_to(staging_dir)
                                    
                                    # Modify filename if audio - add [codec]
                                    # Lyrics/Cover keep original name (no codec tag)
                                    if src_path.suffix.lower() in ['.m4a', '.mp4', '.m4b', '.mov', '.m4v']:
                                        new_name = f"{src_path.stem} [{codec_name}]{src_path.suffix}"
                                        dest_rel_path = rel_path.parent / new_name
                                        
                                        # Record this as the main file for this codec
                                        final_dest = Path(request.output_path) / dest_rel_path
                                        final_path_for_codec = str(final_dest)
                                        found_audio = True
                                    else:
                                        # Lyrics, Cover, etc. - keep original name
                                        dest_rel_path = rel_path
                                        final_dest = Path(request.output_path) / dest_rel_path

                                    final_dest.parent.mkdir(parents=True, exist_ok=True)
                                    
                                    if final_dest.exists() and request.overwrite:
                                        final_dest.unlink()
                                    
                                    if not final_dest.exists():
                                        shutil.move(str(src_path), str(final_dest))
                                        print(f"[DEBUG] Moved {file} to: {final_dest}", flush=True)
                            
                            if not found_audio:
                                final_path_for_codec = None
                        
                        return (codec_name, final_path_for_codec, None)
                        
                    except Exception as dl_err:
                        print(f"[ERROR] Failed to download {codec_name} for track {i+1}: {dl_err}", flush=True)
                        return (codec_name, None, str(dl_err))
                # HYBRID EXECUTION: 
                # - Wrapper-path codecs run in parallel (independent HTTP calls)
                # - Gamdl-path codecs run sequentially (share interface state)
                # - BOTH groups start CONCURRENTLY
                wrapper_codecs = [c for c in track_codec_list if is_wrapper_required(c)]
                gamdl_codecs = [c for c in track_codec_list if not is_wrapper_required(c)]
                
                print(f"[DEBUG] Wrapper codecs (parallel): {wrapper_codecs}", flush=True)
                print(f"[DEBUG] Gamdl codecs (sequential): {gamdl_codecs}", flush=True)
                
                # Helper coroutine to run gamdl codecs sequentially
                async def run_gamdl_sequential():
                    """Run gamdl codecs one-by-one to avoid interface state corruption"""
                    results = []
                    for idx, codec in enumerate(gamdl_codecs):
                        # Add delay between gamdl downloads to let interface state settle
                        if idx > 0:
                            await asyncio.sleep(0.5)  # 500ms delay between gamdl codecs
                        result = await download_single_codec(track_codec_list.index(codec), codec)
                        results.append(result)
                    return results
                
                # Run BOTH groups concurrently:
                # - Wrapper codecs: each runs in parallel with others
                # - Gamdl codecs: run sequentially, but the group starts alongside wrapper
                wrapper_tasks = [
                    download_single_codec(track_codec_list.index(codec), codec) 
                    for codec in wrapper_codecs
                ]
                
                # Create a single task for the sequential gamdl chain
                gamdl_task = run_gamdl_sequential()
                
                # Run wrapper tasks and gamdl task concurrently
                if wrapper_tasks and gamdl_codecs:
                    # Both groups exist - run them together
                    all_results = await asyncio.gather(*wrapper_tasks, gamdl_task, return_exceptions=True)
                    # Last item is the gamdl results list
                    wrapper_results = all_results[:-1]
                    gamdl_results = all_results[-1] if not isinstance(all_results[-1], Exception) else []
                elif wrapper_tasks:
                    # Only wrapper codecs
                    wrapper_results = await asyncio.gather(*wrapper_tasks, return_exceptions=True)
                    gamdl_results = []
                elif gamdl_codecs:
                    # Only gamdl codecs
                    wrapper_results = []
                    gamdl_results = await gamdl_task
                else:
                    wrapper_results = []
                    gamdl_results = []
                
                # Combine results
                codec_results = list(wrapper_results) + (gamdl_results if isinstance(gamdl_results, list) else [])
                
                # Process results
                for result in codec_results:
                    if isinstance(result, Exception):
                        print(f"[ERROR] Unexpected exception in parallel codec download: {result}", flush=True)
                        continue
                    
                    codec_name, final_path, error = result
                    
                    if final_path:
                        codec_paths_map[codec_name] = final_path
                        if not primary_file_path:
                            primary_file_path = final_path
                            download_item.final_path = final_path
                    
                    # Broadcast codec completion
                    asyncio.create_task(broadcast_ws_event("download_codec_complete", {
                        "track_id": track_info["track_id"],
                        "codec": codec_name,
                        "success": final_path is not None
                    }))
                
                if primary_file_path:
                    file_path = primary_file_path
                    result = primary_download_item # Use original item (updated) for subsequent logic
                    
                    # Extract metadata from download_item (API data, not file tags)
                    try:
                        metadata = extract_metadata_from_download_item(download_item, file_path)
                    except Exception as e:
                        print(f"Metadata extraction failed: {e}")
                        metadata = {}

                    # ... (Rest of logic continues using 'file_path' variable)
                    
                    # Extract Apple Music IDs from download_item
                    apple_ids = extract_apple_music_ids_from_item(download_item)
                    metadata.update(apple_ids)
                    
                    # Merge album-level metadata from API
                    metadata.update(album_metadata)
                    
                    # Find lyrics file if it exists (in final output path)
                    lyrics_path = None
                    lyrics_type = None
                    
                    # Map lyrics format from request
                    lyric_target_exists = False
                    if request.lyrics_format != "none":
                        # Check for lyrics file with same base name as the primary file
                        # Since we renamed the audio file, the lyrics might not match if they were moved blindly
                        # But we moved extras.
                        # Standard gamdl naming for lyrics matches audio filename base.
                        # Since we renamed audio to "Title [Codec]", we need to check if lyrics were renamed?
                        # No, we moved extras "as is" or with original name.
                        # If we moved "Title.lrc", it won't match "Title [Codec].m4a".
                        # This is a small issue. We should rename lyrics to match the primary audio file?
                        # Or just look for "Title.lrc".
                        pass
                        
                    # Re-implement lyrics discovery based on Primary File Path stem
                    # If primary file is "Title [Codec].m4a", we look for "Title [Codec].lrc"?
                    # Or just "Title.lrc"?
                    # The code below uses Path(file_path).with_suffix().
                    # So it looks for "Title [Codec].lrc".
                    # But we saved "Title.lrc" (probably).
                    
                    # We should rename the lyrics file to match the primary audio file if we want them associated.
                    
                        # Calculate clean base path for lyrics (without codec tags)
                        try:
                            # Calculate clean base path for lyrics (without codec tags)
                            stem = Path(file_path).stem
                            clean_stem = stem
                            if " [" in stem and stem.endswith("]"):
                                import re
                                clean_stem = re.sub(r" \[[^\]]+\]$", "", stem)
                            
                            clean_path = Path(file_path).parent / clean_stem
                            clean_lrc = clean_path.with_suffix(f".{request.lyrics_format}")
                            
                            potential_lrc = Path(file_path).with_suffix(f".{request.lyrics_format}")
                            
                            if clean_lrc.exists():
                                lyrics_path = str(clean_lrc)
                            elif potential_lrc.exists():
                                lyrics_path = str(potential_lrc)
                        except Exception as e:
                            print(f"[WARNING] Error determining clean lyrics path: {e}", flush=True)
                        
                        # Try to get word-by-word lyrics if we have the song's Apple Music ID
                        # Note: extract_apple_music_ids_from_item returns 'appleMusicId' for songs
                        song_apple_id = apple_ids.get("appleMusicId") or metadata.get("appleMusicId")
                        print(f"[LYRICS] song_apple_id={song_apple_id}, lyrics_format={request.lyrics_format}", flush=True)
                        if song_apple_id and request.lyrics_format != "none":
                            try:
                                # Get translation languages from settings
                                translation_langs = getattr(request, 'lyrics_translation_langs', '').split(',')
                                translation_langs = [l.strip() for l in translation_langs if l.strip()]
                                
                                # Fetch all lyrics variants using the new comprehensive function
                                lyrics_variants = await fetch_all_lyrics_variants(
                                    apple_music_api,
                                    song_apple_id,
                                    translation_langs,
                                    storefront=apple_music_api.storefront
                                )
                                
                                # Store audioLocale
                                if lyrics_variants["audio_locale"]:
                                    metadata["audioLocale"] = lyrics_variants["audio_locale"]
                                
                                # Save original lyrics
                                if lyrics_variants["original"] and lyrics_variants["original"].get("ttml"):
                                    ttml_path = clean_path.with_suffix(".ttml")
                                    ttml_path.write_text(lyrics_variants["original"]["ttml"], encoding="utf-8")
                                    lyrics_path = str(ttml_path)
                                    metadata["lyricsHasWordSync"] = lyrics_variants["original"].get("has_word_timing", False)
                                    print(f"[LYRICS] Saved original lyrics to {lyrics_path}", flush=True)
                                
                                # Save translations as separate files and track paths
                                translation_paths = {}
                                for lang, ttml_content in lyrics_variants["translations"].items():
                                    trans_path = clean_path.with_suffix(f".{lang}.ttml")
                                    trans_path.write_text(ttml_content, encoding="utf-8")
                                    translation_paths[lang] = str(trans_path)
                                    print(f"[LYRICS] Saved {lang} translation to {trans_path}", flush=True)
                                
                                if translation_paths:
                                    metadata["lyricsTranslations"] = json.dumps(translation_paths)
                                
                                # Save romanization (if separate file, not embedded)
                                if lyrics_variants["romanization"] and lyrics_variants["romanization"] != "embedded":
                                    script = lyrics_variants["romanization_script"]
                                    roman_path = clean_path.with_suffix(f".{script}.ttml")
                                    roman_path.write_text(lyrics_variants["romanization"], encoding="utf-8")
                                    metadata["lyricsPronunciations"] = json.dumps({script: str(roman_path)})
                                    print(f"[LYRICS] Saved romanization ({script}) to {roman_path}", flush=True)
                                elif lyrics_variants["romanization"] == "embedded":
                                    # Romanization is embedded in original TTML, just record the script
                                    script = lyrics_variants["romanization_script"]
                                    metadata["lyricsPronunciations"] = json.dumps({script: "embedded"})
                                    print(f"[LYRICS] Romanization ({script}) is embedded in original", flush=True)
                                
                            except Exception as lyrics_err:
                                import traceback
                                print(f"[LYRICS] Error fetching lyrics: {lyrics_err}", flush=True)
                                traceback.print_exc()
                    
                    # Find lyrics file - heuristic: check for .lrc with same base name (ignoring [Codec])
                    # or just check specific patterns since we moved them "as is"
                    if not lyrics_path and request.lyrics_format != "none":
                        # Try to find matching lyrics file
                        # Since we renamed audio to "Title [Codec].m4a", the lyrics are likely "Title.lrc"
                        # We can try to guess "Title.lrc" by stripping " [Codec]"
                        # But better: just pass the lyrics path if we found it in the loop?
                        # For simplicity, let's look for the .lrc file corresponding to the *renamed* file first (unlikely)
                        # then the base name.
                        
                        base_stem = Path(file_path).stem
                        # Try stripping known codec suffixes
                        for c_name in codec_list:
                            if f" [{c_name}]" in base_stem:
                                base_stem = base_stem.replace(f" [{c_name}]", "")
                        
                        potential_lrc_base = Path(file_path).parent / f"{base_stem}.{request.lyrics_format}"
                        if potential_lrc_base.exists():
                            lyrics_path = str(potential_lrc_base)
                        else:
                            # Try exact match (rare if we renamed)
                            potential_lrc_exact = Path(file_path).with_suffix(f".{request.lyrics_format}")
                            if potential_lrc_exact.exists():
                                lyrics_path = str(potential_lrc_exact)
                    
                    # Find cover file
                    cover_path = None
                    if request.save_cover:
                        potential_cover = Path(file_path).parent / "cover.jpg"
                        if potential_cover.exists():
                            cover_path = str(potential_cover)

                    # Download animated cover if available (only once per album)
                    animated_cover_path = None
                    animated_cover_small_path = None
                    animated_cover_url = album_metadata.get("animatedCoverUrl")
                    if animated_cover_url and i == 0:  # Only download for first track
                        try:
                            output_dir = Path(file_path).parent
                            animated_paths = await download_animated_cover(
                                animated_cover_url, output_dir, 
                                album_metadata.get("albumAppleMusicId", "unknown")
                            )
                            if animated_paths:
                                animated_cover_path = animated_paths.get("full")
                                animated_cover_small_path = animated_paths.get("small")
                        except Exception as e:
                            print(f"[ANIMATED COVER] Failed to download: {e}", flush=True)
                    elif animated_cover_url and i > 0:
                        # For subsequent tracks, check if animated cover already exists
                        # Check for GIF first (current format), then MP4 (legacy fallback)
                        potential_animated_gif = Path(file_path).parent / "cover-animated.gif"
                        potential_animated_mp4 = Path(file_path).parent / "cover-animated.mp4"
                        potential_animated_small_gif = Path(file_path).parent / "cover-animated-small.gif"
                        potential_animated_small_mp4 = Path(file_path).parent / "cover-animated-small.mp4"
                        
                        if potential_animated_gif.exists():
                            animated_cover_path = str(potential_animated_gif)
                        elif potential_animated_mp4.exists():
                            animated_cover_path = str(potential_animated_mp4)
                            
                        if potential_animated_small_gif.exists():
                            animated_cover_small_path = str(potential_animated_small_gif)
                        elif potential_animated_small_mp4.exists():
                            animated_cover_small_path = str(potential_animated_small_mp4)

                    yield {
                        "event": "track_complete",
                        "data": json.dumps({
                            "codec_paths": codec_paths_map, # Include the map of all downloaded files
                            "codecPaths": codec_paths_map,  # Redundant key for TS compatibility to ensure frontend receives the full map
                            "filePath": file_path,
                            # removed duplicate codecPaths key that was overwriting the map
                            "lyricsPath": lyrics_path,
                            "coverPath": cover_path,
                            "animatedCoverPath": animated_cover_path,
                            "animatedCoverSmallPath": animated_cover_small_path,
                            "metadata": metadata,
                            "current": i + 1,
                            "total": total_tracks,
                        }),
                    }
                    
                    # Broadcast download_complete to WebSocket clients
                    file_size = Path(file_path).stat().st_size if Path(file_path).exists() else 0
                    asyncio.create_task(broadcast_ws_event("download_complete", {
                        "track_id": track_info["track_id"],
                        "title": metadata.get("title", track_info["title"]),
                        "artist": metadata.get("artist", track_info["artist"]),
                        "album": metadata.get("album", track_info["album"]),
                        "file_path": file_path,
                        "file_size": file_size,
                        "codec_paths": codec_paths_map,
                        "lyrics_path": lyrics_path,
                        "cover_path": cover_path,
                        "metadata": metadata,
                        "current": i + 1,
                        "total": total_tracks,
                    }))
                    
                    completed += 1
                else:
                    yield {
                        "event": "track_error",
                        "data": json.dumps({
                            "current": i + 1,
                            "total": total_tracks,
                            "message": "Download returned no result",
                        }),
                    }
                    
                    # Broadcast download_failed to WebSocket clients
                    asyncio.create_task(broadcast_ws_event("download_failed", {
                        "track_id": track_info["track_id"],
                        "title": track_info["title"],
                        "artist": track_info["artist"],
                        "album": track_info["album"],
                        "error": "Download returned no result",
                        "current": i + 1,
                        "total": total_tracks,
                    }))
                    
            except Exception as e:
                error_str = str(e)
                print(f"[DEBUG] Track {i + 1} error: {e}", flush=True)
                
                # Special handling for "MediaFileExists" - treat as success
                # Extract path from error message and use existing file
                if "already exists at path:" in error_str:
                    try:
                        # Extract file path from error message
                        file_path = error_str.split("already exists at path:")[-1].strip()
                        print(f"[DEBUG] File exists, treating as success: {file_path}", flush=True)
                        
                        # Extract metadata from download_item (API data, not file tags)
                        metadata = extract_metadata_from_download_item(download_item, file_path)
                        
                        # Extract Apple Music IDs from download_item (we still have it from the loop)
                        apple_ids = extract_apple_music_ids_from_item(download_item)
                        metadata.update(apple_ids)
                        
                        metadata.update(album_metadata)
                        
                        # Find associated files
                        lyrics_path = None
                        if request.lyrics_format != "none":
                            potential_lrc = Path(file_path).with_suffix(f".{request.lyrics_format}")
                            if potential_lrc.exists():
                                lyrics_path = str(potential_lrc)
                        
                        cover_path = None
                        if request.save_cover:
                            potential_cover = Path(file_path).parent / "cover.jpg"
                            if potential_cover.exists():
                                cover_path = str(potential_cover)
                        
                        yield {
                            "event": "track_complete",
                            "data": json.dumps({
                                "filePath": file_path,
                                "codecPaths": {primary_codec: file_path},  # Store codec -> path mapping
                                "lyricsPath": lyrics_path,
                                "coverPath": cover_path,
                                "metadata": metadata,
                                "current": i + 1,
                                "total": total_tracks,
                            }),
                        }
                        
                        # Broadcast download_skipped to WebSocket clients (file already exists)
                        asyncio.create_task(broadcast_ws_event("download_skipped", {
                            "track_id": track_info["track_id"] if 'track_info' in dir() else None,
                            "title": metadata.get("title", "Unknown"),
                            "artist": metadata.get("artist", "Unknown Artist"),
                            "album": metadata.get("album", "Unknown Album"),
                            "file_path": file_path,
                            "reason": "File already exists",
                            "current": i + 1,
                            "total": total_tracks,
                        }))
                        
                        completed += 1
                        continue
                    except Exception as extract_err:
                        print(f"[DEBUG] Failed to extract metadata from existing file: {extract_err}", flush=True)
                
                import traceback
                traceback.print_exc()
                yield {
                    "event": "track_error",
                    "data": json.dumps({
                        "current": i + 1,
                        "total": total_tracks,
                        "message": error_str,
                    }),
                }
                
                # Broadcast download_failed to WebSocket clients
                asyncio.create_task(broadcast_ws_event("download_failed", {
                    "track_id": track_info["track_id"] if 'track_info' in dir() else None,
                    "title": track_info["title"] if 'track_info' in dir() else "Unknown",
                    "artist": track_info["artist"] if 'track_info' in dir() else "Unknown Artist",
                    "album": track_info["album"] if 'track_info' in dir() else "Unknown Album",
                    "error": error_str,
                    "current": i + 1,
                    "total": total_tracks,
                }))
        
        # Check for M3U8 playlist file
        if url_info.type == "playlist" if hasattr(url_info, "type") else False:
            # gamdl generates M3U8 with --save-playlist flag
            # The path typically follows the playlist name
            yield {
                "event": "playlist_complete",
                "data": json.dumps({
                    "completed_tracks": completed,
                    "total_tracks": total_tracks,
                }),
            }
        
        yield {
            "event": "complete",
            "data": json.dumps({
                "status": "success",
                "completed": completed,
                "total": total_tracks,
            }),
        }
        
        # Broadcast queue_update to WebSocket clients with final stats
        skipped = total_tracks - completed  # Approximate - includes both skipped and failed
        asyncio.create_task(broadcast_ws_event("queue_update", {
            "queued": 0,
            "completed": completed,
            "skipped": skipped,
            "failed": 0,  # We don't track separately, so use 0
            "total_bytes": 0,  # Would need to sum file sizes
        }))
        
    except Exception as e:
        traceback.print_exc()
        yield {
            "event": "error",
            "data": json.dumps({"message": str(e)}),
        }
    finally:
        # Clean up temporary cookies file
        if cookies_path and os.path.exists(cookies_path):
            try:
                os.unlink(cookies_path)
            except Exception:
                pass



# --- Wrapper Auth Endpoints ---

class WrapperAuthSubmitRequest(BaseModel):
    type: str  # "credentials" or "otp"
    username: Optional[str] = None
    password: Optional[str] = None
    code: Optional[str] = None

@app.get("/wrapper/status")
async def get_wrapper_status():
    """Get wrapper container and auth status."""
    mgr = get_wrapper_manager()
    docker_ok, image_ok, msg = mgr.get_availability()
    
    return {
        "docker_available": docker_ok,
        "image_available": image_ok,
        "has_saved_session": mgr.has_saved_session() if docker_ok and image_ok else False,
        "is_running": mgr.is_running() if docker_ok and image_ok else False,
        "needs_auth": docker_ok and image_ok and mgr.is_running() and not mgr.has_saved_session(),
        "message": msg
    }

@app.post("/wrapper/auth/submit")
async def submit_wrapper_auth(request: WrapperAuthSubmitRequest):
    """Submit credentials or OTP to the wrapper auth socket."""
    global _wrapper_auth_socket
    
    mgr = get_wrapper_manager()
    
    # Connect to auth socket if not already connected
    if _wrapper_auth_socket is None:
        if not mgr.connect_auth_socket(timeout=5.0):
            raise HTTPException(status_code=500, detail="Failed to connect to wrapper auth socket")
        _wrapper_auth_socket = mgr._auth_socket
    
    try:
        if request.type == "credentials":
            if not request.username or not request.password:
                raise HTTPException(status_code=400, detail="Missing username or password")
            success = mgr.submit_credentials(request.username, request.password)
        elif request.type == "otp":
            if not request.code or len(request.code) != 6:
                raise HTTPException(status_code=400, detail="Invalid OTP code")
            success = mgr.submit_otp(request.code)
        else:
            raise HTTPException(status_code=400, detail="Unknown type")
        
        if success:
            return {"status": "submitted"}
        else:
            raise HTTPException(status_code=500, detail="Failed to send to wrapper")
    except Exception as e:
        print(f"[WRAPPER AUTH] Error: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/wrapper/auth/stream")
async def wrapper_auth_stream():
    """SSE stream for wrapper auth messages."""
    mgr = get_wrapper_manager()
    
    async def event_generator():
        global _wrapper_auth_socket
        
        # Connect to auth socket
        max_retries = 20
        for i in range(max_retries):
            if mgr.connect_auth_socket(timeout=2.0):
                _wrapper_auth_socket = mgr._auth_socket
                break
            await asyncio.sleep(0.5)
        else:
            yield {"data": json.dumps({"type": "error", "message": "Failed to connect to auth socket"})}
            return
        
        # Read messages and yield them as SSE events
        while True:
            try:
                # Use run_in_executor for blocking socket read
                msg = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: mgr._recv_auth_message(timeout=60.0)
                )
                if msg:
                    yield {"data": json.dumps(msg)}
                    if msg.get("type") in ["auth_success", "auth_failed"]:
                        break
            except Exception as e:
                print(f"[WRAPPER AUTH STREAM] Error: {e}", flush=True)
                yield {"data": json.dumps({"type": "error", "message": str(e)})}
                break
            await asyncio.sleep(0.1)
    
    return EventSourceResponse(event_generator())


# --- Main Entry Point ---


if __name__ == "__main__":
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser(description="gamdl Service")
    parser.add_argument("--production", action="store_true", help="Run in production mode")
    parser.add_argument("--port", type=int, default=5100, help="Port to run on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()
    
    uvicorn.run(
        "gamdl_service:app",
        host=args.host,
        port=args.port,
        reload=not args.production,
        log_level="info",
    )
