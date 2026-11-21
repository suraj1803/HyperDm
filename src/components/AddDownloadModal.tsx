import { useEffect, useState } from "react";
import {
  Check,
  Film,
  FolderOpen,
  Globe,
  Loader2,
  Music,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { addDownload, pickDirectory, probeUrl, probeYouTube } from "../api/tauri";
import type {
  AppSettings,
  DownloadTaskInfo,
  ProbeResult,
  YouTubeFormatOption,
  YouTubeProbeResult,
} from "../types/download";
import { formatBytes } from "../utils/format";

interface AddDownloadModalProps {
  isOpen: boolean;
  initialUrl?: string | null;
  settings: AppSettings;
  onClose: () => void;
  onCreated: (task: DownloadTaskInfo) => void;
}

function isYouTubeLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const h = u.hostname.toLowerCase();
    const isYt =
      h === "youtube.com" ||
      h.endsWith(".youtube.com") ||
      h === "youtu.be" ||
      h.endsWith(".youtu.be");
    if (!isYt) return false;
    if (h === "youtu.be" || h.endsWith(".youtu.be")) {
      return u.pathname.replace(/^\/+|\/+$/g, "").length >= 6;
    }
    return (
      u.pathname.startsWith("/watch") ||
      u.pathname.startsWith("/shorts/") ||
      u.pathname.startsWith("/live/") ||
      u.pathname.startsWith("/embed/")
    );
  } catch {
    return false;
  }
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function sanitizeFileStem(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function buildYouTubeFileName(title: string, fmt: YouTubeFormatOption): string {
  const stem = sanitizeFileStem(title) || "YouTube Video";
  const tag = fmt.isAudioOnly ? "Audio" : fmt.height ? `${fmt.height}p` : "Video";
  return `${stem} [${tag}].${fmt.ext}`;
}

export function AddDownloadModal({
  isOpen,
  initialUrl,
  settings,
  onClose,
  onCreated,
}: AddDownloadModalProps) {
  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState(settings.defaultSaveDir);
  const [fileName, setFileName] = useState("");
  const [maxConnections, setMaxConnections] = useState(settings.maxConnectionsPerDownload);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [ytProbe, setYtProbe] = useState<YouTubeProbeResult | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probingYouTube, setProbingYouTube] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runProbe(targetUrl: string) {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;
    setProbing(true);
    setError(null);
    setProbe(null);
    setYtProbe(null);
    setSelectedFormatId(null);

    if (isYouTubeLink(trimmed)) {
      setProbingYouTube(true);
      try {
        const yt = await probeYouTube(trimmed);
        setYtProbe(yt);
        const preferred =
          yt.formats.find((f) => (!f.needsMux || yt.ffmpegAvailable) && f.height === 1080) ??
          yt.formats.find((f) => !f.needsMux || yt.ffmpegAvailable) ??
          yt.formats[0];
        if (preferred) {
          setSelectedFormatId(preferred.id);
          setFileName(buildYouTubeFileName(yt.title, preferred));
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setProbing(false);
        setProbingYouTube(false);
      }
      return;
    }

    try {
      const result = await probeUrl(trimmed);
      setProbe(result);
      setFileName(result.fileName);
    } catch (err) {
      setError(String(err));
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      const startUrl = initialUrl?.trim() ?? "";
      setUrl(startUrl);
      setSaveDir(settings.defaultSaveDir);
      setFileName("");
      setMaxConnections(settings.maxConnectionsPerDownload);
      setProbe(null);
      setYtProbe(null);
      setSelectedFormatId(null);
      setError(null);
      setProbing(false);
      setProbingYouTube(false);
      setSubmitting(false);

      if (startUrl) {
        void runProbe(startUrl);
      }
    }
  }, [isOpen, initialUrl, settings]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedYtFormat =
    ytProbe?.formats.find((f) => f.id === selectedFormatId) ?? null;

  async function handleBrowse() {
    try {
      const dir = await pickDirectory(saveDir);
      if (dir) setSaveDir(dir);
    } catch {
      // Cancelled
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a valid HTTP/HTTPS or YouTube URL.");
      return;
    }

    if (isYouTubeLink(trimmed) && !ytProbe) {
      await runProbe(trimmed);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (ytProbe && selectedYtFormat) {
        if (selectedYtFormat.needsMux && !ytProbe.ffmpegAvailable) {
          setError(
            "This HD quality requires ffmpeg to merge video & audio. Install ffmpeg or pick a Direct / Audio Only option."
          );
          setSubmitting(false);
          return;
        }
        const task = await addDownload({
          url: selectedYtFormat.videoUrl,
          saveDir: saveDir.trim() || undefined,
          fileName: fileName.trim() || buildYouTubeFileName(ytProbe.title, selectedYtFormat),
          maxConnections,
          headers: selectedYtFormat.httpHeaders,
          companionAudioUrl: selectedYtFormat.audioUrl ?? undefined,
          sourcePageUrl: ytProbe.url,
          mediaFormatId: selectedYtFormat.id,
          mediaThumbnail: ytProbe.thumbnail ?? undefined,
          mediaQualityLabel: selectedYtFormat.label,
        });
        onCreated(task);
        onClose();
      } else {
        const task = await addDownload({
          url: trimmed,
          saveDir: saveDir.trim() || undefined,
          fileName: fileName.trim() || undefined,
          maxConnections,
        });
        onCreated(task);
        onClose();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[8px]"
        style={{
          backgroundColor: "var(--bg-elevated)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header Bar */}
        <div
          className="flex h-[48px] shrink-0 items-center justify-between px-5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" style={{ color: "var(--accent-text)" }} />
            <h2 className="text-[13.5px] font-semibold tracking-tight">New Download</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {/* URL Input */}
            <div>
              <label
                className="mb-1 block text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                URL (Direct file or YouTube)
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <input
                    type="url"
                    required
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => {
                      if (url.trim().startsWith("http") && !probe && !ytProbe && !probing) {
                        void runProbe(url);
                      }
                    }}
                    placeholder="https://youtube.com/watch?v=... or file URL"
                    className="ui-input h-8 w-full rounded-[6px] pl-8 pr-2.5 text-[12px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void runProbe(url)}
                  disabled={probing || !url.trim()}
                  className="ui-btn-secondary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium cursor-pointer"
                >
                  {probing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Probe
                </button>
              </div>
            </div>

            {probingYouTube && (
              <div
                className="flex items-center gap-2.5 rounded-[6px] px-3 py-2 text-[11.5px]"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin"
                  style={{ color: "var(--accent-text)" }}
                />
                <span style={{ color: "var(--text-secondary)" }}>
                  Extracting YouTube formats (auto-installing yt-dlp on first run if needed)…
                </span>
              </div>
            )}

            {/* YouTube Preview & Quality Picker */}
            {ytProbe && (
              <div
                className="space-y-2.5 rounded-[6px] p-2.5"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex gap-2.5">
                  {ytProbe.thumbnail && (
                    <img
                      src={ytProbe.thumbnail}
                      alt={ytProbe.title}
                      className="h-14 w-24 shrink-0 rounded-[4px] object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[12px] font-medium leading-snug">
                      {ytProbe.title}
                    </div>
                    <div
                      className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {ytProbe.uploader && <span>{ytProbe.uploader}</span>}
                      {ytProbe.durationSeconds ? (
                        <>
                          <span>·</span>
                          <span className="font-mono">{formatDuration(ytProbe.durationSeconds)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    className="mb-1 text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Quality
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-0.5">
                    {ytProbe.formats.map((fmt) => {
                      const active = fmt.id === selectedFormatId;
                      const disabled = fmt.needsMux && !ytProbe.ffmpegAvailable;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setSelectedFormatId(fmt.id);
                            setFileName(buildYouTubeFileName(ytProbe.title, fmt));
                          }}
                          className="flex w-full items-center justify-between rounded-[5px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-input)",
                            border: active
                              ? "1px solid var(--accent)"
                              : "1px solid var(--border-subtle)",
                            color: active ? "var(--accent-text)" : "var(--text-primary)",
                          }}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            {fmt.isAudioOnly ? (
                              <Music className="h-3 w-3" />
                            ) : (
                              <Film className="h-3 w-3" />
                            )}
                            <span>{fmt.label}</span>
                            {disabled && (
                              <span className="text-[10px] opacity-75">(requires ffmpeg)</span>
                            )}
                          </span>
                          <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                            <span style={{ color: "var(--text-secondary)" }}>
                              {fmt.approxSizeBytes ? `~${formatBytes(fmt.approxSizeBytes)}` : "—"}
                            </span>
                            {active && <Check className="h-3 w-3" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Direct File Probe Info */}
            {probe && !ytProbe && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] px-3 py-2 text-[11.5px]"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex items-center gap-2.5 font-mono tabular-nums">
                  <span style={{ color: "var(--text-secondary)" }}>
                    Size: <strong style={{ color: "var(--text-primary)" }}>{formatBytes(probe.totalSize)}</strong>
                  </span>
                  {probe.contentType && (
                    <span className="truncate max-w-[160px]" style={{ color: "var(--text-muted)" }}>
                      {probe.contentType.split(";")[0]}
                    </span>
                  )}
                </div>
                {probe.supportsRange ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: "var(--success-soft)",
                      color: "var(--success)",
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    Multi-Segment Ready
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: "var(--warning-soft)",
                      color: "var(--warning)",
                    }}
                  >
                    <ShieldAlert className="h-3 w-3" />
                    Single Stream
                  </span>
                )}
              </div>
            )}

            {/* Filename & Connections */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  className="mb-1 block text-[11px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  File Name
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Auto-detected from server"
                  className="ui-input h-8 w-full rounded-[6px] px-2.5 text-[12px]"
                />
              </div>

              <div>
                <label
                  className="mb-1 flex items-center justify-between text-[11px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>Max Connections</span>
                  <span
                    className="font-mono text-[11px] font-semibold tabular-nums"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {maxConnections}
                  </span>
                </label>
                <div
                  className="flex h-8 items-center rounded-[6px] px-2.5"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={maxConnections}
                    onChange={(e) => setMaxConnections(Number(e.target.value))}
                    className="ui-slider w-full"
                  />
                </div>
              </div>
            </div>

            {/* Save Directory */}
            <div>
              <label
                className="mb-1 block text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Save Folder
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveDir}
                  onChange={(e) => setSaveDir(e.target.value)}
                  className="ui-input h-8 flex-1 rounded-[6px] px-2.5 font-mono text-[11.5px]"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="ui-btn-secondary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Browse
                </button>
              </div>
            </div>

            {error && (
              <div
                className="rounded-[6px] px-3 py-2 text-[11.5px]"
                style={{
                  backgroundColor: "var(--danger-soft)",
                  border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div
            className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
            style={{
              backgroundColor: "var(--bg-sidebar)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-secondary h-8 rounded-[6px] px-3.5 text-[12.5px] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || probing || !url.trim()}
              className="ui-btn-primary flex h-8 items-center gap-1.5 rounded-[6px] px-4 text-[12.5px] font-medium cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {ytProbe ? "Download Video" : "Start Download"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
