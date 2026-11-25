import { useEffect, useMemo, useState } from "react";
import { DownloadCloud, FolderOpen, Loader2, Minus, Plus, X } from "lucide-react";
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

const SPLIT_OPTIONS_KB = [
  { kb: 256, label: "256K" },
  { kb: 512, label: "512K" },
  { kb: 1024, label: "1M" },
  { kb: 2048, label: "2M" },
];

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

  const connectionChoices = useMemo(() => {
    const base = [1, 2, 4, 8, 16];
    if (!base.includes(maxConnections)) {
      base.push(maxConnections);
      base.sort((a, b) => a - b);
    }
    return base;
  }, [maxConnections]);

  const splitChoices = useMemo(() => {
    const base = [...SPLIT_OPTIONS_KB];
    if (!base.some((o) => o.kb === minSplitKb) && minSplitKb > 0) {
      base.push({
        kb: minSplitKb,
        label: minSplitKb >= 1024 && minSplitKb % 1024 === 0 ? `${minSplitKb / 1024}M` : `${minSplitKb}K`,
      });
      base.sort((a, b) => a.kb - b.kb);
    }
    return base;
  }, [minSplitKb]);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="ui-modal-panel flex max-h-[86vh] w-full max-w-[480px] flex-col overflow-hidden rounded-[10px]"
        style={{
          backgroundColor: "var(--bg-elevated)",
          boxShadow: "var(--shadow-modal)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex h-11 shrink-0 items-center justify-between px-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Preferences</h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex-1 divide-y overflow-y-auto"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {/* General */}
            <div className="space-y-3.5 p-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div
                className="text-[11px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--text-muted)" }}
              >
                General
              </div>

              <div>
                <label
                  className="mb-1.5 block text-[12.5px] font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  Default download folder
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={defaultSaveDir}
                    onChange={(e) => setDefaultSaveDir(e.target.value)}
                    className="ui-input h-8 min-w-0 flex-1 rounded-[6px] px-2.5 font-mono text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="ui-btn-secondary flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-0.5">
                <div>
                  <div className="text-[12.5px] font-medium">Close window to system tray</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    Keep active downloads and browser bridge running
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
            </div>

            {/* Network Engine */}
            <div className="space-y-3.5 p-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div
                className="text-[11px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--text-muted)" }}
              >
                Transfer Engine
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-medium">Connections per download</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    Default parallel segments per task
                  </div>
                </div>
                <div className="ui-segmented">
                  {connectionChoices.map((n) => (
                    <button
                      key={n}
                      type="button"
                      data-active={maxConnections === n}
                      onClick={() => setMaxConnections(n)}
                      className="ui-segmented-item font-mono tabular-nums"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-medium">Minimum split size</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    Smallest work-stealing byte range
                  </div>
                </div>
                <div className="ui-segmented">
                  {splitChoices.map((opt) => (
                    <button
                      key={opt.kb}
                      type="button"
                      data-active={minSplitKb === opt.kb}
                      onClick={() => setMinSplitKb(opt.kb)}
                      className="ui-segmented-item font-mono tabular-nums"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-medium">Concurrent downloads</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    Maximum active tasks in parallel
                  </div>
                </div>
                <div
                  className="inline-flex h-7 items-center rounded-[6px] px-1"
                  style={{
                    backgroundColor: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    disabled={maxConcurrentDownloads <= 1}
                    onClick={() => setMaxConcurrentDownloads((c) => Math.max(1, c - 1))}
                    className="ui-btn-ghost flex h-5 w-5 items-center justify-center rounded-[4px] cursor-pointer"
                  >
                    <Minus className="h-3 w-3" strokeWidth={2} />
                  </button>
                  <span className="w-7 text-center font-mono text-[12px] font-medium tabular-nums">
                    {maxConcurrentDownloads}
                  </span>
                  <button
                    type="button"
                    disabled={maxConcurrentDownloads >= 10}
                    onClick={() => setMaxConcurrentDownloads((c) => Math.min(10, c + 1))}
                    className="ui-btn-ghost flex h-5 w-5 items-center justify-center rounded-[4px] cursor-pointer"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>

            {/* Browser Bridge & Media Tools */}
            <div className="space-y-3.5 p-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div
                className="text-[11px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--text-muted)" }}
              >
                Integrations
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[12.5px] font-medium">Browser extension bridge</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    Capture downloads from Chrome, Brave, Edge & Firefox
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

              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  Local bridge port (requires restart)
                </span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={bridgePort}
                  onChange={(e) => setBridgePort(Number(e.target.value) || 41920)}
                  className="ui-input h-7 w-20 rounded-[5px] px-2 text-right font-mono text-[12px] tabular-nums"
                />
              </div>

              <div
                className="pt-3"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12.5px] font-medium">Media stream tools</div>
                    <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                      Used for YouTube extraction and HD stream merging
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={installingYtDlp}
                    onClick={() => void handleInstallYtDlp()}
                    className="ui-btn-secondary flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium cursor-pointer"
                  >
                    {installingYtDlp ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          backgroundColor: tools?.ytdlpInstalled
                            ? "var(--success)"
                            : "var(--warning)",
                        }}
                      />
                    )}
                    <span>{tools?.ytdlpInstalled ? "Update yt-dlp" : "Install yt-dlp"}</span>
                    <DownloadCloud className="h-3 w-3 opacity-60" strokeWidth={1.75} />
                  </button>

                  <button
                    type="button"
                    disabled={installingFfmpeg}
                    onClick={() => void handleInstallFfmpeg()}
                    className="ui-btn-secondary flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium cursor-pointer"
                  >
                    {installingFfmpeg ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          backgroundColor: tools?.ffmpegInstalled
                            ? "var(--success)"
                            : "var(--warning)",
                        }}
                      />
                    )}
                    <span>{tools?.ffmpegInstalled ? "Update ffmpeg" : "Install ffmpeg"}</span>
                    <DownloadCloud className="h-3 w-3 opacity-60" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex shrink-0 items-center justify-end gap-2 px-4 py-2.5"
            style={{
              backgroundColor: "var(--bg-sidebar)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-secondary h-8 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ui-btn-primary h-8 rounded-[6px] px-3.5 text-[12.5px] font-medium cursor-pointer"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
