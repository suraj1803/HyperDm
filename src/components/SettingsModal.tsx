import { useEffect, useState } from "react";
import { DownloadCloud, FolderOpen, Loader2, Settings as SettingsIcon, X } from "lucide-react";
import {
  getMediaToolsStatus,
  installFfmpeg,
  installYtDlp,
  pickDirectory,
  updateSettings,
} from "../api/tauri";
import type { AppSettings, MediaToolsStatus } from "../types/download";

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSaved: (updated: AppSettings) => void;
}

export function SettingsModal({
  isOpen,
  settings,
  onClose,
  onSaved,
}: SettingsModalProps) {
  const [defaultSaveDir, setDefaultSaveDir] = useState(settings.defaultSaveDir);
  const [maxConnections, setMaxConnections] = useState(settings.maxConnectionsPerDownload);
  const [minSplitKb, setMinSplitKb] = useState(Math.round(settings.minSplitSizeBytes / 1024));
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(
    settings.maxConcurrentDownloads
  );
  const [bridgeEnabled, setBridgeEnabled] = useState(settings.bridgeEnabled);
  const [bridgePort, setBridgePort] = useState(settings.bridgePort);
  const [minimizeToTray, setMinimizeToTray] = useState(settings.minimizeToTray);
  const [tools, setTools] = useState<MediaToolsStatus | null>(null);
  const [installingYtDlp, setInstallingYtDlp] = useState(false);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDefaultSaveDir(settings.defaultSaveDir);
      setMaxConnections(settings.maxConnectionsPerDownload);
      setMinSplitKb(Math.round(settings.minSplitSizeBytes / 1024));
      setMaxConcurrentDownloads(settings.maxConcurrentDownloads);
      setBridgeEnabled(settings.bridgeEnabled);
      setBridgePort(settings.bridgePort);
      setMinimizeToTray(settings.minimizeToTray);
      void getMediaToolsStatus().then(setTools).catch(() => {});
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  async function handleInstallYtDlp() {
    setInstallingYtDlp(true);
    try {
      const updated = await installYtDlp();
      setTools(updated);
    } finally {
      setInstallingYtDlp(false);
    }
  }

  async function handleInstallFfmpeg() {
    setInstallingFfmpeg(true);
    try {
      const updated = await installFfmpeg();
      setTools(updated);
    } finally {
      setInstallingFfmpeg(false);
    }
  }

  if (!isOpen) return null;

  async function handleBrowse() {
    try {
      const dir = await pickDirectory(defaultSaveDir);
      if (dir) setDefaultSaveDir(dir);
    } catch {
      // Cancelled
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateSettings({
        ...settings,
        defaultSaveDir,
        maxConnectionsPerDownload: maxConnections,
        minSplitSizeBytes: minSplitKb * 1024,
        maxConcurrentDownloads,
        bridgeEnabled,
        bridgePort,
        minimizeToTray,
      });
      onSaved(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[10px]"
        style={{
          backgroundColor: "var(--bg-elevated)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header Bar */}
        <div
          className="flex h-[54px] shrink-0 items-center justify-between px-5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2.5">
            <SettingsIcon className="h-4.5 w-4.5" style={{ color: "var(--text-secondary)" }} />
            <h2 className="text-[15px] font-semibold tracking-tight">Preferences</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-ghost flex h-8 w-8 items-center justify-center rounded-[6px] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 divide-y overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
            {/* Download Folder */}
            <div className="p-5" style={{ borderColor: "var(--border-subtle)" }}>
              <label
                className="mb-1.5 block text-[12.5px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Default Download Folder
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={defaultSaveDir}
                  onChange={(e) => setDefaultSaveDir(e.target.value)}
                  className="ui-input h-9.5 flex-1 rounded-[7px] px-3 font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="ui-btn-secondary flex h-9.5 items-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-medium cursor-pointer"
                >
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </button>
              </div>
            </div>

            {/* Engine Tuning */}
            <div className="space-y-4 p-5" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <div className="mb-2 flex items-center justify-between text-[13.5px]">
                  <span className="font-medium">Max Connections per Download</span>
                  <span
                    className="font-mono text-[13px] font-semibold tabular-nums"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {maxConnections}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={16}
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  className="ui-slider w-full"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-[13.5px]">
                  <span className="font-medium">Minimum Dynamic Split Size</span>
                  <span
                    className="font-mono text-[13px] font-semibold tabular-nums"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {minSplitKb} KB
                  </span>
                </div>
                <input
                  type="range"
                  min={128}
                  max={4096}
                  step={128}
                  value={minSplitKb}
                  onChange={(e) => setMinSplitKb(Number(e.target.value))}
                  className="ui-slider w-full"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-[13.5px]">
                  <span className="font-medium">Max Concurrent Downloads</span>
                  <span
                    className="font-mono text-[13px] font-semibold tabular-nums"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {maxConcurrentDownloads}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={maxConcurrentDownloads}
                  onChange={(e) => setMaxConcurrentDownloads(Number(e.target.value))}
                  className="ui-slider w-full"
                />
              </div>
            </div>

            {/* Browser Extension Bridge */}
            <div className="space-y-3 p-5" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13.5px] font-medium">Browser Extension Bridge</div>
                  <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                    Intercept downloads from Chrome, Brave, Edge & Firefox
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bridgeEnabled}
                  data-checked={bridgeEnabled}
                  onClick={() => setBridgeEnabled((v) => !v)}
                  className="ui-switch"
                >
                  <span className="ui-switch-thumb" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span style={{ color: "var(--text-secondary)" }}>
                  Local Bridge Port (restart to apply)
                </span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={bridgePort}
                  onChange={(e) => setBridgePort(Number(e.target.value) || 41920)}
                  className="ui-input h-8.5 w-24 rounded-[6px] px-2.5 text-right font-mono text-[13px]"
                />
              </div>
            </div>

            {/* System Tray */}
            <div
              className="flex items-center justify-between gap-4 p-5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div>
                <div className="text-[13.5px] font-medium">Close Window to System Tray</div>
                <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                  Keep downloads & bridge active in the background
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={minimizeToTray}
                data-checked={minimizeToTray}
                onClick={() => setMinimizeToTray((v) => !v)}
                className="ui-switch"
              >
                <span className="ui-switch-thumb" />
              </button>
            </div>

            {/* Media Tools */}
            <div className="space-y-2.5 p-5" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-medium">YouTube & Media Tools</span>
                <span className="font-mono text-[12px]" style={{ color: "var(--text-muted)" }}>
                  yt-dlp: <strong style={{ color: "var(--text-primary)" }}>{tools?.ytdlpInstalled ? "ready" : "auto"}</strong> ·
                  ffmpeg: <strong style={{ color: "var(--text-primary)" }}>{tools?.ffmpegInstalled ? "ready" : "auto"}</strong>
                </span>
              </div>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                Auto-installed on first use if not already present on your system.
              </p>
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={installingYtDlp}
                  onClick={() => void handleInstallYtDlp()}
                  className="ui-btn-secondary flex h-8.5 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
                >
                  {installingYtDlp ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <DownloadCloud className="h-3.5 w-3.5" />
                  )}
                  {tools?.ytdlpInstalled ? "Update yt-dlp" : "Install yt-dlp"}
                </button>
                <button
                  type="button"
                  disabled={installingFfmpeg}
                  onClick={() => void handleInstallFfmpeg()}
                  className="ui-btn-secondary flex h-8.5 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
                >
                  {installingFfmpeg ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <DownloadCloud className="h-3.5 w-3.5" />
                  )}
                  {tools?.ffmpegInstalled ? "Update ffmpeg" : "Install ffmpeg"}
                </button>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div
            className="flex shrink-0 items-center justify-end gap-2.5 px-5 py-3.5"
            style={{
              backgroundColor: "var(--bg-sidebar)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-secondary h-9 rounded-[7px] px-4 text-[13.5px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ui-btn-primary h-9 rounded-[7px] px-4 text-[13.5px] font-medium cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
