import { useEffect, useState } from "react";
import {
  Activity,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Split,
  Square,
  X,
  Zap,
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

  useEffect(() => {
    setSpeedHistory([]);
  }, [task?.id]);

  useEffect(() => {
    if (!task) return;
    if (task.status === "downloading") {
      setSpeedHistory((prev) => [...prev.slice(-49), task.speedBps]);
    }
  }, [task?.downloaded, task?.speedBps, task?.status]);

  useEffect(() => {
    if (!task) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [task, onClose]);

  if (!task) return null;

  const pct = progressPercent(task.downloaded, task.totalSize);
  const totalSize = task.totalSize ?? 0;
  const activeSegments = task.segments.filter(
    (s) => s.status === "downloading" || s.status === "connecting"
  ).length;

  const maxSpeed = Math.max(...speedHistory, task.speedBps, 1024);

  const sparklinePoints = speedHistory
    .map((v, i) => {
      const x = speedHistory.length <= 1 ? 300 : (i / (speedHistory.length - 1)) * 300;
      const y = 38 - (v / maxSpeed) * 32;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints =
    speedHistory.length > 1 ? `0,40 ${sparklinePoints} 300,40` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[8px]"
        style={{
          backgroundColor: "var(--bg-elevated)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header Bar */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Zap className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-text)" }} />
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold leading-tight">
                {task.fileName}
              </h2>
              <p
                className="truncate font-mono text-[10.5px] leading-tight mt-0.5"
                style={{ color: "var(--text-muted)" }}
              >
                {task.url}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ui-btn-ghost flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 4-Column Compact Telemetry Strip */}
        <div
          className="grid shrink-0 grid-cols-4 divide-x"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderBottom: "1px solid var(--border-subtle)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Speed
            </div>
            <div
              className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums"
              style={{ color: "var(--accent-text)" }}
            >
              {formatSpeed(task.speedBps)}
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Transferred
            </div>
            <div className="mt-0.5 font-mono text-[12px] font-medium tabular-nums">
              {formatBytes(task.downloaded)}
              <span style={{ color: "var(--text-muted)" }}> / {formatBytes(task.totalSize)}</span>
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              ETA
            </div>
            <div className="mt-0.5 font-mono text-[13px] font-medium tabular-nums">
              {task.status === "completed" ? "Done" : formatEta(task.etaSeconds)}
            </div>
          </div>

          <div className="px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              <Split className="h-2.5 w-2.5" style={{ color: "var(--success)" }} />
              Splits
            </div>
            <div
              className="mt-0.5 font-mono text-[13px] font-medium tabular-nums"
              style={{ color: "var(--success)" }}
            >
              {task.dynamicSplits}{" "}
              <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                ({activeSegments} active)
              </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* Overall Progress + Live Sparkline */}
          <div
            className="rounded-[6px] p-3"
            style={{
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
              <span className="font-medium">
                Overall Progress{" "}
                <span className="capitalize" style={{ color: "var(--text-muted)" }}>
                  · {task.status}
                </span>
              </span>
              <span
                className="font-mono font-semibold tabular-nums"
                style={{ color: "var(--accent-text)" }}
              >
                {pct.toFixed(2)}%
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: "var(--bg-active)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    task.status === "completed"
                      ? "var(--success)"
                      : task.status === "error"
                      ? "var(--danger)"
                      : "var(--accent)",
                }}
              />
            </div>

            {speedHistory.length > 1 && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <div
                  className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Activity className="h-3 w-3" style={{ color: "var(--accent-text)" }} />
                  Peak <strong style={{ color: "var(--text-primary)" }}>{formatSpeed(maxSpeed)}</strong>
                </div>
                <svg
                  viewBox="0 0 300 40"
                  className="h-9 w-56 overflow-visible"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points={areaPoints}
                    fill="var(--accent)"
                    fillOpacity="0.18"
                  />
                  <polyline
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Dynamic File Segmentation Map */}
          <div
            className="rounded-[6px] p-3"
            style={{
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
              <span className="font-medium">Dynamic File Segmentation Map</span>
              <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                {task.supportsRange
                  ? `${task.segments.length} seg · work-stealing`
                  : "single-stream"}
              </span>
            </div>

            {totalSize > 0 && task.segments.length > 0 ? (
              <div
                className="relative h-5 w-full overflow-hidden rounded-[4px]"
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
                        title={`Segment #${seg.id}: ${formatBytes(seg.downloaded)} / ${formatBytes(segLen)} (${seg.status})`}
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
                className="flex h-5 items-center justify-center rounded-[4px] font-mono text-[11px]"
                style={{
                  backgroundColor: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-muted)",
                }}
              >
                Waiting for segment allocation…
              </div>
            )}
          </div>

          {/* Per-Connection Table */}
          <div
            className="overflow-hidden rounded-[6px]"
            style={{
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead
                  className="sticky top-0 text-[10px] uppercase tracking-wider"
                  style={{
                    backgroundColor: "var(--bg-sidebar)",
                    borderBottom: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                  }}
                >
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Conn</th>
                    <th className="px-2.5 py-1.5 font-medium">Status</th>
                    <th className="px-2.5 py-1.5 font-medium">Downloaded</th>
                    <th className="px-2.5 py-1.5 font-medium">Byte Range</th>
                    <th className="px-3 py-1.5 text-right font-medium">Speed</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[11px] tabular-nums">
                  {task.segments.map((seg) => {
                    const segLen =
                      seg.end >= seg.start && totalSize > 0 ? seg.end - seg.start + 1 : null;
                    return (
                      <tr
                        key={seg.id}
                        style={{ borderTop: "1px solid var(--border-subtle)" }}
                      >
                        <td className="px-3 py-1.5" style={{ color: "var(--text-muted)" }}>
                          #{seg.id}
                        </td>
                        <td
                          className="px-2.5 py-1.5 font-sans text-[11.5px] font-medium capitalize"
                          style={{ color: segmentColorVar(seg.status) }}
                        >
                          {seg.status}
                          {seg.retries > 0 ? ` (r${seg.retries})` : ""}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {formatBytes(seg.downloaded)}
                          {segLen !== null ? (
                            <span style={{ color: "var(--text-muted)" }}>
                              {" "}
                              / {formatBytes(segLen)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2.5 py-1.5" style={{ color: "var(--text-muted)" }}>
                          {totalSize > 0
                            ? `${formatBytes(seg.start)} – ${formatBytes(seg.end)}`
                            : "stream"}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right font-medium"
                          style={{ color: "var(--accent-text)" }}
                        >
                          {formatSpeed(seg.speedBps)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {task.errorMessage && (
            <div
              className="rounded-[6px] px-3 py-2 text-[11.5px]"
              style={{
                backgroundColor: "var(--danger-soft)",
                border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                color: "var(--danger)",
              }}
            >
              <strong>Error:</strong> {task.errorMessage}
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div
          className="flex shrink-0 items-center justify-between px-4 py-2.5"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-1.5">
            {task.status === "downloading" ? (
              <button
                onClick={() => void pauseDownload(task.id)}
                className="ui-btn-secondary flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
              >
                <Pause className="h-3 w-3" />
                Pause
              </button>
            ) : task.status === "paused" || task.status === "error" ? (
              <button
                onClick={() => void resumeDownload(task.id)}
                className="ui-btn-primary flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
              >
                <Play className="h-3 w-3" />
                Resume
              </button>
            ) : null}

            {(task.status === "downloading" || task.status === "paused") && (
              <button
                onClick={() => void cancelDownload(task.id)}
                className="ui-btn-danger flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
              >
                <Square className="h-3 w-3" />
                Cancel
              </button>
            )}

            {task.status === "completed" && (
              <>
                <button
                  onClick={() => void openPath(task.fullPath, false)}
                  className="ui-btn-primary flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open File
                </button>
                <button
                  onClick={() => void openPath(task.fullPath, true)}
                  className="ui-btn-secondary flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
                >
                  <FolderOpen className="h-3 w-3" />
                  Show in Folder
                </button>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="ui-btn-secondary h-7 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
