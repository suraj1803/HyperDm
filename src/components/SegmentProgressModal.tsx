import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import {
  cancelDownload,
  openPath,
  pauseDownload,
  resumeDownload,
} from "../api/tauri";
import type { DownloadTaskInfo, SegmentStatus } from "../types/download";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  progressPercent,
} from "../utils/format";

interface SegmentProgressModalProps {
  task: DownloadTaskInfo | null;
  onClose: () => void;
}

function segmentColorVar(status: SegmentStatus): string {
  switch (status) {
    case "completed":
      return "var(--success)";
    case "downloading":
      return "var(--accent)";
    case "connecting":
      return "var(--warning)";
    case "error":
      return "var(--danger)";
    default:
      return "var(--text-muted)";
  }
}

export function SegmentProgressModal({ task, onClose }: SegmentProgressModalProps) {
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    setSpeedHistory([]);
    setCopiedUrl(false);
  }, [task?.id]);

  useEffect(() => {
    if (!task) return;
    if (task.status === "downloading") {
      setSpeedHistory((prev) => [...prev.slice(-49), task.speedBps]);
    }
  }, [task?.downloaded, task?.speedBps, task?.status]);

  if (!task) return null;

  const pct = progressPercent(task.downloaded, task.totalSize);
  const totalSize = task.totalSize ?? 0;
  const activeSegments = task.segments.filter(
    (s) => s.status === "downloading" || s.status === "connecting"
  ).length;

  const maxSpeed = Math.max(...speedHistory, task.speedBps, 1024);

  const sparklinePoints = speedHistory
    .map((v, i) => {
      const x = speedHistory.length <= 1 ? 280 : (i / (speedHistory.length - 1)) * 280;
      const y = 34 - (v / maxSpeed) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints =
    speedHistory.length > 1 ? `0,36 ${sparklinePoints} 280,36` : "";

  function handleCopyUrl() {
    if (!task) return;
    void navigator.clipboard.writeText(task.url).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1400);
    });
  }

  return (
    <>
      {/* Subtle Backdrop on Narrow Viewports (<768px) */}
      <div
        className="fixed inset-0 z-30 bg-black/40 md:hidden"
        onClick={onClose}
      />

      <aside className="ui-drawer-panel fixed inset-y-0 right-0 z-40 flex w-full max-w-[380px] flex-col overflow-hidden md:relative md:inset-auto md:z-auto md:w-[360px] lg:w-[384px] md:max-w-none shrink-0">
        {/* Inspector Header */}
        <div
          className="flex h-11 shrink-0 items-center justify-between gap-2 px-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="min-w-0">
            <h2
              className="truncate text-[13px] font-semibold leading-[18px]"
              title={task.fileName}
            >
              {task.fileName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="ui-btn-ghost flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] cursor-pointer"
            aria-label="Close inspector"
            title="Close inspector (Esc)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* 2x2 Precision Telemetry Grid */}
        <div
          className="grid shrink-0 grid-cols-2 divide-x divide-y"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderBottom: "1px solid var(--border-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.04em]"
              style={{ color: "var(--text-muted)" }}
            >
              Throughput
            </div>
            <div
              className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums"
              style={{
                color: task.speedBps > 0 ? "var(--accent-text)" : "var(--text-primary)",
              }}
            >
              {formatSpeed(task.speedBps)}
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.04em]"
              style={{ color: "var(--text-muted)" }}
            >
              Remaining
            </div>
            <div className="mt-0.5 font-mono text-[14px] font-medium tabular-nums">
              {task.status === "completed" ? "Done" : formatEta(task.etaSeconds)}
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.04em]"
              style={{ color: "var(--text-muted)" }}
            >
              Transferred
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] font-medium tabular-nums">
              {formatBytes(task.downloaded)}
              {task.totalSize ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {" "}
                  / {formatBytes(task.totalSize)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.04em]"
              style={{ color: "var(--text-muted)" }}
            >
              Segmentation
            </div>
            <div className="mt-0.5 font-mono text-[12px] font-medium tabular-nums">
              {task.supportsRange ? (
                <>
                  <span style={{ color: "var(--text-primary)" }}>
                    {activeSegments} active
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}
                    · {task.dynamicSplits} splits
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--text-secondary)" }}>Single stream</span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Inspector Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Progress + Live Sparkline */}
          <div
            className="rounded-[7px] p-3"
            style={{
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="capitalize font-medium" style={{ color: "var(--text-secondary)" }}>
                {task.status}
              </span>
              <span className="font-mono font-medium tabular-nums">
                {task.totalSize ? `${pct.toFixed(1)}%` : formatBytes(task.downloaded)}
              </span>
            </div>

            <div className="ui-progress-track">
              <div
                className="ui-progress-fill"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    task.status === "completed"
                      ? "var(--success)"
                      : task.status === "error"
                      ? "var(--danger)"
                      : task.status === "paused"
                      ? "var(--warning)"
                      : "var(--accent)",
                }}
              />
            </div>

            {speedHistory.length > 1 && (
              <div className="mt-3">
                <div
                  className="mb-1 flex items-center justify-between font-mono text-[11px] tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span>Live speed</span>
                  <span>Peak {formatSpeed(maxSpeed)}</span>
                </div>
                <svg
                  viewBox="0 0 280 36"
                  className="h-9 w-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points={areaPoints}
                    fill="var(--accent)"
                    fillOpacity="0.15"
                  />
                  <polyline
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Hardware-Style Byte Map */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                Byte Range Map
              </span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {task.segments.length} {task.segments.length === 1 ? "segment" : "segments"}
              </span>
            </div>

            {totalSize > 0 && task.segments.length > 0 ? (
              <div
                className="relative h-5 w-full overflow-hidden rounded-[5px]"
                style={{
                  backgroundColor: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {task.segments.map((seg) => {
                  const segLen = Math.max(0, seg.end - seg.start + 1);
                  const leftPct = (seg.start / totalSize) * 100;
                  const widthPct = (segLen / totalSize) * 100;
                  const fillRatio = segLen > 0 ? Math.min(1, seg.downloaded / segLen) : 0;
                  const fillWidthPct = widthPct * fillRatio;

                  return (
                    <div key={seg.id}>
                      <div
                        className="absolute top-0 bottom-0"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          borderLeft: "1px solid var(--bg-elevated)",
                        }}
                        title={`#${seg.id}: ${formatBytes(seg.downloaded)} / ${formatBytes(segLen)} (${seg.status})`}
                      />
                      <div
                        className="absolute top-0 bottom-0 transition-all duration-150"
                        style={{
                          left: `${leftPct}%`,
                          width: `${fillWidthPct}%`,
                          backgroundColor: segmentColorVar(seg.status),
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="flex h-5 items-center justify-center rounded-[5px] font-mono text-[11px]"
                style={{
                  backgroundColor: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-muted)",
                }}
              >
                {task.supportsRange ? "Allocating byte ranges…" : "Sequential stream"}
              </div>
            )}
          </div>

          {/* Streamlined Worker List */}
          {task.segments.length > 0 && (
            <div>
              <div
                className="mb-1.5 text-[12px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Connections
              </div>
              <div
                className="divide-y overflow-hidden rounded-[7px]"
                style={{
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                {task.segments.map((seg) => {
                  const segLen =
                    seg.end >= seg.start && totalSize > 0 ? seg.end - seg.start + 1 : null;
                  const segPct =
                    segLen && segLen > 0 ? Math.min(100, (seg.downloaded / segLen) * 100) : 0;

                  return (
                    <div
                      key={seg.id}
                      className="px-3 py-2 text-[12px]"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: segmentColorVar(seg.status) }}
                          />
                          <span className="font-mono text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                            #{seg.id}
                          </span>
                          <span className="capitalize font-medium">
                            {seg.status}
                          </span>
                          {seg.retries > 0 && (
                            <span className="font-mono text-[11px]" style={{ color: "var(--warning)" }}>
                              r{seg.retries}
                            </span>
                          )}
                        </div>
                        <span
                          className="font-mono text-[11.5px] font-medium tabular-nums"
                          style={{
                            color: seg.speedBps > 0 ? "var(--accent-text)" : "var(--text-muted)",
                          }}
                        >
                          {seg.speedBps > 0 ? formatSpeed(seg.speedBps) : `${segPct.toFixed(0)}%`}
                        </span>
                      </div>
                      <div
                        className="mt-0.5 flex items-center justify-between font-mono text-[11px] tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span>
                          {formatBytes(seg.downloaded)}
                          {segLen !== null ? ` / ${formatBytes(segLen)}` : ""}
                        </span>
                        {totalSize > 0 && (
                          <span>
                            {formatBytes(seg.start)}–{formatBytes(seg.end)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source & File Path Info */}
          <div
            className="space-y-2 rounded-[7px] p-3 text-[11.5px]"
            style={{
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div>
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--text-muted)" }}>Source</span>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="ui-btn-ghost inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] cursor-pointer"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="h-3 w-3" style={{ color: "var(--success)" }} />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div
                className="mt-0.5 truncate font-mono"
                style={{ color: "var(--text-secondary)" }}
                title={task.url}
              >
                {task.url}
              </div>
            </div>

            <div
              className="pt-2"
              style={{ borderTop: "1px solid var(--border-subtle)" }}
            >
              <div style={{ color: "var(--text-muted)" }}>Location</div>
              <div
                className="mt-0.5 truncate font-mono"
                style={{ color: "var(--text-secondary)" }}
                title={task.fullPath}
              >
                {task.fullPath}
              </div>
            </div>
          </div>

          {task.errorMessage && (
            <div
              className="rounded-[6px] px-3 py-2 text-[12px]"
              style={{
                backgroundColor: "var(--danger-soft)",
                border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
                color: "var(--danger)",
              }}
            >
              {task.errorMessage}
            </div>
          )}
        </div>

        {/* Inspector Footer Actions */}
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-1.5">
            {task.status === "downloading" ? (
              <button
                onClick={() => void pauseDownload(task.id)}
                className="ui-btn-secondary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Pause</span>
              </button>
            ) : task.status === "paused" || task.status === "error" ? (
              <button
                onClick={() => void resumeDownload(task.id)}
                className="ui-btn-primary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Resume</span>
              </button>
            ) : null}

            {(task.status === "downloading" || task.status === "paused") && (
              <button
                onClick={() => void cancelDownload(task.id)}
                className="ui-btn-danger flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                <Square className="h-3 w-3" strokeWidth={1.75} />
                <span>Cancel</span>
              </button>
            )}

            {task.status === "completed" && (
              <button
                onClick={() => void openPath(task.fullPath, false)}
                className="ui-btn-primary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Open File</span>
              </button>
            )}
          </div>

          <button
            onClick={() => void openPath(task.fullPath, true)}
            className="ui-btn-secondary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Folder</span>
          </button>
        </div>
      </aside>
    </>
  );
}
