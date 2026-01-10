#!/usr/bin/env python3
"""
Script to refetch and regenerate artist metadata for all artists with valid Apple Music IDs.
This will update bio, origin, birth date, hero media, etc.
"""

import asyncio
import sqlite3
import sys
import tempfile
from pathlib import Path

# Add the scripts directory to path for gamdl imports
sys.path.insert(0, str(Path(__file__).parent))


async def refetch_artist_metadata():
    """Refetch metadata for all artists with Apple Music IDs."""

    db_path = Path(__file__).parent.parent / "library.db"
    print(f"[REFETCH] Database: {db_path}")

    # Get all artists with Apple Music IDs
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, name, appleMusicId
        FROM Artist
        WHERE appleMusicId IS NOT NULL AND appleMusicId != ''
    """)
    artists = cursor.fetchall()

    # Get cookies
    cursor.execute("SELECT cookies, mediaLibraryPath FROM GamdlSettings WHERE id = 'singleton'")
    settings = cursor.fetchone()
    conn.close()

    if not settings or not settings[0]:
        print("[ERROR] No cookies found in database. Please configure cookies in settings.")
        return

    cookies_str = settings[0]
    media_library_path = Path(settings[1]) if settings[1] else Path("./music")
    if not media_library_path.is_absolute():
        media_library_path = Path(__file__).parent.parent / media_library_path

    print(f"[REFETCH] Found {len(artists)} artists with Apple Music IDs")
    print(f"[REFETCH] Media library path: {media_library_path}")
    print()

    if len(artists) == 0:
        print("[REFETCH] No artists to process.")
        return

    # Initialize gamdl API
    from gamdl.api import AppleMusicApi

    print("[REFETCH] Initializing Apple Music API...")
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(cookies_str)
        cookies_path = f.name

    try:
        api = await AppleMusicApi.create_from_netscape_cookies(cookies_path)
        print(f"[REFETCH] API initialized. Storefront: {api.storefront}")
    finally:
        import os
        os.unlink(cookies_path)

    print()

    # Import helper functions
    from gamdl_service import download_artist_hero_media, transform_artwork_url
    from gamdl.utils import safe_json

    success_count = 0
    error_count = 0

    for i, (artist_id, artist_name, apple_music_id) in enumerate(artists, 1):
        print(f"[{i}/{len(artists)}] Processing: {artist_name} (ID: {apple_music_id})")

        try:
            # Fetch artist data from Apple Music API
            url = f"https://amp-api.music.apple.com/v1/catalog/{api.storefront}/artists/{apple_music_id}"
            params = {
                "include": "albums,music-videos",
                "extend": "artistBio,bornOrFormed,editorialArtwork,editorialVideo,hero,isGroup,origin,plainEditorialNotes",
                "limit[albums]": 100,
                "limit[music-videos]": 100,
            }

            response = await api.client.get(url, params=params)

            if response.status_code != 200:
                print(f"  [ERROR] API returned {response.status_code}")
                error_count += 1
                continue

            data = safe_json(response)

            if not data or "data" not in data or len(data["data"]) == 0:
                print(f"  [ERROR] No data in response")
                error_count += 1
                continue

            attrs = data["data"][0].get("attributes", {})

            # Extract metadata
            bio = attrs.get("artistBio")
            if not bio:
                editorial_notes = attrs.get("editorialNotes") or {}
                bio = editorial_notes.get("standard") or editorial_notes.get("short")

            plain_editorial_notes = attrs.get("plainEditorialNotes") or attrs.get("artistBio")
            genre_names = attrs.get("genreNames", [])
            genre = genre_names[0] if genre_names else None
            artwork = attrs.get("artwork", {})
            artwork_url = transform_artwork_url(artwork.get("url"), 1200) if artwork.get("url") else None
            origin = attrs.get("origin")
            birth_date = attrs.get("bornOrFormed") or attrs.get("birthDate")
            is_group = attrs.get("isGroup")
            url_attr = attrs.get("url")

            print(f"  Bio: {'Yes' if bio else 'No'} | Origin: {origin or 'N/A'} | Born/Formed: {birth_date or 'N/A'}")

            # Download hero media
            print(f"  Downloading hero media...")
            hero_paths = await download_artist_hero_media(artist_name, attrs, media_library_path)

            hero_animated = hero_paths.get("heroAnimatedPath")
            hero_static = hero_paths.get("heroStaticPath")
            profile_image = hero_paths.get("profileImagePath")

            print(f"  Hero: animated={'Yes' if hero_animated else 'No'}, static={'Yes' if hero_static else 'No'}, profile={'Yes' if profile_image else 'No'}")

            # Update database
            update_conn = sqlite3.connect(db_path)
            update_cursor = update_conn.cursor()

            update_cursor.execute("""
                UPDATE Artist SET
                    bio = ?,
                    plainEditorialNotes = ?,
                    genre = ?,
                    artworkUrl = ?,
                    origin = ?,
                    birthDate = ?,
                    isGroup = ?,
                    url = ?,
                    heroAnimatedPath = COALESCE(?, heroAnimatedPath),
                    heroStaticPath = COALESCE(?, heroStaticPath),
                    profileImagePath = COALESCE(?, profileImagePath),
                    lastFetchedAt = datetime('now'),
                    updatedAt = datetime('now')
                WHERE id = ?
            """, (
                bio,
                plain_editorial_notes,
                genre,
                artwork_url,
                origin,
                birth_date,
                is_group,
                url_attr,
                hero_animated,
                hero_static,
                profile_image,
                artist_id
            ))

            update_conn.commit()
            update_conn.close()

            print(f"  [OK] Updated successfully")
            success_count += 1

        except Exception as e:
            print(f"  [ERROR] {e}")
            error_count += 1

        print()

    print("=" * 60)
    print(f"[REFETCH] Complete!")
    print(f"  Success: {success_count}")
    print(f"  Errors:  {error_count}")
    print(f"  Total:   {len(artists)}")


if __name__ == "__main__":
    asyncio.run(refetch_artist_metadata())
