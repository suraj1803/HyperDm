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

const SEGMENT_STATUS_COLORS: Record<SegmentStatus, string> = {
  pending: "text-slate-400",
  connecting: "text-amber-400",
  downloading: "text-sky-400",
  completed: "text-emerald-400",
  paused: "text-slate-400",
  error: "text-rose-400",
};

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
      const y = 44 - (v / maxSpeed) * 40;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 shrink-0 text-sky-400" />
              <h2 className="truncate text-sm font-semibold text-slate-100">
                {task.fileName}
              </h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">{task.url}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Top Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                Transfer Rate
              </div>
              <div className="mt-1 text-base font-bold text-sky-400 tabular-nums">
                {formatSpeed(task.speedBps)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                Downloaded
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-100 tabular-nums">
                {formatBytes(task.downloaded)}{" "}
                <span className="text-xs font-normal text-slate-500">
                  / {formatBytes(task.totalSize)}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">
                Time Left
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-100 tabular-nums">
                {task.status === "completed" ? "Done" : formatEta(task.etaSeconds)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-500">
                <Split className="h-3 w-3 text-emerald-400" />
                Dynamic Splits
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-400 tabular-nums">
                {task.dynamicSplits}{" "}
                <span className="text-xs font-normal text-slate-500">
                  ({activeSegments} active)
                </span>
              </div>
            </div>
          </div>

          {/* Aggregate Progress + Sparkline */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                Overall Progress ({task.status.toUpperCase()})
              </span>
              <span className="font-mono font-semibold text-sky-400 tabular-nums">
                {pct.toFixed(2)}%
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-150 ${
                  task.status === "completed"
                    ? "bg-emerald-500"
                    : task.status === "error"
                    ? "bg-rose-500"
                    : "bg-gradient-to-r from-sky-500 to-cyan-400"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {speedHistory.length > 1 && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Activity className="h-3.5 w-3.5 text-sky-400" />
                  Live Speed Graph (Peak: {formatSpeed(maxSpeed)})
                </div>
                <svg
                  viewBox="0 0 300 46"
                  className="h-10 w-56 overflow-visible"
                  preserveAspectRatio="none"
                >
                  <polyline
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            )}
          </div>

          {/* IDM Signature Multi-Segment Visualizer Bar */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">
                Dynamic File Segmentation Map
              </span>
              <span className="text-[11px] text-slate-400">
                {task.supportsRange
                  ? `${task.segments.length} total segment(s) • work-stealing enabled`
                  : "Single-stream download (server does not support Range)"}
              </span>
            </div>

            {totalSize > 0 && task.segments.length > 0 ? (
              <div className="relative h-7 w-full overflow-hidden rounded-md border border-slate-800 bg-slate-900">
                {task.segments.map((seg) => {
                  const segLen = Math.max(0, seg.end - seg.start + 1);
                  const leftPct = (seg.start / totalSize) * 100;
                  const widthPct = (segLen / totalSize) * 100;
                  const fillRatio = segLen > 0 ? Math.min(1, seg.downloaded / segLen) : 0;
                  const fillWidthPct = widthPct * fillRatio;

                  return (
                    <div key={seg.id}>
                      {/* Segment boundary marker */}
                      <div
                        className="absolute top-0 bottom-0 border-l border-slate-950/90"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                        title={`Segment #${seg.id}: ${formatBytes(seg.downloaded)} / ${formatBytes(segLen)} (${seg.status})`}
                      />
                      {/* Filled portion */}
                      <div
                        className={`absolute top-0 bottom-0 transition-all duration-150 ${
                          seg.status === "completed"
                            ? "bg-emerald-500/85"
                            : seg.status === "downloading"
                            ? "bg-sky-500"
                            : seg.status === "error"
                            ? "bg-rose-500/80"
                            : "bg-slate-600"
                        }`}
                        style={{
                          left: `${leftPct}%`,
                          width: `${fillWidthPct}%`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-7 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-xs text-slate-500">
                Waiting for segment allocation...
              </div>
            )}
          </div>

          {/* Per-Connection Table */}
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
            <div className="border-b border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300">
              Connection Details
            </div>
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3.5 py-2">Conn</th>
                    <th className="px-3.5 py-2">Status</th>
                    <th className="px-3.5 py-2">Downloaded</th>
                    <th className="px-3.5 py-2">Range</th>
                    <th className="px-3.5 py-2 text-right">Speed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 tabular-nums">
                  {task.segments.map((seg) => {
                    const segLen =
                      seg.end >= seg.start && totalSize > 0 ? seg.end - seg.start + 1 : null;
                    return (
                      <tr key={seg.id} className="hover:bg-slate-900/60">
                        <td className="px-3.5 py-2 font-mono text-slate-300">#{seg.id}</td>
                        <td
                          className={`px-3.5 py-2 font-medium capitalize ${SEGMENT_STATUS_COLORS[seg.status]}`}
                        >
                          {seg.status}
                          {seg.retries > 0 ? ` (retry ${seg.retries})` : ""}
                        </td>
                        <td className="px-3.5 py-2 text-slate-200">
                          {formatBytes(seg.downloaded)}
                          {segLen !== null ? (
                            <span className="text-slate-500"> / {formatBytes(segLen)}</span>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-2 font-mono text-[11px] text-slate-400">
                          {totalSize > 0
                            ? `${formatBytes(seg.start)} – ${formatBytes(seg.end)}`
                            : "stream"}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono text-sky-400">
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
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              <strong>Error:</strong> {task.errorMessage}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-5 py-3">
          <div className="flex items-center gap-2">
            {task.status === "downloading" ? (
              <button
                onClick={() => void pauseDownload(task.id)}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
            ) : task.status === "paused" || task.status === "error" ? (
              <button
                onClick={() => void resumeDownload(task.id)}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </button>
            ) : null}

            {(task.status === "downloading" || task.status === "paused") && (
              <button
                onClick={() => void cancelDownload(task.id)}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
              >
                <Square className="h-3.5 w-3.5" />
                Cancel
              </button>
            )}

            {task.status === "completed" && (
              <>
                <button
                  onClick={() => void openPath(task.fullPath, false)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open File
                </button>
                <button
                  onClick={() => void openPath(task.fullPath, true)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open Folder
                </button>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
