
import asyncio
import sys
import re
import logging
from pathlib import Path
from http.cookiejar import MozillaCookieJar
import httpx

# Mock setup
logger = logging.getLogger("debug")
logging.basicConfig(level=logging.INFO)

AMP_API_URL = "https://amp-api.music.apple.com"
APPLE_MUSIC_COOKIE_DOMAIN = ".apple.com"
APPLE_MUSIC_HOMEPAGE_URL = "https://music.apple.com"

class AppleMusicApi:
    def __init__(self, media_user_token=None, developer_token=None, language="en-US"):
        self.media_user_token = media_user_token
        self.token = developer_token
        self.language = language
        self.client = None

    @classmethod
    async def create_from_netscape_cookies(cls, cookies_path: str):
        cookies = MozillaCookieJar(cookies_path)
        cookies.load(ignore_discard=True, ignore_expires=True)
        print(f"Loaded {len(cookies)} cookies. Keys: {[c.name for c in cookies]}")
        parse_cookie = lambda name: next(
            (c.value for c in cookies if c.name == name and c.domain == APPLE_MUSIC_COOKIE_DOMAIN),
            None
        )
        media_user_token = parse_cookie("media-user-token")
        
        instance = cls(media_user_token=media_user_token)
        await instance.initialize()
        return instance

    async def initialize(self):
        self.client = httpx.AsyncClient(
            headers={
                "origin": APPLE_MUSIC_HOMEPAGE_URL,
                "referer": APPLE_MUSIC_HOMEPAGE_URL,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            params={"l": self.language},
            follow_redirects=True
        )
        self.token = await self._get_token()
        self.client.headers.update({"authorization": f"Bearer {self.token}"})
        if self.media_user_token:
            self.client.cookies.update({"media-user-token": self.media_user_token})

    async def _get_token(self) -> str:
        response = await self.client.get(APPLE_MUSIC_HOMEPAGE_URL)
        home_page = response.text
        index_js_uri_match = re.search(r"/(assets/index-legacy[~-][^/\"]+\.js)", home_page)
        if not index_js_uri_match:
             # Try alternate regex for newer versions
             index_js_uri_match = re.search(r"/(assets/index-[^/\"]+\.js)", home_page)
             if not index_js_uri_match:
                raise Exception("index.js URI not found")
        
        index_js_uri = index_js_uri_match.group(1)
        response = await self.client.get(f"{APPLE_MUSIC_HOMEPAGE_URL}/{index_js_uri}")
        index_js_page = response.text
        token_match = re.search('(?=eyJh)(.*?)(?=")', index_js_page)
        if not token_match:
            raise Exception("Token not found")
        return token_match.group(1)

    async def get_album(self, album_id: str):
        # Apply storefront
        storefront = "it" 
        url = f"{AMP_API_URL}/v1/catalog/{storefront}/albums/{album_id}"
        print(f"Requesting {url}")
        response = await self.client.get(url, params={"extend": "extendedAssetUrls"})
        if response.status_code != 200:
            print(f"API Error: {response.status_code} {response.text}")
            return None
        return response.json()

def get_animated_cover_url(album_attrs: dict) -> str | None:
    editorial_video = album_attrs.get("editorialVideo", {})
    if not editorial_video:
        print(f"[DEBUG] No editorialVideo field")
        return None
    
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
            print(f"[DEBUG] Found variant: {variant}")
            return video_url
    return None

async def main():
    script_dir = Path(__file__).parent
    cookies_path = Path("/media/sn0wst0rm/megaDrive/musica/cookies.txt")
    if not cookies_path.exists():
        print(f"Cookies not found at {cookies_path}")
        return

    print("Initializing API...")
    try:
        api = await AppleMusicApi.create_from_netscape_cookies(str(cookies_path))
    except Exception as e:
        print(f"Failed to init API: {e}")
        import traceback
        traceback.print_exc()
        return

    album_id = "1508562310"  # Dreamland (Correct ID from DB)
    print(f"Fetching album {album_id}...")
    
    album_data = await api.get_album(album_id)
    if not album_data or not album_data.get("data"):
        print("Album not found or empty data")
        if album_data: print(album_data)
        return

    attrs = album_data["data"][0]["attributes"]
    m3u8_url = get_animated_cover_url(attrs)
    
    if not m3u8_url:
        print("No animated cover URL found")
        return

    print(f"Fetching HLS playlist: {m3u8_url}")
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(m3u8_url)
        content = resp.text
        
        print("--- HLS Playlist Content ---")
        durations = []
        for line in content.splitlines():
            if line.startswith("#EXTINF:"):
                try:
                    dur_str = line.replace("#EXTINF:", "").replace(",", "")
                    durations.append(float(dur_str))
                except:
                    pass
        
        print(f"Total segments: {len(durations)}")
        print(f"Segment durations: {durations}")
        
        if "#EXT-X-STREAM-INF" in content:
            print("This is a Master Playlist. Fetching all variants...")
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if line.startswith("#EXT-X-STREAM-INF"):
                    print(f"Variant Info: {line}")
                    if i+1 < len(lines):
                        variant_url = lines[i+1].strip()
                        if not variant_url.startswith("http"):
                             base_url = m3u8_url.rsplit('/', 1)[0]
                             variant_url = f"{base_url}/{variant_url}"
                        
                        print(f"Fetching variant: {variant_url}")
                        try:
                            resp_var = await client.get(variant_url)
                            var_content = resp_var.text
                            
                            var_durations = []
                            for vline in var_content.splitlines():
                                 if vline.startswith("#EXTINF:"):
                                    try:
                                        dur_str = vline.replace("#EXTINF:", "").replace(",", "")
                                        var_durations.append(float(dur_str))
                                    except:
                                        pass
                            print(f"Variant Segments ({len(var_durations)}): {var_durations}")
                            print(f"Total Duration: {sum(var_durations)}")
                            print("-" * 20)
                        except Exception as e:
                            print(f"Failed to fetch variant: {e}")

if __name__ == "__main__":
    asyncio.run(main())
