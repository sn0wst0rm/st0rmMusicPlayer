# Download System Architecture

This document explains the architecture of the Apple Music download system.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Import Page  │  │ Download     │  │ Settings         │  │
│  │ (triggers)   │  │ Queue UI     │  │ (codec config)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│           │               ▲                   │              │
│           │               │ WebSocket         │              │
│           ▼               │ events            ▼              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              WebSocket Connection (port 5101)            ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    gamdl_service.py                          │
│                    (FastAPI + WebSocket)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Codec Routing                                         │   │
│  │   aac-legacy, aac-he-legacy → gamdl native (Widevine)│   │
│  │   All other codecs → WrapperSongDownloader (FairPlay)│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────┐            ┌─────────────────────────┐
│   gamdl library     │            │  WrapperSongDownloader  │
│   (Widevine DRM)    │            │  (wrapper_downloader.py)│
│                     │            │                         │
│  • AAC-legacy       │            │  ┌─────────────────────┐│
│  • HE-AAC legacy    │            │  │  WrapperClient      ││
└─────────────────────┘            │  │  (wrapper_client.py)││
                                   │  └─────────────────────┘│
                                   │          │              │
                                   │          ▼              │
                                   │  ┌─────────────────────┐│
                                   │  │  amdecrypt.py       ││
                                   │  │  (FairPlay decrypt) ││
                                   │  └─────────────────────┘│
                                   └─────────────────────────┘
                                             │
                                             ▼
                                   ┌─────────────────────────┐
                                   │  wrapper (Docker)       │
                                   │  ports: 10020, 20020    │
                                   │                         │
                                   │  • M3U8 fetch           │
                                   │  • FairPlay decryption  │
                                   └─────────────────────────┘

## Files

### Core Service
| File | Description |
|------|-------------|
| `gamdl_service.py` | Main FastAPI service, WebSocket handling, download orchestration |
| `db.py` | SQLite database utilities |
| `consts.py` | Constants and configuration |
| `enums.py` | Enumeration definitions |
| `ami.py` | Apple Music API wrapper |

### Wrapper Integration (FairPlay)
| File | Description |
|------|-------------|
| `wrapper_client.py` | TCP client for wrapper service (M3U8 + decrypt ports) |
| `wrapper_downloader.py` | Downloads encrypted M4A, calls amdecrypt for decryption |
| `wrapper_manager.py` | Manages wrapper subprocess lifecycle |
| `amdecrypt.py` | FairPlay CBCS decryption (parses fMP4, decrypts samples) |

### Configuration
| File | Description |
|------|-------------|
| `device.wvd` | Widevine device file for AAC-legacy decryption |
| `requirements.txt` | Python dependencies |
| `setup-venv.sh` | Virtual environment setup script |

## Codec Support

| Codec | DRM | Handler | Wrapper Required |
|-------|-----|---------|------------------|
| aac-legacy | Widevine | gamdl native | ❌ No |
| aac-he-legacy | Widevine | gamdl native | ❌ No |
| alac | FairPlay | WrapperSongDownloader | ✅ Yes |
| atmos (EC-3) | FairPlay | WrapperSongDownloader | ✅ Yes |
| aac, aac-binaural, aac-downmix | FairPlay | WrapperSongDownloader | ✅ Yes |
| aac-he, aac-he-binaural, aac-he-downmix | FairPlay | WrapperSongDownloader | ✅ Yes |

## Download Flow

### 1. AAC-Legacy (No Wrapper)
```
User Request → gamdl_service → gamdl library → Widevine → Decrypted M4A
```

### 2. ALAC/Atmos (Wrapper Required)
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
    └── Rebuild non-fragmented M4A with sample tables
    ↓
Decrypted M4A output
```

## WebSocket Events

The frontend connects to `ws://localhost:5101` for real-time updates:

```typescript
// Download progress events
{ type: "download_started", track_id, title, artist, album }
{ type: "download_progress", track_id, progress_pct, bytes, speed }
{ type: "download_complete", track_id, file_path, file_size }
{ type: "download_skipped", track_id, reason }
{ type: "download_failed", track_id, error }
{ type: "queue_update", queued, completed, skipped, failed }
```

## Running the System

### Automatic Wrapper Startup

When gamdl_service.py starts, it will automatically:

1. **Check Docker availability** - Verify Docker is installed and running
2. **Check wrapper image** - Look for the `wrapper` Docker image
3. **Extract tokens** - Get media_user_token, storefront, dev_token from API/settings
4. **Start container** - Run the wrapper container with proper volume mappings

### Manual Wrapper Management

```bash
# Check wrapper status
curl http://localhost:5000/wrapper/status

# Manually start wrapper
curl -X POST http://localhost:5000/wrapper/start

# Stop wrapper
curl -X POST http://localhost:5000/wrapper/stop
```

### Wrapper Data Location

The wrapper stores its state files (FairPlay keys, device info) in:
```
/media/sn0wst0rm/megaDrive/musica/.am-wrapper/data/
```

This is a hidden folder in the media library root, mapped as a Docker volume.

### Building the Wrapper Docker Image

```bash
cd wrapper-fork
docker build -t wrapper .
```

### Manual Docker Run (for debugging)

```bash
docker run -d --name am-wrapper \
  -p 10020:10020 -p 20020:20020 -p 30020:30020 \
  -v /media/sn0wst0rm/megaDrive/musica/.am-wrapper/data:/app/rootfs/data \
  -e 'args=-H 0.0.0.0 -T <media_token> -S <storefront> -t <dev_token>' \
  wrapper
```

### Start gamdl Service

```bash
cd scripts && source venv/bin/activate
python gamdl_service.py
```

The frontend connects automatically via WebSocket.
