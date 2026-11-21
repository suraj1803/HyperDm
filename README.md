# HyperDM — High-Speed Download Manager

A fast, lightweight, cross-platform desktop download manager inspired by **Internet Download Manager (IDM)**, built with **Rust**, **Tauri v2**, and a **Google Material Design 3** React + TypeScript UI.

---

## Features

- **IDM-Style Dynamic File Segmentation (Work-Stealing)**
  - Opens up to **16 dedicated HTTP/1.1 TCP connections** per download (`http1_only` to avoid single-socket HTTP/2 bottlenecks).
  - Dynamically bisects the largest remaining active segment on the fly whenever any worker finishes early—eliminating slow-tail stalls without dropping active connections.
- **Zero-Copy Direct Positioned Disk I/O**
  - Pre-allocates a single `.hyperdm.part` file and writes directly to exact byte offsets (`write_all_at` on Linux/macOS, `seek_write` on Windows), avoiding temporary chunk files and post-download concatenation overhead.
- **Zero-Setup YouTube Video & Audio Downloading**
  - Paste any YouTube video/Shorts URL or click the floating **`⚡ Download with HyperDM`** pill on YouTube pages.
  - Pick from **4K (2160p), 1440p, 1080p, 720p, Standard, or Audio Only** with thumbnail, channel, and duration preview.
  - Automatically downloads and manages standalone **`yt-dlp`** and **`ffmpeg`** binaries on demand—no manual prerequisites required on Windows or Linux.
  - Downloads adaptive video and companion audio tracks in parallel (with 8 MiB `googlevideo.com` sub-ranging and original/default language preference) and performs instant lossless `ffmpeg` remuxing.
- **Google Material Design 3 (Material You) UI**
  - Clean desktop interface with **Dark & Light themes**, search bar, hover-highlighted rows, double-click to open files/folders, delete confirmation (with optional delete-from-disk), and a live **Statistics & Dynamic File Segmentation Map** modal with throughput sparkline.
- **Cross-Browser Extension (Chrome, Brave, Edge, Firefox)**
  - Manifest V3 extension that intercepts downloads when HyperDM is running (forwarding `Cookie`, `Referer`, and `User-Agent` headers), adds a right-click **Download with HyperDM** menu, and injects a floating YouTube download pill.
  - Secured via loopback-only HTTP bridge (`127.0.0.1:41920`) with strict `Origin` validation.
- **System Tray, Queue & Persistence**
  - Close-to-tray background mode with **Show**, **Pause All**, **Resume All**, and **Quit** tray actions, single-instance window focus guard, configurable concurrent download queue, and persistent pause/resume across restarts (with automatic YouTube URL refresh on expiry).

---

## Download & Install

Grab the latest prebuilt installers from **[GitHub Releases](https://github.com/suraj1803/HyperDm/releases)**:

- **Windows**: `.exe` (NSIS installer) or `.msi`
- **Linux**: `.AppImage` (portable), `.deb` (Debian/Ubuntu), or `.rpm` (Fedora/RHEL)
- **Browser Extension**: `hyperdm-browser-extension.zip`

### Installing the Browser Extension
1. Download and unzip `hyperdm-browser-extension.zip` (or use the `browser-extension/` folder in this repo).
2. **Chrome / Brave / Edge / Vivaldi**:
   - Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the unzipped extension folder.
3. **Firefox**:
   - Open `about:debugging#/runtime/this-firefox`.
   - Click **Load Temporary Add-on...** and select `manifest.json`.

---

## Development

### Prerequisites
- **Rust** (stable)
- **Node.js** 20+
- **Linux only**: `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator3` (or `libayatana-appindicator3-dev` on Debian/Ubuntu)

### Run Locally
```bash
# Install frontend dependencies
npm install

# Launch HyperDM in development mode
npm run tauri dev
```

### Test & Build
```bash
# Run Rust download engine & bridge integration tests (10 tests)
cd src-tauri && cargo test -- --nocapture

# Typecheck and build React frontend
npm run build

# Build native installers locally
npm run tauri build
```

---

## Releasing (Windows & Linux)

Pushing a version tag (`v*`) triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which tests and builds Windows + Linux installers plus `hyperdm-browser-extension.zip` and publishes them to GitHub Releases:

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Architecture & Internals

For a deep dive into the dynamic work-stealing algorithm, network optimizations, YouTube pipeline, and file map, see **[GUIDE.md](GUIDE.md)**.

---

## Notes & Disclaimer

- **Windows SmartScreen**: Release binaries are built transparently via GitHub Actions and are currently unsigned. If Windows SmartScreen prompts *"Windows protected your PC"*, click **More info → Run anyway**.
- **Usage**: Users are responsible for complying with the terms of service and copyright laws of any website they download content from.

## License

Licensed under the **[MIT License](LICENSE)**.
