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
      return "var(--md-tertiary)";
    case "downloading":
      return "var(--md-primary)";
    case "connecting":
      return "var(--md-warning)";
    case "error":
      return "var(--md-error)";
    default:
      return "var(--md-outline)";
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
      const y = 44 - (v / maxSpeed) * 38;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints =
    speedHistory.length > 1 ? `0,46 ${sparklinePoints} 300,46` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px]"
        style={{
          backgroundColor: "var(--md-surface-container-high)",
          boxShadow: "var(--md-shadow-3)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: "var(--md-primary-container)",
                color: "var(--md-on-primary-container)",
              }}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium tracking-tight">
                {task.fileName}
              </h2>
              <p
                className="mt-0.5 truncate text-xs"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                {task.url}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="md-icon-btn p-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-5">
          {/* M3 Tonal Metric Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div
              className="rounded-2xl p-3.5"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div
                className="text-[11px] font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                Transfer Rate
              </div>
              <div
                className="mt-1 text-lg font-semibold tabular-nums"
                style={{ color: "var(--md-primary)" }}
              >
                {formatSpeed(task.speedBps)}
              </div>
            </div>

            <div
              className="rounded-2xl p-3.5"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div
                className="text-[11px] font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                Downloaded
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums">
                {formatBytes(task.downloaded)}
                <span
                  className="block text-[11px] font-normal"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  of {formatBytes(task.totalSize)}
                </span>
              </div>
            </div>

            <div
              className="rounded-2xl p-3.5"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div
                className="text-[11px] font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                Time Left
              </div>
              <div className="mt-1 text-base font-semibold tabular-nums">
                {task.status === "completed" ? "Done" : formatEta(task.etaSeconds)}
              </div>
            </div>

            <div
              className="rounded-2xl p-3.5"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div
                className="flex items-center gap-1 text-[11px] font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                <Split className="h-3.5 w-3.5" style={{ color: "var(--md-tertiary)" }} />
                Dynamic Splits
              </div>
              <div
                className="mt-1 text-base font-semibold tabular-nums"
                style={{ color: "var(--md-tertiary)" }}
              >
                {task.dynamicSplits}{" "}
                <span
                  className="text-xs font-normal"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  ({activeSegments} active)
                </span>
              </div>
            </div>
          </div>

          {/* Overall Progress + Live Speed Sparkline */}
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="font-medium">
                Overall Progress ·{" "}
                <span className="capitalize" style={{ color: "var(--md-on-surface-variant)" }}>
                  {task.status}
                </span>
              </span>
              <span
                className="font-mono font-semibold tabular-nums"
                style={{ color: "var(--md-primary)" }}
              >
                {pct.toFixed(2)}%
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: "var(--md-surface-container-highest)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    task.status === "completed"
                      ? "var(--md-tertiary)"
                      : task.status === "error"
                      ? "var(--md-error)"
                      : "var(--md-primary)",
                }}
              />
            </div>

            {speedHistory.length > 1 && (
              <div className="mt-4 flex items-center justify-between gap-4">
                <div
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  <Activity className="h-3.5 w-3.5" style={{ color: "var(--md-primary)" }} />
                  Peak: <strong style={{ color: "var(--md-on-surface)" }}>{formatSpeed(maxSpeed)}</strong>
                </div>
                <svg
                  viewBox="0 0 300 46"
                  className="h-11 w-60 overflow-visible"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points={areaPoints}
                    fill="var(--md-primary)"
                    fillOpacity="0.14"
                  />
                  <polyline
                    fill="none"
                    stroke="var(--md-primary)"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Multi-Segment Visualizer Bar */}
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="font-medium">Dynamic File Segmentation Map</span>
              <span style={{ color: "var(--md-on-surface-variant)" }}>
                {task.supportsRange
                  ? `${task.segments.length} segment(s) · work-stealing active`
                  : "Single-stream mode"}
              </span>
            </div>

            {totalSize > 0 && task.segments.length > 0 ? (
              <div
                className="relative h-7 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--md-surface-container-highest)" }}
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
                          borderLeft: "1.5px solid var(--md-surface-container)",
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
                className="flex h-7 items-center justify-center rounded-full text-xs"
                style={{
                  backgroundColor: "var(--md-surface-container-highest)",
                  color: "var(--md-on-surface-variant)",
                }}
              >
                Waiting for segment allocation…
              </div>
            )}
          </div>

          {/* Per-Connection Table */}
          <div
            className="overflow-hidden rounded-2xl"
            style={{ backgroundColor: "var(--md-surface-container)" }}
          >
            <div
              className="px-4 py-2.5 text-xs font-medium"
              style={{
                borderBottom: "1px solid var(--md-outline-variant)",
                color: "var(--md-on-surface-variant)",
              }}
            >
              Connection Details
            </div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead
                  className="sticky top-0 text-[11px]"
                  style={{
                    backgroundColor: "var(--md-surface-container)",
                    color: "var(--md-on-surface-variant)",
                  }}
                >
                  <tr>
                    <th className="px-4 py-2 font-medium">Conn</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Downloaded</th>
                    <th className="px-3 py-2 font-medium">Range</th>
                    <th className="px-4 py-2 text-right font-medium">Speed</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {task.segments.map((seg) => {
                    const segLen =
                      seg.end >= seg.start && totalSize > 0 ? seg.end - seg.start + 1 : null;
                    return (
                      <tr
                        key={seg.id}
                        style={{ borderTop: "1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent)" }}
                      >
                        <td className="px-4 py-2 font-mono">#{seg.id}</td>
                        <td
                          className="px-3 py-2 font-medium capitalize"
                          style={{ color: segmentColorVar(seg.status) }}
                        >
                          {seg.status}
                          {seg.retries > 0 ? ` (retry ${seg.retries})` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {formatBytes(seg.downloaded)}
                          {segLen !== null ? (
                            <span style={{ color: "var(--md-on-surface-variant)" }}>
                              {" "}
                              / {formatBytes(segLen)}
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-[11px]"
                          style={{ color: "var(--md-on-surface-variant)" }}
                        >
                          {totalSize > 0
                            ? `${formatBytes(seg.start)} – ${formatBytes(seg.end)}`
                            : "stream"}
                        </td>
                        <td
                          className="px-4 py-2 text-right font-mono font-medium"
                          style={{ color: "var(--md-primary)" }}
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
              className="rounded-2xl px-4 py-3 text-xs"
              style={{
                backgroundColor: "var(--md-error-container)",
                color: "var(--md-on-error-container)",
              }}
            >
              <strong>Error:</strong> {task.errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{
            backgroundColor: "var(--md-surface-container)",
            borderTop: "1px solid color-mix(in srgb, var(--md-outline-variant) 40%, transparent)",
          }}
        >
          <div className="flex items-center gap-2">
            {task.status === "downloading" ? (
              <button
                onClick={() => void pauseDownload(task.id)}
                className="md-btn-tonal flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
            ) : task.status === "paused" || task.status === "error" ? (
              <button
                onClick={() => void resumeDownload(task.id)}
                className="md-btn-filled flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </button>
            ) : null}

            {(task.status === "downloading" || task.status === "paused") && (
              <button
                onClick={() => void cancelDownload(task.id)}
                className="md-btn-outlined flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium"
                style={{ color: "var(--md-error)" }}
              >
                <Square className="h-3.5 w-3.5" />
                Cancel
              </button>
            )}

            {task.status === "completed" && (
              <>
                <button
                  onClick={() => void openPath(task.fullPath, false)}
                  className="md-btn-filled flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open File
                </button>
                <button
                  onClick={() => void openPath(task.fullPath, true)}
                  className="md-btn-tonal flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Show in Folder
                </button>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="rounded-full px-5 py-2 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--md-primary)" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
