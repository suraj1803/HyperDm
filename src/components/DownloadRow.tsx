import {
  Activity,
  Check,
  Download,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  HardDrive,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import type { DownloadStatus, DownloadTaskInfo } from "../types/download";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  progressPercent,
} from "../utils/format";

interface DownloadRowProps {
  task: DownloadTaskInfo;
  selected: boolean;
  activated: boolean;
  inspected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onInspect: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onRequestDelete: () => void;
}

function getFileVisual(fileName: string): {
  Icon: typeof Download;
  bg: string;
  fg: string;
} {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mkv", "webm", "avi", "mov"].includes(ext)) {
    return {
      Icon: FileVideo,
      bg: "rgba(139, 92, 246, 0.10)",
      fg: "#a78bfa",
    };
  }
  if (["mp3", "flac", "wav", "ogg", "m4a"].includes(ext)) {
    return {
      Icon: FileAudio,
      bg: "rgba(236, 72, 153, 0.10)",
      fg: "#f472b6",
    };
  }
  if (["zip", "rar", "7z", "tar", "gz", "xz", "bz2", "zst"].includes(ext)) {
    return {
      Icon: FileArchive,
      bg: "rgba(245, 158, 11, 0.10)",
      fg: "#fbbf24",
    };
  }
  if (["iso", "img", "dmg", "appimage", "deb", "rpm", "exe", "msi"].includes(ext)) {
    return {
      Icon: HardDrive,
      bg: "rgba(56, 189, 248, 0.10)",
      fg: "#38bdf8",
    };
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return {
      Icon: FileImage,
      bg: "rgba(20, 184, 166, 0.10)",
      fg: "#2dd4bf",
    };
  }
  if (["js", "ts", "rs", "py", "json", "html", "css"].includes(ext)) {
    return {
      Icon: FileCode,
      bg: "rgba(34, 197, 94, 0.10)",
      fg: "#4ade80",
    };
  }
  if (["pdf", "doc", "docx", "txt", "md", "csv"].includes(ext)) {
    return {
      Icon: FileText,
      bg: "var(--bg-subtle)",
      fg: "var(--text-secondary)",
    };
  }
  return {
    Icon: Download,
    bg: "var(--bg-subtle)",
    fg: "var(--text-secondary)",
  };
}

function getStatusBadge(status: DownloadStatus): { label: string; dot: string; text: string } {
  switch (status) {
    case "downloading":
      return { label: "Downloading", dot: "var(--accent)", text: "var(--accent-text)" };
    case "muxing":
      return { label: "Merging", dot: "var(--info)", text: "var(--info)" };
    case "completed":
      return { label: "Done", dot: "var(--success)", text: "var(--text-secondary)" };
    case "paused":
      return { label: "Paused", dot: "var(--warning)", text: "var(--warning)" };
    case "error":
      return { label: "Error", dot: "var(--danger)", text: "var(--danger)" };
    case "probing":
      return { label: "Probing", dot: "var(--info)", text: "var(--info)" };
    case "queued":
      return { label: "Queued", dot: "var(--text-muted)", text: "var(--text-muted)" };
    default:
      return { label: "Cancelled", dot: "var(--text-muted)", text: "var(--text-muted)" };
  }
}

function extractHost(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "");
    if (host.includes("googlevideo.com")) return "youtube.com";
    return host;
  } catch {
    return null;
  }
}

export function DownloadRow({
  task,
  selected,
  activated,
  inspected,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onInspect,
  onPause,
  onResume,
  onOpenFile,
  onOpenFolder,
  onRequestDelete,
}: DownloadRowProps) {
  const pct = progressPercent(task.downloaded, task.totalSize);
  const statusMeta = getStatusBadge(task.status);
  const { Icon: FileIcon, bg: iconBg, fg: iconFg } = getFileVisual(task.fileName);
  const host = extractHost(task.finalUrl || task.url);

  const isDownloading = task.status === "downloading";
  const isPaused = task.status === "paused";
  const isMuxing = task.status === "muxing";
  const isProbing = task.status === "probing";
  const isCompleted = task.status === "completed";
  const isError = task.status === "error";

  const showProgressTrack =
    isDownloading ||
    isPaused ||
    isMuxing ||
    isProbing ||
    (isError && task.downloaded > 0 && (task.totalSize ?? 0) > 0);

  const isIndeterminate =
    isProbing || isMuxing || (isDownloading && (!task.totalSize || task.totalSize <= 0));

  return (
    <div
      data-selected={selected || inspected}
      data-activated={activated}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="ui-row group relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 cursor-pointer"
    >
      {/* Crisp Edge-to-Edge Left Selection / Active Accent Line */}
      {(selected || inspected) && (
        <span
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px]"
          style={{ backgroundColor: "var(--accent)" }}
        />
      )}

      {/* File Icon Tile or Media Thumbnail */}
      {task.mediaThumbnail ? (
        <img
          src={task.mediaThumbnail}
          alt=""
          className="h-9 w-[52px] shrink-0 rounded-[6px] object-cover"
          style={{ border: "1px solid var(--border-subtle)" }}
        />
      ) : (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px]"
          style={{
            backgroundColor: isError ? "var(--danger-soft)" : iconBg,
            color: isError ? "var(--danger)" : iconFg,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <FileIcon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      )}

      {/* Center Content: Filename + Precision Progress Track + Telemetry */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-[18px]">
            {task.fileName}
          </span>
          {task.mediaQualityLabel && (
            <span
              className="inline-flex h-4 shrink-0 items-center rounded-[4px] px-1.5 font-mono text-[10.5px] leading-none"
              style={{
                backgroundColor: "var(--bg-subtle)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              {task.mediaQualityLabel.split(" ")[0]}
            </span>
          )}
        </div>

        {showProgressTrack && (
          <div className="ui-progress-track mt-1.5 mb-1">
            {isIndeterminate ? (
              <div className="ui-progress-indeterminate" />
            ) : (
              <div
                className="ui-progress-fill"
                style={{
                  width: `${pct}%`,
                  backgroundColor: isError
                    ? "var(--danger)"
                    : isPaused
                    ? "var(--warning)"
                    : "var(--accent)",
                }}
              />
            )}
          </div>
        )}

        <div
          className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] leading-[16px]"
          style={{ color: "var(--text-muted)" }}
        >
          {isError && task.errorMessage ? (
            <span className="truncate" style={{ color: "var(--danger)" }} title={task.errorMessage}>
              {task.errorMessage}
            </span>
          ) : isDownloading ? (
            <>
              <span className="font-mono tabular-nums">
                {formatBytes(task.downloaded)}
                {task.totalSize ? ` / ${formatBytes(task.totalSize)}` : ""}
              </span>
              <span>·</span>
              <span
                className="font-mono font-medium tabular-nums"
                style={{ color: "var(--text-primary)" }}
              >
                {formatSpeed(task.speedBps)}
              </span>
              {task.etaSeconds !== null && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{formatEta(task.etaSeconds)} left</span>
                </>
              )}
            </>
          ) : isMuxing ? (
            <span style={{ color: "var(--info)" }}>Merging video and audio streams…</span>
          ) : isProbing ? (
            <span>Inspecting remote source…</span>
          ) : isPaused ? (
            <>
              <span className="font-mono tabular-nums">
                {task.totalSize
                  ? `${formatBytes(task.downloaded)} / ${formatBytes(task.totalSize)}`
                  : formatBytes(task.downloaded)}
              </span>
              {task.totalSize ? (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{pct.toFixed(0)}%</span>
                </>
              ) : null}
              {host && (
                <>
                  <span>·</span>
                  <span className="truncate">{host}</span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-mono tabular-nums">
                {isCompleted
                  ? formatBytes(task.totalSize ?? task.downloaded)
                  : task.totalSize
                  ? formatBytes(task.totalSize)
                  : "Pending"}
              </span>
              {host && (
                <>
                  <span>·</span>
                  <span className="truncate">{host}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Status Readout + Zero-Reflow Hover Action Pill */}
      <div className="relative flex min-w-[84px] shrink-0 items-center justify-end">
        <div className="flex items-center justify-end gap-1.5 text-[12px]">
          {isDownloading ? (
            <span
              className="font-mono font-medium tabular-nums"
              style={{ color: "var(--accent-text)" }}
            >
              {task.totalSize ? `${pct.toFixed(1)}%` : "Live"}
            </span>
          ) : isCompleted ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--text-muted)" }}
            >
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} style={{ color: "var(--success)" }} />
              <span>Done</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 font-medium"
              style={{ color: statusMeta.text }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: statusMeta.dot }}
              />
              <span>{statusMeta.label}</span>
            </span>
          )}
        </div>

        {/* Overlay Action Pill on Hover / Focus */}
        <div
          className="ui-row-actions absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-[6px] p-0.5"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {isDownloading ? (
            <button
              onClick={onPause}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              title="Pause (Space)"
            >
              <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : isPaused || isError ? (
            <button
              onClick={onResume}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              style={{ color: "var(--accent-text)" }}
              title="Resume (Space)"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : isCompleted ? (
            <button
              onClick={onOpenFile}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              title="Open file (Enter)"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}

          <button
            onClick={onOpenFolder}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            title="Show in folder"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>

          <button
            onClick={onInspect}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            style={{ color: inspected ? "var(--accent-text)" : undefined }}
            title="Inspect segments (I)"
          >
            <Activity className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>

          <button
            onClick={onRequestDelete}
            className="ui-btn-ghost ui-action-danger flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            title="Remove (Del)"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
