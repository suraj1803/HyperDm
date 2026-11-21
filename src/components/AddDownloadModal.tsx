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
        // Pick highest compatible format (prefer 1080p or best available)
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

    // If user pasted a YouTube URL and hit Enter before probing finished
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] p-6"
        style={{
          backgroundColor: "var(--md-surface-container-high)",
          boxShadow: "var(--md-shadow-3)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: "var(--md-primary-container)",
                color: "var(--md-on-primary-container)",
              }}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-medium tracking-tight">New Download</h2>
              <p className="text-xs" style={{ color: "var(--md-on-surface-variant)" }}>
                Direct links & YouTube videos with dynamic multi-segment speed
              </p>
            </div>
          </div>
          <button onClick={onClose} className="md-icon-btn p-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* URL Input */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              Download or YouTube URL
            </label>
            <div className="flex gap-2.5">
              <div className="relative flex-1">
                <Globe
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: "var(--md-on-surface-variant)" }}
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
                  placeholder="https://youtube.com/watch?v=... or direct file URL"
                  className="md-input w-full rounded-xl py-2.5 pl-10 pr-3.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void runProbe(url)}
                disabled={probing || !url.trim()}
                className="md-btn-tonal flex items-center gap-1.5 rounded-full px-4 text-xs font-medium cursor-pointer"
              >
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Probe
              </button>
            </div>
          </div>

          {probingYouTube && (
            <div
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-xs"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--md-primary)" }} />
              <span style={{ color: "var(--md-on-surface-variant)" }}>
                Extracting YouTube video qualities (auto-installing yt-dlp on first run if needed)…
              </span>
            </div>
          )}

          {/* YouTube Video Preview & Quality Picker */}
          {ytProbe && (
            <div
              className="space-y-3 rounded-2xl p-3.5"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div className="flex gap-3">
                {ytProbe.thumbnail && (
                  <img
                    src={ytProbe.thumbnail}
                    alt={ytProbe.title}
                    className="h-18 w-32 shrink-0 rounded-xl object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">
                    {ytProbe.title}
                  </div>
                  <div
                    className="mt-1 flex flex-wrap items-center gap-2 text-[11px]"
                    style={{ color: "var(--md-on-surface-variant)" }}
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
                  className="mb-1.5 text-[11px] font-medium"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  Select Quality
                </div>
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
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
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: active
                            ? "var(--md-primary-container)"
                            : "var(--md-surface-container-low)",
                          color: active
                            ? "var(--md-on-primary-container)"
                            : "var(--md-on-surface)",
                        }}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {fmt.isAudioOnly ? (
                            <Music className="h-3.5 w-3.5" />
                          ) : (
                            <Film className="h-3.5 w-3.5" />
                          )}
                          <span>{fmt.label}</span>
                          {disabled && (
                            <span className="text-[10px] opacity-80">(requires ffmpeg)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 tabular-nums">
                          <span className="text-[11px] opacity-80">
                            {fmt.approxSizeBytes ? `~${formatBytes(fmt.approxSizeBytes)}` : "—"}
                          </span>
                          {active && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Direct File Probe Result Card */}
          {probe && !ytProbe && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-xs"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div className="flex items-center gap-3">
                <span style={{ color: "var(--md-on-surface-variant)" }}>
                  Size:{" "}
                  <strong className="font-semibold" style={{ color: "var(--md-on-surface)" }}>
                    {formatBytes(probe.totalSize)}
                  </strong>
                </span>
                {probe.contentType && (
                  <span
                    className="truncate max-w-[180px]"
                    style={{ color: "var(--md-on-surface-variant)" }}
                  >
                    {probe.contentType.split(";")[0]}
                  </span>
                )}
              </div>
              {probe.supportsRange ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--md-tertiary-container)",
                    color: "var(--md-on-tertiary-container)",
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Dynamic Multi-Segment Ready
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--md-warning-container)",
                    color: "var(--md-on-warning-container)",
                  }}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Single Stream Only
                </span>
              )}
            </div>
          )}

          {/* Filename & Connections */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                File Name
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Auto-detected from server"
                className="md-input w-full rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label
                className="mb-1.5 flex items-center justify-between text-xs font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                <span>Max Connections</span>
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }}
                >
                  {maxConnections}
                </span>
              </label>
              <div
                className="flex h-[42px] items-center rounded-xl px-3.5"
                style={{ backgroundColor: "var(--md-surface-container)" }}
              >
                <input
                  type="range"
                  min={1}
                  max={16}
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  className="md-slider w-full"
                />
              </div>
            </div>
          </div>

          {/* Save Directory */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              Save Folder
            </label>
            <div className="flex gap-2.5">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="md-input flex-1 rounded-xl px-3.5 py-2.5 text-sm"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="md-btn-outlined flex items-center gap-1.5 rounded-full px-4 text-xs font-medium cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </button>
            </div>
          </div>

          {error && (
            <div
              className="rounded-2xl px-4 py-3 text-xs"
              style={{
                backgroundColor: "var(--md-error-container)",
                color: "var(--md-on-error-container)",
              }}
            >
              {error}
            </div>
          )}

          {/* M3 Dialog Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-2.5 text-xs font-medium transition-colors hover:bg-white/5 cursor-pointer"
              style={{ color: "var(--md-primary)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || probing || !url.trim()}
              className="md-btn-filled flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-semibold cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {ytProbe ? "Download Video" : "Start Download"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
