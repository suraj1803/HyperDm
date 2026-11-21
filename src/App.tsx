import { useEffect, useMemo, useState } from "react";
import {
  Activity,
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
  Layers,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Split,
  Square,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  cancelDownload,
  getSettings,
  listDownloads,
  onBrowserDownload,
  onDownloadProgress,
  onYouTubeOpen,
  openPath,
  pauseDownload,
  removeDownload,
  resumeDownload,
} from "./api/tauri";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { SegmentProgressModal } from "./components/SegmentProgressModal";
import { SettingsModal } from "./components/SettingsModal";
import type { AppSettings, DownloadStatus, DownloadTaskInfo } from "./types/download";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  progressPercent,
} from "./utils/format";

type FilterTab = "all" | "active" | "paused" | "completed";
type ThemeMode = "dark" | "light";

const DEFAULT_SETTINGS: AppSettings = {
  defaultSaveDir: "",
  maxConnectionsPerDownload: 8,
  minSplitSizeBytes: 512 * 1024,
  maxConcurrentDownloads: 3,
  bridgeEnabled: true,
  bridgePort: 41920,
  minimizeToTray: true,
};

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz", "xz", "bz2", "zst"].includes(ext)) return FileArchive;
  if (["mp4", "mkv", "webm", "avi", "mov"].includes(ext)) return FileVideo;
  if (["mp3", "flac", "wav", "ogg", "m4a"].includes(ext)) return FileAudio;
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return FileImage;
  if (["iso", "img", "dmg", "appimage", "deb", "rpm", "exe", "msi"].includes(ext)) return HardDrive;
  if (["pdf", "doc", "docx", "txt", "md", "csv"].includes(ext)) return FileText;
  if (["js", "ts", "rs", "py", "json", "html", "css"].includes(ext)) return FileCode;
  return Download;
}

function getStatusChipStyle(status: DownloadStatus): { label: string; bg: string; fg: string } {
  switch (status) {
    case "downloading":
      return {
        label: "Downloading",
        bg: "var(--md-primary-container)",
        fg: "var(--md-on-primary-container)",
      };
    case "muxing":
      return {
        label: "Merging…",
        bg: "var(--md-secondary-container)",
        fg: "var(--md-on-secondary-container)",
      };
    case "completed":
      return {
        label: "Completed",
        bg: "var(--md-tertiary-container)",
        fg: "var(--md-on-tertiary-container)",
      };
    case "paused":
      return {
        label: "Paused",
        bg: "var(--md-warning-container)",
        fg: "var(--md-on-warning-container)",
      };
    case "error":
      return {
        label: "Error",
        bg: "var(--md-error-container)",
        fg: "var(--md-on-error-container)",
      };
    case "probing":
      return {
        label: "Probing",
        bg: "var(--md-secondary-container)",
        fg: "var(--md-on-secondary-container)",
      };
    case "queued":
      return {
        label: "Queued",
        bg: "var(--md-surface-container-highest)",
        fg: "var(--md-on-surface-variant)",
      };
    default:
      return {
        label: "Cancelled",
        bg: "var(--md-surface-container-highest)",
        fg: "var(--md-on-surface-variant)",
      };
  }
}

export function App() {
  const [tasks, setTasks] = useState<DownloadTaskInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingYouTubeUrl, setPendingYouTubeUrl] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("hyperdm-theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hyperdm-theme", theme);
  }, [theme]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenBrowser: (() => void) | undefined;
    let unlistenYouTube: (() => void) | undefined;

    async function bootstrap() {
      try {
        const [initialTasks, initialSettings] = await Promise.all([
          listDownloads(),
          getSettings(),
        ]);
        setTasks(initialTasks);
        setSettings(initialSettings);

        unlistenProgress = await onDownloadProgress((updated) => {
          setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === updated.id);
            if (idx === -1) {
              return [updated, ...prev];
            }
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        });

        unlistenBrowser = await onBrowserDownload((incoming) => {
          setTasks((prev) => [incoming, ...prev.filter((t) => t.id !== incoming.id)]);
          setSelectedId(incoming.id);
          setInspectId(incoming.id);
        });

        unlistenYouTube = await onYouTubeOpen((ytUrl) => {
          setPendingYouTubeUrl(ytUrl);
          setShowAddModal(true);
        });
      } catch (err) {
        console.error("Failed to initialize HyperDM:", err);
      }
    }

    void bootstrap();
    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenBrowser) unlistenBrowser();
      if (unlistenYouTube) unlistenYouTube();
    };
  }, []);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      const matchesTab =
        filter === "all"
          ? true
          : filter === "active"
          ? t.status === "downloading" || t.status === "queued" || t.status === "probing"
          : filter === "paused"
          ? t.status === "paused" || t.status === "error" || t.status === "cancelled"
          : t.status === "completed";

      if (!matchesTab) return false;
      if (!q) return true;
      return (
        t.fileName.toLowerCase().includes(q) ||
        t.url.toLowerCase().includes(q)
      );
    });
  }, [tasks, filter, searchQuery]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId]
  );

  const inspectedTask = useMemo(
    () => tasks.find((t) => t.id === inspectId) ?? null,
    [tasks, inspectId]
  );

  const totalSpeedBps = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "downloading")
        .reduce((acc, t) => acc + t.speedBps, 0),
    [tasks]
  );

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter(
        (t) => t.status === "downloading" || t.status === "queued" || t.status === "probing"
      ).length,
      paused: tasks.filter(
        (t) => t.status === "paused" || t.status === "error" || t.status === "cancelled"
      ).length,
      completed: tasks.filter((t) => t.status === "completed").length,
    }),
    [tasks]
  );

  async function handleRemove(id: string) {
    await removeDownload(id, false);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (inspectId === id) setInspectId(null);
  }

  return (
    <div
      className="flex h-screen select-none overflow-hidden"
      style={{ backgroundColor: "var(--md-surface)", color: "var(--md-on-surface)" }}
    >
      {/* Material 3 Navigation Drawer */}
      <aside className="flex w-64 shrink-0 flex-col justify-between px-3 py-4">
        <div>
          {/* Brand */}
          <div className="flex items-center gap-3 px-3 pb-5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: "var(--md-primary)",
                color: "var(--md-on-primary)",
                boxShadow: "var(--md-shadow-1)",
              }}
            >
              <Zap className="h-5 w-5 fill-current" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">HyperDM</div>
              <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
                Dynamic Download Engine
              </div>
            </div>
          </div>

          {/* M3 Extended FAB */}
          <div className="px-1 pb-5">
            <button
              onClick={() => setShowAddModal(true)}
              className="md-fab flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 text-sm font-medium cursor-pointer"
            >
              <Plus className="h-5 w-5" />
              <span>New Download</span>
            </button>
          </div>

          {/* M3 Pill Navigation Items */}
          <nav className="space-y-1">
            {(
              [
                { id: "all", label: "All Downloads", icon: Layers, count: counts.all },
                { id: "active", label: "Downloading", icon: Download, count: counts.active },
                { id: "paused", label: "Paused & Stopped", icon: Pause, count: counts.paused },
                { id: "completed", label: "Completed", icon: CheckCircle2, count: counts.completed },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  className="flex w-full items-center justify-between rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--md-secondary-container)" : "transparent",
                    color: active
                      ? "var(--md-on-secondary-container)"
                      : "var(--md-on-surface-variant)",
                  }}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4.5 w-4.5" />
                    {item.label}
                  </span>
                  <span className="text-xs font-semibold tabular-nums opacity-85">
                    {item.count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Status Card */}
        <div
          className="rounded-2xl p-3.5 text-xs"
          style={{ backgroundColor: "var(--md-surface-container-low)" }}
        >
          <div className="flex items-center gap-2 font-medium">
            <Split className="h-4 w-4" style={{ color: "var(--md-tertiary)" }} />
            <span>Dynamic Work-Stealing</span>
          </div>
          <p
            className="mt-1 text-[11px] leading-relaxed"
            style={{ color: "var(--md-on-surface-variant)" }}
          >
            Up to {settings.maxConnectionsPerDownload} parallel connections · Bridge{" "}
            {settings.bridgeEnabled ? `:${settings.bridgePort}` : "off"}
          </p>
        </div>
      </aside>

      {/* Right Main Column */}
      <div className="flex flex-1 flex-col overflow-hidden pr-4 pb-4">
        {/* Material 3 Top App Bar */}
        <header className="flex items-center justify-between gap-4 py-3.5">
          {/* Pill Search Field */}
          <div className="relative flex-1 max-w-xl">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2"
              style={{ color: "var(--md-on-surface-variant)" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search downloads by name or URL"
              className="w-full rounded-full py-2.5 pl-11 pr-10 text-sm outline-none transition-shadow"
              style={{
                backgroundColor: "var(--md-surface-container-high)",
                color: "var(--md-on-surface)",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="md-icon-btn absolute right-2 top-1/2 -translate-y-1/2 p-1"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Right App Bar Controls */}
          <div className="flex items-center gap-2">
            {/* Live Speed Assist Chip */}
            <div
              className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium"
              style={{
                backgroundColor:
                  totalSpeedBps > 0
                    ? "var(--md-primary-container)"
                    : "var(--md-surface-container-high)",
                color:
                  totalSpeedBps > 0
                    ? "var(--md-on-primary-container)"
                    : "var(--md-on-surface-variant)",
              }}
            >
              <Activity className="h-4 w-4" />
              <span className="font-mono font-semibold tabular-nums">
                {totalSpeedBps > 0 ? formatSpeed(totalSpeedBps) : "0 B/s"}
              </span>
            </div>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="md-icon-btn p-2.5 cursor-pointer"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="md-icon-btn p-2.5 cursor-pointer"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Main Content Surface Sheet (M3 Rounded-3xl Container) */}
        <main
          className="flex flex-1 flex-col overflow-hidden rounded-[24px]"
          style={{
            backgroundColor: "var(--md-surface-container-low)",
            boxShadow: "var(--md-shadow-1)",
          }}
        >
          {/* Contextual Selection Bar */}
          {selectedTask && (
            <div
              className="flex items-center justify-between gap-3 px-5 py-2.5"
              style={{
                backgroundColor: "var(--md-surface-container-high)",
                borderBottom: "1px solid color-mix(in srgb, var(--md-outline-variant) 40%, transparent)",
              }}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md-icon-btn p-1"
                  title="Clear selection"
                >
                  <X className="h-4 w-4" />
                </button>
                <span className="truncate">{selectedTask.fileName}</span>
              </div>

              <div className="flex items-center gap-1.5">
                {selectedTask.status === "downloading" ? (
                  <button
                    onClick={() => void pauseDownload(selectedTask.id)}
                    className="md-btn-tonal flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </button>
                ) : selectedTask.status !== "completed" ? (
                  <button
                    onClick={() => void resumeDownload(selectedTask.id)}
                    className="md-btn-filled flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </button>
                ) : null}

                {selectedTask.status !== "completed" && selectedTask.status !== "cancelled" && (
                  <button
                    onClick={() => void cancelDownload(selectedTask.id)}
                    className="md-btn-outlined flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </button>
                )}

                <button
                  onClick={() => setInspectId(selectedTask.id)}
                  className="md-btn-outlined flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Statistics
                </button>

                <button
                  onClick={() => void handleRemove(selectedTask.id)}
                  className="md-icon-btn p-2 cursor-pointer"
                  style={{ color: "var(--md-error)" }}
                  title="Remove from list"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Downloads List */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredTasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-3xl"
                  style={{
                    backgroundColor: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }}
                >
                  <Download className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-base font-medium">
                  {searchQuery ? "No matching downloads" : "Your downloads will appear here"}
                </h3>
                <p
                  className="mt-1 max-w-sm text-xs leading-relaxed"
                  style={{ color: "var(--md-on-surface-variant)" }}
                >
                  {searchQuery
                    ? "Try a different filename or clear the search bar."
                    : "Click New Download or download any file in your browser to accelerate it with HyperDM."}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="md-btn-filled mt-5 flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    Add Download URL
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredTasks.map((task) => {
                  const pct = progressPercent(task.downloaded, task.totalSize);
                  const chip = getStatusChipStyle(task.status);
                  const isSelected = task.id === selectedId;
                  const FileIcon = getFileIcon(task.fileName);
                  const activeConns = task.segments.filter(
                    (s) => s.status === "downloading" || s.status === "connecting"
                  ).length;

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      onDoubleClick={() =>
                        void openPath(task.fullPath, task.status !== "completed")
                      }
                      title={
                        task.status === "completed"
                          ? "Double-click to open file"
                          : "Double-click to open save folder"
                      }
                      className="group flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors cursor-pointer"
                      style={{
                        backgroundColor: isSelected
                          ? "var(--md-surface-container-highest)"
                          : "var(--md-surface-container)",
                      }}
                    >
                      {/* File Type Tonal Avatar */}
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                        style={{
                          backgroundColor:
                            task.status === "completed"
                              ? "var(--md-tertiary-container)"
                              : "var(--md-surface-container-high)",
                          color:
                            task.status === "completed"
                              ? "var(--md-on-tertiary-container)"
                              : "var(--md-primary)",
                        }}
                      >
                        <FileIcon className="h-5 w-5" />
                      </div>

                      {/* Name + Progress Bar */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium">{task.fileName}</span>
                          <span
                            className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                            style={{ backgroundColor: chip.bg, color: chip.fg }}
                          >
                            {chip.label}
                          </span>
                        </div>

                        {/* M3 Linear Progress Track */}
                        <div
                          className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
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

                        {/* Meta Row */}
                        <div
                          className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums"
                          style={{ color: "var(--md-on-surface-variant)" }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span>
                              {formatBytes(task.downloaded)} / {formatBytes(task.totalSize)}
                            </span>
                            <span>·</span>
                            <span className="font-mono font-medium">{pct.toFixed(1)}%</span>
                            {task.status === "downloading" && (
                              <>
                                <span>·</span>
                                <span
                                  className="font-mono font-semibold"
                                  style={{ color: "var(--md-primary)" }}
                                >
                                  {formatSpeed(task.speedBps)}
                                </span>
                                <span>·</span>
                                <span>{formatEta(task.etaSeconds)} left</span>
                              </>
                            )}
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectId(task.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
                            style={{
                              backgroundColor: "var(--md-surface-container-high)",
                              color: "var(--md-on-surface)",
                            }}
                            title="Inspect live dynamic segments"
                          >
                            <Split className="h-3 w-3" style={{ color: "var(--md-tertiary)" }} />
                            {task.status === "downloading"
                              ? `${activeConns} active`
                              : `${task.segments.length || 1} seg`}
                          </button>
                        </div>
                      </div>

                      {/* Inline Quick Actions */}
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setInspectId(task.id)}
                          className="md-icon-btn p-2 cursor-pointer"
                          title="View download statistics & segments"
                        >
                          <BarChart3 className="h-4.5 w-4.5" />
                        </button>

                        {task.status === "downloading" ? (
                          <button
                            onClick={() => void pauseDownload(task.id)}
                            className="md-icon-btn p-2 cursor-pointer"
                            title="Pause"
                          >
                            <Pause className="h-4.5 w-4.5" />
                          </button>
                        ) : task.status === "paused" || task.status === "error" ? (
                          <button
                            onClick={() => void resumeDownload(task.id)}
                            className="md-icon-btn p-2 cursor-pointer"
                            style={{ color: "var(--md-primary)" }}
                            title="Resume"
                          >
                            <Play className="h-4.5 w-4.5" />
                          </button>
                        ) : task.status === "completed" ? (
                          <button
                            onClick={() => void openPath(task.fullPath, true)}
                            className="md-icon-btn p-2 cursor-pointer"
                            style={{ color: "var(--md-primary)" }}
                            title="Show in folder"
                          >
                            <FolderOpen className="h-4.5 w-4.5" />
                          </button>
                        ) : null}

                        <button
                          onClick={() => void handleRemove(task.id)}
                          className="md-icon-btn p-2 cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Material 3 Dialogs */}
      <AddDownloadModal
        isOpen={showAddModal}
        initialUrl={pendingYouTubeUrl}
        settings={settings}
        onClose={() => {
          setShowAddModal(false);
          setPendingYouTubeUrl(null);
        }}
        onCreated={(task) => {
          setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
          setSelectedId(task.id);
          setInspectId(task.id);
        }}
      />

      <SegmentProgressModal
        task={inspectedTask}
        onClose={() => setInspectId(null)}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        settings={settings}
        onClose={() => setShowSettingsModal(false)}
        onSaved={(updated) => setSettings(updated)}
      />
    </div>
  );
}

export default App;
