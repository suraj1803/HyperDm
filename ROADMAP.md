# HyperDM — Official v1.0 Release Roadmap

A prioritized checklist of features, polish, and distribution tasks to complete before shipping the official **v1.0** release.

---

## Tier 1 — Must-Haves for Official v1.0

Core quality-of-life features users expect from a daily-driver desktop download manager.

- [ ] **Speed Limiter (Global & Per-Download)**
  - Add a shared token-bucket rate limiter (e.g. `5 MB/s` or unlimited) in `src-tauri/src/engine/worker.rs`.
  - Add a quick toggle/selector in the footer bar and Settings modal so downloads don't saturate bandwidth during calls, streaming, or gaming.
- [ ] **Main UI Bulk Actions (`Pause All`, `Resume All`, `Clear Completed`)**
  - Expose `Pause All` and `Resume All` in the main toolbar (currently only available in the system tray menu).
  - Add a `Clear Completed` button to tidy finished downloads without deleting files from disk.
- [ ] **Desktop Notifications on Completion & Failure**
  - Integrate `tauri-plugin-notification` to show native OS notifications when background downloads finish or error out (especially important with Close-to-Tray enabled).
  - Clicking a completion notification should open the file or reveal it in the file manager.
- [ ] **Disk Space Check Before Pre-Allocation**
  - Check available free disk space in the target directory before calling `file.set_len(total_size)`.
  - Return a clear, human-readable error message when free space is insufficient instead of a raw OS I/O error.
- [ ] **Auto-Start on System Login**
  - Add a **"Launch HyperDM on startup (minimized to tray)"** toggle using `tauri-plugin-autostart`.
  - Ensures browser download interception works automatically after reboots.
- [ ] **Clipboard URL Auto-Fill**
  - When opening **New Download** (`Ctrl+N`), automatically pre-fill and probe the URL field if the clipboard contains an `http://`, `https://`, or YouTube link.

---

## Tier 2 — High-Value Polish (v1.0 or Fast-Follow v1.1)

- [ ] **In-App Update Checker (HyperDM + `yt-dlp`)**
  - Check GitHub Releases for newer HyperDM versions and notify the user.
  - Prompt or auto-update `yt-dlp` when YouTube extraction fails due to upstream YouTube changes.
- [ ] **Row Right-Click Context Menu**
  - Add a context menu on download rows: *Open File*, *Show in Folder*, *Copy URL*, *Pause / Resume*, *Inspect Segments*, *Remove*.
- [ ] **Checksum Verification (SHA-256 / MD5)**
  - Allow pasting an expected hash in the Segment Progress / Details modal to verify downloaded ISOs, installers, and archives.
- [ ] **Category Auto-Sorting**
  - Optional setting to route downloads into subfolders by file type (`Videos/`, `Audio/`, `Archives/`, `Programs/`, `Documents/`).
- [ ] **Proxy Support (HTTP / SOCKS5)**
  - Configurable proxy settings applied to both `reqwest::Client` and `yt-dlp --proxy`.
- [ ] **YouTube Batch / Playlist Support**
  - Detect YouTube playlist URLs (`--flat-playlist`) and allow selecting which videos to queue.

---

## Tier 3 — Release & Distribution Hygiene

- [ ] **Publish Browser Extension to Official Stores**
  - Submit `browser-extension/` to the **Chrome Web Store** and **Firefox Add-ons (AMO)** so users don't need Developer Mode / "Load unpacked" (and Firefox doesn't unload temporary add-ons on restart).
- [ ] **Clean-Machine QA (Windows & Linux)**
  - Test NSIS (`.exe`), MSI (`.msi`), AppImage, `.deb`, and `.rpm` installers on fresh environments without pre-installed `yt-dlp` or `ffmpeg`.
  - Verify system tray behavior on Windows 11, GNOME, and KDE, plus authenticated browser download handoff with cookies.
