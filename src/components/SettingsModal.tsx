import { useEffect, useState } from "react";
import { DownloadCloud, FolderOpen, Loader2, Settings as SettingsIcon, X } from "lucide-react";
import {
  getMediaToolsStatus,
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
  const [bridgeEnabled, setBridgeEnabled] = useState(settings.bridgeEnabled);
  const [bridgePort, setBridgePort] = useState(settings.bridgePort);
  const [minimizeToTray, setMinimizeToTray] = useState(settings.minimizeToTray);
  const [tools, setTools] = useState<MediaToolsStatus | null>(null);
  const [installingYtDlp, setInstallingYtDlp] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDefaultSaveDir(settings.defaultSaveDir);
      setMaxConnections(settings.maxConnectionsPerDownload);
      setMinSplitKb(Math.round(settings.minSplitSizeBytes / 1024));
      setBridgeEnabled(settings.bridgeEnabled);
      setBridgePort(settings.bridgePort);
      setMinimizeToTray(settings.minimizeToTray);
      void getMediaToolsStatus().then(setTools).catch(() => {});
    }
  }, [isOpen, settings]);

  async function handleInstallYtDlp() {
    setInstallingYtDlp(true);
    try {
      const updated = await installYtDlp();
      setTools(updated);
    } finally {
      setInstallingYtDlp(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
      <div
        className="w-full max-w-lg rounded-[28px] p-6"
        style={{
          backgroundColor: "var(--md-surface-container-high)",
          boxShadow: "var(--md-shadow-3)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: "var(--md-secondary-container)",
                color: "var(--md-on-secondary-container)",
              }}
            >
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-medium tracking-tight">Settings</h2>
              <p className="text-xs" style={{ color: "var(--md-on-surface-variant)" }}>
                Engine, browser bridge & tray preferences
              </p>
            </div>
          </div>
          <button onClick={onClose} className="md-icon-btn p-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          {/* Default Download Folder */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              Default Download Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={defaultSaveDir}
                onChange={(e) => setDefaultSaveDir(e.target.value)}
                className="md-input flex-1 rounded-xl px-3.5 py-2.5 text-sm"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="md-btn-outlined flex items-center gap-1.5 rounded-full px-4 text-xs font-medium"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </button>
            </div>
          </div>

          {/* Performance Sliders Card */}
          <div
            className="space-y-4 rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span>Max Connections per Download</span>
                <span
                  className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }}
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
                className="md-slider w-full"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span>Minimum Dynamic Split Size</span>
                <span
                  className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }}
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
                className="md-slider w-full"
              />
            </div>
          </div>

          {/* Browser Extension Bridge */}
          <div
            className="space-y-3 rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium">Browser Extension Bridge</div>
                <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
                  Intercept downloads from Chrome, Brave, Edge & Firefox
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bridgeEnabled}
                data-checked={bridgeEnabled}
                onClick={() => setBridgeEnabled((v) => !v)}
                className="md-switch"
              >
                <span className="md-switch-thumb" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <span style={{ color: "var(--md-on-surface-variant)" }}>
                Local Bridge Port (restart to apply)
              </span>
              <input
                type="number"
                min={1024}
                max={65535}
                value={bridgePort}
                onChange={(e) => setBridgePort(Number(e.target.value) || 41920)}
                className="md-input w-24 rounded-xl px-3 py-1.5 text-right font-mono text-xs"
              />
            </div>
          </div>

          {/* System Tray Switch */}
          <div
            className="flex items-center justify-between gap-4 rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div>
              <div className="text-xs font-medium">Close Window to System Tray</div>
              <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
                Keep downloads & browser bridge running in the background
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={minimizeToTray}
              data-checked={minimizeToTray}
              onClick={() => setMinimizeToTray((v) => !v)}
              className="md-switch"
            >
              <span className="md-switch-thumb" />
            </button>
          </div>

          {/* YouTube & Media Tools */}
          <div
            className="space-y-2.5 rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium">YouTube & Media Tools</div>
                <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
                  yt-dlp: {tools?.ytdlpInstalled ? "Ready" : "Auto-installs on first YouTube link"} ·
                  ffmpeg: {tools?.ffmpegInstalled ? "Ready" : "Not found in PATH"}
                </div>
              </div>
              <button
                type="button"
                disabled={installingYtDlp}
                onClick={() => void handleInstallYtDlp()}
                className="md-btn-tonal flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-medium cursor-pointer"
              >
                {installingYtDlp ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {tools?.ytdlpInstalled ? "Update yt-dlp" : "Install yt-dlp"}
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-2.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: "var(--md-primary)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="md-btn-filled rounded-full px-6 py-2.5 text-xs font-semibold"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
