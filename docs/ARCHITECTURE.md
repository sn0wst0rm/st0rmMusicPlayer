# st0rmMusic Architecture

This document explains the architecture of st0rmMusic, a full-stack music player and Apple Music download system.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Frontend (Next.js)                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Library View │  │ Import View  │  │ Artist/Album │  │ Player + Lyrics  │ │
│  │ (Songs/etc)  │  │ (Downloads)  │  │ Detail Views │  │ + Queue Sidebar  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
│                                    │                                        │
│                   ┌────────────────┴────────────────┐                       │
│                   │     Zustand Store (Global)      │                       │
│                   │  • Player state                 │                       │
│                   │  • Download queue               │                       │
│                   │  • UI state                     │                       │
│                   └─────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    HTTP REST + WebSocket (port 3000)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Custom Node.js Server (server.ts)                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ WebSocket Proxy: /ws → localhost:5101                                │   │
│  │ HTTP: Next.js request handler                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                         WebSocket (port 5101)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        gamdl_service.py (FastAPI)                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ • Download orchestration        • Apple Music API integration        │   │
│  │ • WebSocket event broadcasting  • Playlist sync scheduling           │   │
│  │ • Codec routing                 • Metadata extraction                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────┐    │
│  │     Widevine Path               │ │     FairPlay Path               │    │
│  │  (aac-legacy, aac-he-legacy)    │ │  (alac, atmos, aac, etc.)       │    │
│  │                                 │ │                                 │    │
│  │  ┌───────────────────────────┐  │ │  ┌───────────────────────────┐  │    │
│  │  │     gamdl library         │  │ │  │  WrapperSongDownloader    │  │    │
│  │  │  • Native Widevine DRM    │  │ │  │  (wrapper_downloader.py)  │  │    │
│  │  │  • Direct decryption      │  │ │  │                           │  │    │
│  │  └───────────────────────────┘  │ │  │  ┌─────────────────────┐  │  │    │
│  │                                 │ │  │  │  WrapperClient      │  │  │    │
│  │                                 │ │  │  │  (TCP sockets)      │  │  │    │
│  │                                 │ │  │  └─────────────────────┘  │  │    │
│  │                                 │ │  │           │               │  │    │
│  │                                 │ │  │           ▼               │  │    │
│  │                                 │ │  │  ┌─────────────────────┐  │  │    │
│  │                                 │ │  │  │  amdecrypt.py       │  │  │    │
│  │                                 │ │  │  │  (CBCS decryption)  │  │  │    │
│  │                                 │ │  │  └─────────────────────┘  │  │    │
│  │                                 │ │  └───────────────────────────┘  │    │
│  └─────────────────────────────────┘ └─────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                              │
                                    TCP Sockets (10020, 20020, 40020)
                                              │
                                              ▼
                               ┌─────────────────────────────────────┐
                               │         Wrapper (Docker)            │
                               │                                     │
                               │  Port 10020: Decrypt service        │
                               │  Port 20020: M3U8 service           │
                               │  Port 30020: Account service        │
                               │  Port 40020: Auth service           │
                               │                                     │
                               │  • FairPlay key retrieval           │
                               │  • CBCS sample decryption           │
                               │  • Apple ID authentication          │
                               └─────────────────────────────────────┘
```

## Technology Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| Next.js 16 | React framework with App Router |
| TypeScript | Type safety |
| Tailwind CSS | Styling |
| Radix UI | Accessible component primitives |
| Zustand | Global state management |
| Framer Motion | Animations |
| dnd-kit | Drag-and-drop functionality |

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | Python REST/WebSocket server |
| Prisma | Database ORM (SQLite) |
| gamdl | Apple Music download library |
| mutagen | Audio metadata handling |
| APScheduler | Playlist sync scheduling |

## File Structure

### Core Application
```
src/
├── app/                    # Next.js pages and API routes
│   ├── api/               # REST API endpoints
│   │   ├── import/        # Download/import endpoints
│   │   ├── stream/        # Audio streaming
│   │   ├── lyrics/        # Lyrics fetching
│   │   ├── playlists/     # Playlist management
│   │   ├── wrapper/       # Wrapper auth/control
│   │   └── ...
│   ├── album/[id]/        # Album detail page
│   ├── artist/[id]/       # Artist detail page
│   ├── playlist/[id]/     # Playlist page
│   └── ...
├── components/
│   ├── views/             # Page-level view components
│   ├── ui/                # Reusable UI components
│   ├── player.tsx         # Audio player
│   ├── lyrics-sidebar.tsx # Synchronized lyrics
│   ├── queue-sidebar.tsx  # Playback queue
│   └── DownloadManager.tsx # WebSocket download tracking
└── lib/
    ├── store.ts           # Zustand store
    └── utils.ts           # Utility functions
```

### Python Backend
```
scripts/
├── gamdl_service.py       # Main FastAPI service
├── wrapper_manager.py     # Docker container lifecycle
├── wrapper_client.py      # TCP socket communication
├── wrapper_downloader.py  # Encrypted download handler
├── amdecrypt.py          # FairPlay CBCS decryption
├── db.py                 # Database utilities
└── venv/                 # Python virtual environment
```

## Codec Support

| Codec | DRM Type | Handler | Wrapper Required |
|-------|----------|---------|------------------|
| aac-legacy | Widevine | gamdl native | No |
| aac-he-legacy | Widevine | gamdl native | No |
| alac | FairPlay | WrapperSongDownloader | Yes |
| atmos (EC-3) | FairPlay | WrapperSongDownloader | Yes |
| aac | FairPlay | WrapperSongDownloader | Yes |
| aac-binaural | FairPlay | WrapperSongDownloader | Yes |
| aac-downmix | FairPlay | WrapperSongDownloader | Yes |
| aac-he | FairPlay | WrapperSongDownloader | Yes |
| aac-he-binaural | FairPlay | WrapperSongDownloader | Yes |
| aac-he-downmix | FairPlay | WrapperSongDownloader | Yes |
| ac3 | FairPlay | WrapperSongDownloader | Yes |

## Download Flows

### Widevine Flow (AAC Legacy)
```
User Request → gamdl_service → gamdl library → Widevine → Decrypted M4A
```

### FairPlay Flow (ALAC/Atmos)
```
User Request
    ↓
gamdl_service (codec routing)
    ↓
WrapperSongDownloader
    ↓
WrapperClient.fetch_m3u8_url() → wrapper:20020
    ↓
Download encrypted M4A from CDN
    ↓
amdecrypt.decrypt_file() → wrapper:10020
    ├── Parse fMP4 boxes (moof/mdat)
    ├── Extract encrypted samples
    ├── Send to wrapper for CBCS decryption
    └── Rebuild non-fragmented M4A
    ↓
Apply metadata (mutagen)
    ↓
Decrypted M4A output
```

## WebSocket Events

The frontend connects to `/ws` (proxied to `localhost:5101`) for real-time updates:

```typescript
// Track queued for download
{ type: "download_queued", track_id, title, artist, album, codecs }

// Download started
{ type: "download_started", track_id, title, artist, album, codecs }

// Per-codec progress
{ type: "download_progress", track_id, codec, progress_pct, bytes, speed, stage }

// Codec completed
{ type: "download_codec_complete", track_id, codec, success }

// Track completed
{ type: "download_complete", track_id, file_path, file_size }

// Track skipped (already exists)
{ type: "download_skipped", track_id, reason }

// Error occurred
{ type: "download_failed", track_id, error }
```

## Wrapper Authentication

The wrapper requires Apple ID authentication for FairPlay decryption:

```
┌────────────────┐     SSE Stream      ┌────────────────┐
│    Frontend    │ ◄───────────────────│  gamdl_service │
│  Login Modal   │                     │                │
│                │  POST credentials   │                │
│                │ ────────────────────►                │
└────────────────┘                     └───────┬────────┘
                                               │
                                    Socket (port 40020)
                                               │
                                               ▼
                                    ┌────────────────┐
                                    │    Wrapper     │
                                    │  Auth Service  │
                                    │                │
                                    │ • Apple ID     │
                                    │ • OTP/2FA      │
                                    └────────────────┘
```

**Session Persistence:**
- Wrapper session data stored in `<library_folder>/.am-wrapper/`
- No Apple ID passwords are stored
- Re-authentication only needed if session expires

## Database Schema

### Core Models
- **Artist** - Artist metadata, hero images, bio
- **Album** - Album metadata, cover art (multiple sizes), animated covers
- **Track** - Track metadata, multi-codec file paths, lyrics
- **Playlist** - User playlists with Apple Music sync support
- **PlaylistTrack** - Junction table for playlist ordering

### Configuration
- **GamdlSettings** - Download settings, cookies, sync configuration
- **ImportJob** - Download history and progress tracking

## API Routes

### Import/Download
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/start` | POST | Start download job |
| `/api/import/validate` | POST | Validate Apple Music URL |
| `/api/import/validate-batch` | POST | Validate multiple URLs |
| `/api/import/search` | POST | Search Apple Music catalog |
| `/api/import/settings` | GET/PUT | Manage download settings |

### Playback
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stream/[id]` | GET | Stream audio with codec selection |
| `/api/track/[id]/codecs` | GET/PATCH | Get/set available codecs |
| `/api/lyrics/[trackId]` | GET | Fetch synchronized lyrics |

### Library
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/library` | GET | Full library structure |
| `/api/artist/[id]` | GET | Artist details |
| `/api/scan` | POST | Scan library directory |

### Playlists
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/playlists` | GET/POST | List/create playlists |
| `/api/playlists/[id]` | GET/PATCH/DELETE | Manage playlist |
| `/api/playlists/sync` | POST | Sync with Apple Music |

### Wrapper
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wrapper/status` | GET | Wrapper availability |
| `/api/wrapper/start` | POST | Start wrapper container |
| `/api/wrapper/auth/stream` | GET | SSE auth prompts |
| `/api/wrapper/auth/submit` | POST | Submit credentials/OTP |

## Running the System

### Production
```bash
# Full setup
./setup.sh

# Start application (Next.js + Python service)
npm start
```

### Development
```bash
# Start both services in dev mode
npm run dev
```

### Manual Wrapper Management
```bash
# Check wrapper status
curl http://localhost:3000/api/wrapper/status

# Start wrapper
curl -X POST http://localhost:3000/api/wrapper/start

# Build wrapper Docker image
cd wrapper-fork && docker build -t wrapper .
```

## Data Storage

```
<library_folder>/
├── Artist Name/
│   ├── Album Name/
│   │   ├── 01 Track.m4a                 # Audio file
│   │   ├── 01 Track.alac.m4a            # Lossless variant (if downloaded)
│   │   ├── 01 Track.atmos.m4a           # Atmos variant (if downloaded)
│   │   ├── 01 Track.ttml                # Synced lyrics
│   │   ├── Cover.jpg                    # Album artwork
│   │   ├── cover-animated.mp4           # Animated cover
│   │   ├── cover-animated.gif           # Animated cover
│   │   └── cover-animated-small.gif     # Animated cover
│   └── .metadata/
│       ├── hero.mp4                     # Animated hero video
│       └── profile.jpg                  # Artist image
├── .am-wrapper/                         # Wrapper session data (hidden)
│   └── data/
└── library.db                           # SQLite database (configurable location)
```
