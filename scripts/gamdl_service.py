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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import websockets
# Use websockets.serve directly to avoid deprecation warning

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
        cursor.execute("SELECT outputPath, songCodec, lyricsFormat FROM GamdlSettings WHERE id = 'singleton'")
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
        
        # Download each missing track
        for track_id in track_ids:
            try:
                # Build song URL (song IDs are numeric)
                if track_id.startswith("i."):
                    # Library track - need to get catalog ID
                    continue  # Skip library-only tracks for now
                
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
        
        # Get all synced playlists with their local track count
        cursor.execute("""
            SELECT p.id, p.name, p.appleMusicId, p.appleLastModifiedDate, 
                   (SELECT COUNT(*) FROM PlaylistTrack pt WHERE pt.playlistId = p.id) as trackCount
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
        
        # Get local track IDs for all playlists in one query for efficiency
        cursor.execute("""
            SELECT pt.playlistId, t.appleMusicId, pt.position
            FROM PlaylistTrack pt 
            JOIN Track t ON pt.trackId = t.id 
            WHERE pt.playlistId IN (SELECT id FROM Playlist WHERE isSynced = 1)
            ORDER BY pt.playlistId, pt.position
        """)
        local_tracks_all = cursor.fetchall()
        
        # Group by playlist
        local_playlist_tracks = {}
        for playlist_id, apple_id, position in local_tracks_all:
            if playlist_id not in local_playlist_tracks:
                local_playlist_tracks[playlist_id] = []
            local_playlist_tracks[playlist_id].append((apple_id, position))
        
        # Also fetch local playlist name, description, and artwork URL
        cursor.execute("SELECT id, name, description, artworkUrl FROM Playlist WHERE isSynced = 1")
        local_metadata = {row[0]: (row[1], row[2], row[3]) for row in cursor.fetchall()}
        
        # Don't close connection yet - we may need it for auto_sync
        
        needs_sync = []
        sync_reasons = {}  # Track why each playlist needs sync
        
        for playlist_id, name, apple_music_id, local_modified, local_track_count in playlists:
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
                
                # Get local track IDs in order
                local_tracks = local_playlist_tracks.get(playlist_id, [])
                local_track_ids = [t[0] for t in sorted(local_tracks, key=lambda x: x[1]) if t[0]]
                
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
                
                # Debug: show comparison
                print(f"[SYNC DEBUG] '{name}': remote={len(remote_track_ids)}, in library={len(syncable_remote_ids)}, in playlist={len(local_track_ids)}, pending_dl={len(pending_download_ids)}", flush=True)
                
                # Log the actual IDs to diagnose mismatches
                if pending_download_ids:
                    print(f"[SYNC DEBUG] '{name}' pending_download IDs: {pending_download_ids}", flush=True)
                    print(f"[SYNC DEBUG] '{name}' remote IDs: {remote_track_ids}", flush=True)
                    print(f"[SYNC DEBUG] '{name}' library matched IDs: {list(library_track_ids)}", flush=True)
                
                if syncable_remote_ids != local_track_ids:
                    print(f"[SYNC DEBUG] '{name}' syncable_remote: {syncable_remote_ids[:3]}...", flush=True)
                    print(f"[SYNC DEBUG] '{name}' local_playlist: {local_track_ids[:3]}...", flush=True)
                
                # IMPORTANT: Also trigger sync if there are pending downloads!
                # We need to download these tracks even if syncable tracks match local
                has_pending_downloads = len(pending_download_ids) > 0
                
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
                        "remote_artwork_url": remote_artwork_url
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
            
            # Retry logic for timeout errors
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    await get_or_create_api(cookies)
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
        else:
            print("[PREWARM] No cookies configured, skipping API pre-warm", flush=True)
    except Exception as e:
        print(f"[PREWARM] ⚠️ Pre-warm failed (non-critical): {e}", flush=True)


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
    song_codec: str = "aac-legacy"
    lyrics_format: str = "lrc"
    cover_size: int = 1200
    save_cover: bool = True
    language: str = "en-US"
    overwrite: bool = False


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
    """Extract extended album metadata from Apple Music API."""
    try:
        if is_library:
            album_data = await apple_music_api.get_library_album(content_id)
        else:
            album_data = await apple_music_api.get_album(content_id)
        
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
        }
    except Exception as e:
        print(f"Error extracting album metadata from API: {e}")
        return {}


# --- API Endpoints ---


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        gamdl_version=get_gamdl_version(),
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    )


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


@app.post("/download")
async def start_download(request: DownloadRequest):
    """Start a download job and stream progress via SSE."""
    
    async def event_generator():
        print("[DEBUG] event_generator() called - starting...", flush=True)
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
                output_path=Path(request.output_path),
                temp_path=Path(tempfile.gettempdir()),
                overwrite=request.overwrite,
                save_cover=request.save_cover,
                cover_size=request.cover_size,
                cover_format=CoverFormat.JPG,
            )
            
            # Convert string settings to enums
            codec_enum = SongCodec(request.song_codec)
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
                    
                    # Perform download
                    print(f"[DEBUG] Calling downloader.download() for track {i + 1}...", flush=True)
                    result = await downloader.download(download_item)
                    print(f"[DEBUG] Download result for track {i + 1}: {result}", flush=True)
                    
                    if result and hasattr(result, "final_path") and result.final_path:
                        file_path = str(result.final_path)
                        
                        # Extract metadata from downloaded file
                        metadata = extract_metadata_from_file(file_path)
                        
                        # Extract Apple Music IDs from download_item
                        apple_ids = extract_apple_music_ids_from_item(download_item)
                        metadata.update(apple_ids)
                        
                        # Merge album-level metadata from API
                        metadata.update(album_metadata)
                        
                        # Find lyrics file if it exists
                        lyrics_path = None
                        if request.lyrics_format != "none":
                            potential_lrc = Path(file_path).with_suffix(f".{request.lyrics_format}")
                            if potential_lrc.exists():
                                lyrics_path = str(potential_lrc)
                        
                        # Find cover file
                        cover_path = None
                        if request.save_cover:
                            potential_cover = Path(file_path).parent / "cover.jpg"
                            if potential_cover.exists():
                                cover_path = str(potential_cover)
                        
                        yield {
                            "event": "track_complete",
                            "data": json.dumps({
                                "filePath": file_path,
                                "lyricsPath": lyrics_path,
                                "coverPath": cover_path,
                                "metadata": metadata,
                                "current": i + 1,
                                "total": total_tracks,
                            }),
                        }
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
                            
                            # Extract metadata from existing file
                            metadata = extract_metadata_from_file(file_path)
                            
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
                                    "lyricsPath": lyrics_path,
                                    "coverPath": cover_path,
                                    "metadata": metadata,
                                    "current": i + 1,
                                    "total": total_tracks,
                                }),
                            }
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
    
    print("[DEBUG] Creating EventSourceResponse...", flush=True)
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
