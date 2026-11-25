import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Film,
  FolderOpen,
  Link2,
  Loader2,
  Music,
  RefreshCw,
  X,
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

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
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
  const lastProbedUrlRef = useRef<string>("");

  const connectionChoices = useMemo(() => {
    const base = [1, 2, 4, 8, 16];
    if (!base.includes(settings.maxConnectionsPerDownload)) {
      base.push(settings.maxConnectionsPerDownload);
      base.sort((a, b) => a - b);
    }
    return base;
  }, [settings.maxConnectionsPerDownload]);

  async function runProbe(targetUrl: string) {
    const trimmed = targetUrl.trim();
    if (!trimmed || !isValidHttpUrl(trimmed)) return;
    lastProbedUrlRef.current = trimmed;
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
      lastProbedUrlRef.current = "";
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

      if (startUrl && isValidHttpUrl(startUrl)) {
        void runProbe(startUrl);
      }
    }
  }, [isOpen, initialUrl, settings]);

  // Auto-probe after short pause when pasting/typing a valid URL
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = url.trim();
    if (!isValidHttpUrl(trimmed) || trimmed === lastProbedUrlRef.current) return;
    const timer = window.setTimeout(() => {
      void runProbe(trimmed);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [url, isOpen]);

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
      setError("Enter a valid HTTP/HTTPS or YouTube URL.");
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
            "This quality requires ffmpeg to merge video and audio. Install ffmpeg in Preferences or pick a direct stream."
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="ui-modal-panel flex max-h-[86vh] w-full max-w-[496px] flex-col overflow-hidden rounded-[10px]"
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
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">New Download</h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
            {/* Source URL */}
            <div>
              <label
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Source URL
              </label>
              <div className="relative">
                <Link2
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                  strokeWidth={1.75}
                  style={{ color: "var(--text-muted)" }}
                />
                <input
                  type="url"
                  required
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/archive.zip or YouTube link"
                  className="ui-input h-8 w-full rounded-[6px] pl-8 pr-8 text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => void runProbe(url)}
                  disabled={probing || !isValidHttpUrl(url)}
                  className="ui-btn-ghost absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[4px] cursor-pointer"
                  title="Probe URL"
                >
                  {probing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--accent-text)" }} />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            {probingYouTube && (
              <div
                className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin"
                  style={{ color: "var(--accent-text)" }}
                />
                <span>Fetching available video & audio streams…</span>
              </div>
            )}

            {/* Direct Probe Metadata Strip */}
            {probe && !ytProbe && (
              <div
                className="flex items-center justify-between gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex min-w-0 items-center gap-2 font-mono tabular-nums">
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {formatBytes(probe.totalSize)}
                  </span>
                  {probe.contentType && (
                    <>
                      <span style={{ color: "var(--text-muted)" }}>·</span>
                      <span className="truncate" style={{ color: "var(--text-muted)" }}>
                        {probe.contentType.split(";")[0]}
                      </span>
                    </>
                  )}
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium"
                  style={{
                    color: probe.supportsRange ? "var(--success)" : "var(--warning)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor: probe.supportsRange
                        ? "var(--success)"
                        : "var(--warning)",
                    }}
                  />
                  {probe.supportsRange ? "Multi-segment" : "Single stream"}
                </span>
              </div>
            )}

            {/* YouTube Preview & Format Picker */}
            {ytProbe && (
              <div
                className="space-y-2.5 rounded-[8px] p-3"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex gap-2.5">
                  {ytProbe.thumbnail && (
                    <img
                      src={ytProbe.thumbnail}
                      alt=""
                      className="h-12 w-[84px] shrink-0 rounded-[5px] object-cover"
                      style={{ border: "1px solid var(--border-subtle)" }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[12.5px] font-medium leading-[17px]">
                      {ytProbe.title}
                    </div>
                    <div
                      className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {ytProbe.uploader && <span className="truncate">{ytProbe.uploader}</span>}
                      {ytProbe.durationSeconds ? (
                        <>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {formatDuration(ytProbe.durationSeconds)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <div
                    className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Stream Quality
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
                          className="flex h-8 w-full items-center justify-between rounded-[6px] px-2.5 text-left text-[12.5px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-input)",
                            border: active
                              ? "1px solid var(--accent)"
                              : "1px solid var(--border-subtle)",
                            color: active ? "var(--accent-text)" : "var(--text-primary)",
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                            {fmt.isAudioOnly ? (
                              <Music className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                            ) : (
                              <Film className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                            )}
                            <span className="truncate">{fmt.label}</span>
                            {disabled && (
                              <span className="shrink-0 text-[11px] opacity-75">
                                (needs ffmpeg)
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 font-mono text-[11.5px] tabular-nums">
                            <span style={{ color: "var(--text-secondary)" }}>
                              {fmt.approxSizeBytes ? `~${formatBytes(fmt.approxSizeBytes)}` : "—"}
                            </span>
                            {active && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* File Name */}
            <div>
              <label
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Save As
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Auto-detected filename"
                className="ui-input h-8 w-full rounded-[6px] px-2.5 text-[13px]"
              />
            </div>

            {/* Destination Folder */}
            <div>
              <label
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Location
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveDir}
                  onChange={(e) => setSaveDir(e.target.value)}
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

            {/* Parallel Connections Segmented Picker */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <div>
                <div className="text-[12.5px] font-medium">Connections</div>
                <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                  Parallel HTTP range workers
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

            {error && (
              <div
                className="rounded-[6px] px-3 py-2 text-[12px] leading-[17px]"
                style={{
                  backgroundColor: "var(--danger-soft)",
                  border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            )}
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
              disabled={submitting || probing || !url.trim()}
              className="ui-btn-primary flex h-8 items-center gap-1.5 rounded-[6px] px-3.5 text-[12.5px] font-medium cursor-pointer"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{ytProbe ? "Download Video" : "Start Download"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
