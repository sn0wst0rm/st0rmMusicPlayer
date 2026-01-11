# ⚡🎵 st0rmMusic

A beautiful, feature-rich music player and library manager inspired by Apple Music. Stream your local music collection with support for lossless audio, Dolby Atmos, and synchronized lyrics.

---

## ✨ Features

### 📚 Library Management

- **Multiple Views** - Browse your library by Songs, Artists, or Albums
- **Alphabetical Navigation** - Quick A-Z letter selector for fast browsing
- **Full-Text Search** - Fuzzy search across songs, albums, and artists
- **Playlist Management** - Create, edit, and organize playlists with drag-and-drop reordering
- **Library Scanning** - Automatically scan and index your music files from disk

### 🎧 Audio Playback

- **Multi-Codec Support** - Play AAC, ALAC (Lossless), Dolby Atmos, and Spatial Audio
- **Playback Controls** - Shuffle, repeat (all/one), and seamless queue management
- **Codec Selector** - Switch between available audio qualities on-the-fly
- **Queue Management** - Drag-and-drop reordering, play next, add to queue

### 🎤 Lyrics

- **Synchronized Lyrics** - Karaoke-style word-by-word highlighting
- **Multi-Language Support** - Translations available for many tracks
- **Transliteration** - Romanization/pronunciation guides for non-Latin scripts

### ⬇️ Import & Download

- **Apple Music Import** - Download songs, albums, and playlists via URL
- **Private Library Support** - Fetch and download your own uploaded songs from your Apple Music library
- **Multiple Codecs** - Download the same track in multiple audio formats
- **Real-Time Progress** - WebSocket-powered live download tracking
- **Batch Import** - Validate and queue multiple URLs at once

### 🎨 Artist & Album Views

- **Animated Hero Banners** - Dynamic artist backgrounds with video support
- **Animated Album Covers** - Motion artwork for albums that support it
- **Rich Metadata** - Album artwork, editorial notes, and detailed information
- **Dynamic Theming** - UI colors adapt to album artwork

### 🔄 Playlist Sync

- **Apple Music Sync** - Keep playlists synchronized with your Apple Music library
- **Automatic Updates** - Scheduled sync checks for playlist changes
- **Track Management** - Detect added/removed tracks and reorder automatically

### 🎨 User Interface

- **Theme Options** - Light, Dark, and System-auto themes
- **Responsive Design** - Works on desktop and mobile browsers
- **Context Menus** - Right-click for quick actions on any track
- **Toast Notifications** - Non-intrusive feedback for all actions

---

## 🔊 Supported Audio Codecs

| Codec | Quality | Requirement |
|-------|---------|-------------|
| AAC (256 kbps) | Standard | Subscription + Cookies |
| AAC-HE (64 kbps) | Efficient | Subscription + Cookies |
| ALAC | Lossless | Subscription + Cookies + Wrapper |
| Dolby Atmos | Spatial Audio | Subscription + Cookies + Wrapper |
| Spatial Audio | Binaural | Subscription + Cookies + Wrapper |
| AC3 | Surround | Subscription + Cookies + Wrapper |

---

## 🚀 Installation

### Prerequisites

- **Node.js** 18 or higher
- **Python** 3.9 or higher
- **python3-venv** package
- **FFmpeg** (for audio processing)
- **Docker** (optional, required for lossless/Atmos downloads)

### Quick Start

```bash
# Clone the repository with submodules
git clone --recursive https://github.com/sn0wst0rm/st0rmMusicPlayer.git
cd st0rmMusicPlayer

# Run the setup script
./setup.sh

# Start the application
npm start
```

The application will be available at **http://localhost:3000**

### What the Setup Script Does

1. **Checks system requirements** - Verifies Node.js, Python, and dependencies
2. **Installs Node.js packages** - Downloads all JavaScript dependencies
3. **Configures database** - Prompts for database location and initializes Prisma
4. **Creates Python environment** - Sets up virtual environment with required packages
5. **Builds for production** - Compiles the Next.js application

---

## 🔐 Download Requirements

An **active Apple Music subscription** is required for all download functionality. The app uses the Apple Music API to fetch metadata and download content.

### Basic Setup (AAC Downloads)

1. **Extract your Apple Music cookies** from a valid browser session (Netscape format)
2. Navigate to **Settings > Import** in the app
3. Paste your cookies in the configuration field
4. You can now download songs in **AAC** and **AAC-HE** formats

This is sufficient for standard quality downloads using the built-in Widevine-based decryption.

### 🔓 Enabling Lossless & Spatial Audio

For higher quality formats (ALAC Lossless, Dolby Atmos, Spatial Audio), the FairPlay wrapper is needed:

**Additional Requirements:**
- **Docker** installed on your system

**Setup:**
1. Ensure Docker is running
2. When you select a wrapper-required codec, the app will configure everything automatically
3. A **"Login with Apple Music"** button will appear in the UI
4. Sign in with your Apple ID - **OTP/2FA is fully supported** directly in the GUI
5. Once authenticated, lossless and spatial downloads become available

### 🔒 Privacy & Security

Your credentials are handled securely:

- **No Apple ID password is stored** anywhere by the application
- The only sensitive data saved are:
  - Your Apple Music cookies (stored in the local database)
  - Wrapper session data (stored in `<library_folder>/.am-wrapper`)
- All authentication happens directly with Apple's servers

---

## 🙏 Credits & Open Source

st0rmMusic is built on the shoulders of amazing open-source projects:

- **[gamdl](https://github.com/glomatico/gamdl)** - The core library powering Apple Music downloads
- **[wrapper](https://github.com/sn0wst0rm/wrapper)** - FairPlay decryption tool (forked for seamless GUI integration)
- **[Next.js](https://nextjs.org)** - React framework for the web application
- **[Prisma](https://prisma.io)** - Database ORM for library management
- **[FastAPI](https://fastapi.tiangolo.com)** - Python backend for download processing
- **[Radix UI](https://radix-ui.com)** - Accessible component primitives
- **[Tailwind CSS](https://tailwindcss.com)** - Utility-first styling

---

## ⚖️ Legal Disclaimer

**This software is provided for personal use only.**

- st0rmMusic is intended for creating personal backups of music you have legitimately purchased or have a valid subscription to access
- **An active, paid Apple Music subscription is required** for downloading content
- The creator of this software **does not endorse, encourage, or condone** any unlawful use, including but not limited to piracy or copyright infringement
- **The creator is not responsible** for how users choose to use this software
- Users are solely responsible for ensuring their use complies with applicable laws and Apple's Terms of Service
- This project is not affiliated with, endorsed by, or connected to Apple Inc.

By using this software, you acknowledge that you understand and agree to these terms.

---

## 🐛 Issues & Bug Reports

Found a bug or have a feature request? You can file an issue on the [GitHub Issues](https://github.com/sn0wst0rm/st0rmMusicPlayer/issues) page.

### Before Submitting

- **Search existing issues** to avoid duplicates
- Make sure you're using the latest version

### Issue Format

Please follow this format for bug reports:

```
**Description**
A clear description of the bug.

**Steps to Reproduce**
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- OS: [e.g., Ubuntu 24.04, macOS 15]
- Browser: [e.g., Chrome 120, Safari 18]
- Node.js version: [e.g., 20.10.0]
- Python version: [e.g., 3.11]

**Screenshots/Logs**
If applicable, add screenshots or console logs.
```

For **feature requests**, describe the feature and explain why it would be useful.

### ⚠️ Important

Issues that are **too vague**, **lack reproduction steps**, or **cannot be reproduced** will be closed without investigation. Please be as detailed as possible.

---

## ☕ Support the Project

If you find st0rmMusic useful and want to support its continued development, consider buying me a coffee!

<a href="https://ko-fi.com/sn0wst0rm" target="_blank">
  <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" />
</a>

Your donations help me dedicate more time to:
- Maintaining and improving st0rmMusic
- Fixing bugs and adding new features
- Building future **React Native mobile apps** that connect to your st0rmMusic server

Every contribution, no matter how small, is greatly appreciated! 💜

---

## 📄 License

This project is for personal, non-commercial use only. See the repository for full license details.

---

<p align="center">
  Made with 💜 by <a href="https://github.com/sn0wst0rm">sn0wst0rm</a>
</p>
