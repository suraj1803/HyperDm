import {
  BarChart3,
  CheckCircle2,
  Download,
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
  onSelect: () => void;
  onDoubleClick: () => void;
  onInspect: () => void;
  onPause: () => void;
  onResume: () => void;
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
      bg: "rgba(139, 92, 246, 0.13)",
      fg: "#a78bfa",
    };
  }
  if (["mp3", "flac", "wav", "ogg", "m4a"].includes(ext)) {
    return {
      Icon: FileAudio,
      bg: "rgba(236, 72, 153, 0.13)",
      fg: "#f472b6",
    };
  }
  if (["zip", "rar", "7z", "tar", "gz", "xz", "bz2", "zst"].includes(ext)) {
    return {
      Icon: FileArchive,
      bg: "rgba(245, 158, 11, 0.13)",
      fg: "#fbbf24",
    };
  }
  if (["iso", "img", "dmg", "appimage", "deb", "rpm", "exe", "msi"].includes(ext)) {
    return {
      Icon: HardDrive,
      bg: "rgba(56, 189, 248, 0.13)",
      fg: "#38bdf8",
    };
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return {
      Icon: FileImage,
      bg: "rgba(20, 184, 166, 0.13)",
      fg: "#2dd4bf",
    };
  }
  if (["js", "ts", "rs", "py", "json", "html", "css"].includes(ext)) {
    return {
      Icon: FileCode,
      bg: "rgba(52, 211, 153, 0.13)",
      fg: "#34d399",
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
      return { label: "Merging…", dot: "var(--info)", text: "var(--info)" };
    case "completed":
      return { label: "Completed", dot: "var(--success)", text: "var(--success)" };
    case "paused":
      return { label: "Paused", dot: "var(--warning)", text: "var(--warning)" };
    case "error":
      return { label: "Error", dot: "var(--danger)", text: "var(--danger)" };
    case "probing":
      return { label: "Probing…", dot: "var(--info)", text: "var(--info)" };
    case "queued":
      return { label: "Queued", dot: "var(--text-muted)", text: "var(--text-secondary)" };
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
  onSelect,
  onDoubleClick,
  onInspect,
  onPause,
  onResume,
  onOpenFolder,
  onRequestDelete,
}: DownloadRowProps) {
  const pct = progressPercent(task.downloaded, task.totalSize);
  const statusMeta = getStatusBadge(task.status);
  const { Icon: FileIcon, bg: iconBg, fg: iconFg } = getFileVisual(task.fileName);
  const host = extractHost(task.finalUrl || task.url);

  const isDownloading = task.status === "downloading";
  const isCompleted = task.status === "completed";
  const isError = task.status === "error";

  return (
    <div
      data-selected={selected}
      data-activated={activated}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      title={
        isError && task.errorMessage
          ? `Error: ${task.errorMessage}`
          : isCompleted
          ? "Double-click to open file"
          : "Double-click to open save folder"
      }
      className="ui-row group relative flex items-center gap-4 px-5 py-3.5 cursor-pointer"
    >
      {/* Left Selection / Active Accent Indicator (Linear-style) */}
      {(selected || isDownloading) && (
        <span
          className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{
            backgroundColor: selected ? "var(--accent)" : "var(--accent-soft)",
          }}
        />
      )}

      {/* Left Visual Anchor: YouTube Thumbnail or Tinted File-Type Tile */}
      {task.mediaThumbnail ? (
        <img
          src={task.mediaThumbnail}
          alt=""
          className="h-10 w-16 shrink-0 rounded-[6px] object-cover"
          style={{ border: "1px solid var(--border-subtle)" }}
        />
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
          style={{
            backgroundColor: isError ? "var(--danger-soft)" : iconBg,
            color: isError ? "var(--danger)" : iconFg,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <FileIcon className="h-[18px] w-[18px]" />
        </div>
      )}

      {/* Center Content: Title + Rich Contextual Metadata */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-[14px] font-medium tracking-[0.005em] leading-snug">
            {task.fileName}
          </span>
          {task.mediaQualityLabel && (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-[2px] font-mono text-[11px] leading-tight"
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

        {/* Subtitle Metadata Line */}
        <div
          className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          {isError && task.errorMessage ? (
            <span className="truncate" style={{ color: "var(--danger)" }}>
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
                style={{ color: "var(--accent-text)" }}
              >
                {formatSpeed(task.speedBps)}
              </span>
              {task.etaSeconds !== null && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">
                    {formatEta(task.etaSeconds)} left
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-mono tabular-nums">
                {isCompleted
                  ? formatBytes(task.totalSize ?? task.downloaded)
                  : task.totalSize
                  ? `${formatBytes(task.downloaded)} / ${formatBytes(task.totalSize)}`
                  : formatBytes(task.downloaded)}
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

      {/* Right Side: Progressive-Disclosure Action Pill + Clean Status/Percentage */}
      <div className="flex shrink-0 items-center gap-3.5">
        {/* Hover / Selected Floating Action Pill */}
        <div
          className="ui-row-actions flex items-center gap-1 rounded-[7px] p-1"
          style={{
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {isDownloading ? (
            <button
              onClick={onPause}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              title="Pause (Space)"
            >
              <Pause className="h-4 w-4" />
            </button>
          ) : task.status === "paused" || isError ? (
            <button
              onClick={onResume}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              style={{ color: "var(--accent-text)" }}
              title="Resume (Space)"
            >
              <Play className="h-4 w-4" />
            </button>
          ) : isCompleted ? (
            <button
              onClick={onOpenFolder}
              className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
              style={{ color: "var(--accent-text)" }}
              title="Show in folder"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          ) : null}

          <button
            onClick={onInspect}
            className="ui-btn-ghost flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            title="Inspect segments & throughput"
          >
            <BarChart3 className="h-4 w-4" />
          </button>

          <button
            onClick={onRequestDelete}
            className="ui-btn-ghost ui-action-danger flex h-7 w-7 items-center justify-center rounded-[5px] cursor-pointer"
            title="Remove"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Status / Percentage Indicator */}
        <div className="flex min-w-[88px] items-center justify-end gap-2 text-[13px] font-medium">
          {isDownloading ? (
            <>
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
              />
              <span
                className="font-mono text-[13.5px] font-semibold tabular-nums"
                style={{ color: "var(--accent-text)" }}
              >
                {pct.toFixed(1)}%
              </span>
            </>
          ) : isCompleted ? (
            <>
              <CheckCircle2
                className="h-4 w-4 shrink-0"
                style={{ color: "var(--success)" }}
              />
              <span style={{ color: "var(--text-secondary)" }}>Done</span>
            </>
          ) : (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statusMeta.dot }}
              />
              <span style={{ color: statusMeta.text }}>{statusMeta.label}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
