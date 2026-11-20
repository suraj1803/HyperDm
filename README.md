# HyperDM — High-Speed Download Manager

HyperDM is a native desktop download manager inspired by Internet Download Manager (IDM), built with **Rust**, **Tauri v2**, and **React + TypeScript**.

## Key Features
- **IDM-Style Dynamic File Segmentation (Work-Stealing)**: Splits files into parallel HTTP `Range` connections (up to 16) and dynamically bisects the largest remaining active segment whenever a worker finishes early—shrinking the slower worker's upper bound without dropping its TCP connection.
- **Zero-Copy Direct Positioned I/O**: Writes directly to exact byte offsets in a pre-allocated `.hyperdm.part` file via `write_all_at` (`pwrite`) and atomically renames on completion.
- **Pause, Resume & Persistence**: Persists download state and per-segment byte progress across restarts.
- **Automatic Retry & Fallback**: Exponential backoff retries on transient connection drops, plus graceful single-stream fallback when a server does not support HTTP Range requests.
- **Live Segment Visualizer**: Real-time multi-segment progress map, per-connection speed/status table, and live throughput sparkline.
- **Browser Integration**: Manifest V3 extension for Chrome, Brave, Edge, and Firefox with automatic download interception, Cookie/Referer forwarding, and a right-click **Download with HyperDM** menu.
- **System Tray Support**: Minimize-to-tray on close to keep active downloads and the browser bridge running in the background, with quick **Show**, **Pause All**, **Resume All**, and **Quit** tray menu actions.

## Development

```bash
# Install frontend dependencies
npm install

# Run HyperDM desktop app in development mode
npm run tauri dev
```

## Browser Extension (Chrome, Brave, Edge, Firefox)

HyperDM includes a Manifest V3 browser extension in `browser-extension/` that communicates with HyperDM's local HTTP bridge (`127.0.0.1:41920`).

- **Chrome / Brave / Edge / Vivaldi**:
  1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
  2. Enable **Developer mode** (top-right toggle).
  3. Click **Load unpacked** and select `/home/suraj/work/idm-clone/browser-extension`.
- **Firefox**:
  1. Open `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on...** and select `browser-extension/manifest.json`.

When HyperDM is running, browser downloads are automatically intercepted (including `Cookie`, `Referer`, and `User-Agent` headers), and you can also right-click any link/media and choose **Download with HyperDM**.

## Testing & Verification

```bash
# Run Rust download engine integration tests
cd src-tauri && cargo test

# Typecheck and build frontend
npm run build
```

## Releasing (Windows & Linux)

HyperDM includes an automated GitHub Actions release workflow (`.github/workflows/release.yml`) that builds Windows (`.exe` / `.msi`) and Linux (`.AppImage` / `.deb` / `.rpm`) installers plus `hyperdm-browser-extension.zip`:

```bash
git tag v0.1.0
git push origin v0.1.0
```
