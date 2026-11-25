import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Layers,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  clearCompletedDownloads,
  getSettings,
  listDownloads,
  onBrowserDownload,
  onDownloadProgress,
  onYouTubeOpen,
  openPath,
  pauseAllDownloads,
  pauseDownload,
  removeDownload,
  resumeAllDownloads,
  resumeDownload,
} from "./api/tauri";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { DownloadRow } from "./components/DownloadRow";
import { SegmentProgressModal } from "./components/SegmentProgressModal";
import { SettingsModal } from "./components/SettingsModal";
import type { AppSettings, DownloadTaskInfo } from "./types/download";
import { formatSpeed } from "./utils/format";

type FilterTab = "all" | "active" | "paused" | "completed";
type ThemeMode = "dark" | "light";

interface ContextMenuState {
  task: DownloadTaskInfo;
  x: number;
  y: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultSaveDir: "",
  maxConnectionsPerDownload: 8,
  minSplitSizeBytes: 512 * 1024,
  maxConcurrentDownloads: 3,
  bridgeEnabled: true,
  bridgePort: 41920,
  minimizeToTray: true,
};

export function App() {
  const [tasks, setTasks] = useState<DownloadTaskInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activatedId, setActivatedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<DownloadTaskInfo | null>(null);
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingInitialUrl, setPendingInitialUrl] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        });

        unlistenYouTube = await onYouTubeOpen((ytUrl) => {
          setPendingInitialUrl(ytUrl);
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

  // Dismiss context menu on outside interaction, scroll, or resize
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [contextMenu]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      const matchesTab =
        filter === "all"
          ? true
          : filter === "active"
          ? t.status === "downloading" ||
            t.status === "queued" ||
            t.status === "probing" ||
            t.status === "muxing"
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setPendingInitialUrl(null);
        setShowAddModal(true);
        return;
      }
      if ((mod && e.key.toLowerCase() === "k") || (!inInput && e.key === "/")) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (
        mod &&
        e.key.toLowerCase() === "v" &&
        !inInput &&
        !showAddModal &&
        !showSettingsModal &&
        !confirmDeleteTask
      ) {
        void navigator.clipboard
          .readText()
          .then((clip) => {
            const trimmed = clip.trim();
            if (/^https?:\/\//i.test(trimmed)) {
              setPendingInitialUrl(trimmed);
              setShowAddModal(true);
            }
          })
          .catch(() => {});
        return;
      }
      if (e.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
        } else if (confirmDeleteTask) {
          setConfirmDeleteTask(null);
        } else if (inspectId) {
          setInspectId(null);
        } else if (selectedId) {
          setSelectedId(null);
        }
        return;
      }

      if (
        inInput ||
        showAddModal ||
        showSettingsModal ||
        confirmDeleteTask !== null ||
        filteredTasks.length === 0
      ) {
        return;
      }

      const currentIdx = filteredTasks.findIndex((t) => t.id === selectedId);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIdx < filteredTasks.length - 1 ? currentIdx + 1 : 0;
        const nextId = filteredTasks[nextIdx].id;
        setSelectedId(nextId);
        if (inspectId) setInspectId(nextId);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : filteredTasks.length - 1;
        const prevId = filteredTasks[prevIdx].id;
        setSelectedId(prevId);
        if (inspectId) setInspectId(prevId);
      } else if (e.key === "Enter" && currentIdx !== -1) {
        e.preventDefault();
        const target = filteredTasks[currentIdx];
        if (target.status === "completed") {
          void openPath(target.fullPath, false);
        } else {
          setInspectId((curr) => (curr === target.id ? null : target.id));
        }
      } else if (e.key.toLowerCase() === "i" && currentIdx !== -1) {
        e.preventDefault();
        const target = filteredTasks[currentIdx];
        setInspectId((curr) => (curr === target.id ? null : target.id));
      } else if (e.key === " " && currentIdx !== -1) {
        e.preventDefault();
        const target = filteredTasks[currentIdx];
        if (target.status === "downloading") {
          void pauseDownload(target.id);
        } else if (target.status === "paused" || target.status === "error") {
          void resumeDownload(target.id);
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && currentIdx !== -1) {
        e.preventDefault();
        setDeleteFromDisk(false);
        setConfirmDeleteTask(filteredTasks[currentIdx]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    contextMenu,
    confirmDeleteTask,
    selectedId,
    showAddModal,
    showSettingsModal,
    inspectId,
    filteredTasks,
  ]);

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
        (t) =>
          t.status === "downloading" ||
          t.status === "queued" ||
          t.status === "probing" ||
          t.status === "muxing"
      ).length,
      resumable: tasks.filter((t) => t.status === "paused").length,
      paused: tasks.filter(
        (t) => t.status === "paused" || t.status === "error" || t.status === "cancelled"
      ).length,
      completed: tasks.filter((t) => t.status === "completed").length,
    }),
    [tasks]
  );

  async function handleRemove(id: string, alsoDeleteFile: boolean) {
    await removeDownload(id, alsoDeleteFile);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (inspectId === id) setInspectId(null);
    if (selectedId === id) setSelectedId(null);
  }

  async function handlePauseAll() {
    const updated = await pauseAllDownloads();
    setTasks(updated);
  }

  async function handleResumeAll() {
    const updated = await resumeAllDownloads();
    setTasks(updated);
  }

  async function handleClearCompleted() {
    const updated = await clearCompletedDownloads();
    setTasks(updated);
    if (inspectId && !updated.some((t) => t.id === inspectId)) {
      setInspectId(null);
    }
  }

  function handleRowDoubleClick(task: DownloadTaskInfo) {
    setActivatedId(task.id);
    window.setTimeout(() => {
      setActivatedId((curr) => (curr === task.id ? null : curr));
    }, 220);
    void openPath(task.fullPath, task.status !== "completed");
  }

  function openContextMenu(e: React.MouseEvent, task: DownloadTaskInfo) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(task.id);
    const menuWidth = 196;
    const menuHeight = 204;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8));
    setContextMenu({ task, x, y });
  }

  const navItems = [
    { id: "all" as const, label: "All Downloads", short: "All", icon: Layers, count: counts.all },
    { id: "active" as const, label: "Downloading", short: "Active", icon: Download, count: counts.active },
    { id: "paused" as const, label: "Paused", short: "Paused", icon: Pause, count: counts.paused },
    { id: "completed" as const, label: "Completed", short: "Done", icon: CheckCircle2, count: counts.completed },
  ];

  return (
    <div
      className="flex h-screen flex-col select-none overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Main Shell */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Precision Left Sidebar */}
        <aside
          className="hidden sm:flex sm:w-[192px] lg:w-[208px] shrink-0 flex-col justify-between"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <div>
            {/* 48px Brand Header — Aligned 1:1 with Main Toolbar */}
            <div
              className="flex h-12 items-center justify-between px-4"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-[6px]"
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "var(--accent-fg)",
                    boxShadow: "var(--shadow-btn-primary)",
                  }}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={2.25} />
                </div>
                <span className="text-[13.5px] font-semibold tracking-[-0.015em]">
                  HyperDM
                </span>
              </div>
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                1.0.1
              </span>
            </div>

            {/* Navigation */}
            <div className="p-2">
              <div
                className="px-2.5 pt-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--text-muted)" }}
              >
                Queue
              </div>
              <nav className="space-y-0.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = filter === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setFilter(item.id)}
                      className="flex h-8 w-full items-center justify-between rounded-[6px] px-2.5 text-[13px] font-medium transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--bg-active)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon
                          className="h-[15px] w-[15px] shrink-0"
                          strokeWidth={1.75}
                          style={{
                            color: active ? "var(--accent-text)" : "var(--text-muted)",
                          }}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.count > 0 && (
                        <span
                          className="font-mono text-[11px] tabular-nums"
                          style={{
                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                          }}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Sidebar Bottom Utility Footer */}
          <div
            className="flex items-center justify-between gap-1 p-2"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setShowSettingsModal(true)}
              className="ui-btn-ghost flex h-8 flex-1 items-center gap-2 rounded-[6px] px-2.5 text-[13px] font-medium cursor-pointer"
              title="Preferences"
            >
              <Settings className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
              <span className="truncate">Preferences</span>
            </button>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="ui-btn-ghost flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] cursor-pointer"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? (
                <Sun className="h-[15px] w-[15px]" strokeWidth={1.75} />
              ) : (
                <Moon className="h-[15px] w-[15px]" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </aside>

        {/* Right Workspace Column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Unified 48px Toolbar */}
          <header
            className="flex h-12 shrink-0 items-center justify-between gap-2 px-4"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            {/* Search Field */}
            <div className="relative min-w-0 flex-1 max-w-[300px]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                strokeWidth={1.75}
                style={{ color: "var(--text-muted)" }}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search downloads…"
                className="ui-input h-8 w-full rounded-[6px] pl-8 pr-10 text-[13px]"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery("")}
                  className="ui-btn-ghost absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[4px] cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              ) : (
                <span className="ui-kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                  /
                </span>
              )}
            </div>

            {/* Right Contextual Batch Actions & Primary CTA */}
            <div className="flex shrink-0 items-center gap-1.5">
              {counts.active > 0 && (
                <button
                  onClick={() => void handlePauseAll()}
                  className="ui-btn-ghost hidden md:inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium cursor-pointer"
                  title="Pause all active downloads"
                >
                  <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Pause All</span>
                </button>
              )}

              {counts.resumable > 0 && (
                <button
                  onClick={() => void handleResumeAll()}
                  className="ui-btn-ghost hidden md:inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium cursor-pointer"
                  title="Resume all paused downloads"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Resume All</span>
                </button>
              )}

              {counts.completed > 0 && (
                <button
                  onClick={() => void handleClearCompleted()}
                  className="ui-btn-ghost hidden md:inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium cursor-pointer"
                  title="Remove completed items from list (keeps files on disk)"
                >
                  <span>Clear Done</span>
                </button>
              )}

              {/* Compact Theme + Settings when sidebar is collapsed (<640px) */}
              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className="ui-btn-ghost flex sm:hidden h-8 w-8 items-center justify-center rounded-[6px] cursor-pointer"
                title="Toggle theme"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Moon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="ui-btn-ghost flex sm:hidden h-8 w-8 items-center justify-center rounded-[6px] cursor-pointer"
                title="Preferences"
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} />
              </button>

              <button
                onClick={() => {
                  setPendingInitialUrl(null);
                  setShowAddModal(true);
                }}
                className="ui-btn-primary flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium cursor-pointer"
                title="New Download (Ctrl+N)"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">New Download</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </header>

          {/* Compact Filter Strip when sidebar is collapsed (<640px) */}
          <div
            className="flex sm:hidden shrink-0 items-center justify-between gap-1 overflow-x-auto px-3 py-1.5"
            style={{
              backgroundColor: "var(--bg-sidebar)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div className="flex items-center gap-1">
              {navItems.map((item) => {
                const active = filter === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setFilter(item.id)}
                    className="flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium cursor-pointer"
                    style={{
                      backgroundColor: active ? "var(--bg-active)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    <span>{item.short}</span>
                    {item.count > 0 && (
                      <span className="font-mono text-[11px] tabular-nums opacity-75">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content Split: Queue List + Optional Slide-Over Segment Inspector */}
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              {filteredTasks.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Download className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </div>
                  <p className="mt-3.5 text-[14px] font-medium">
                    {searchQuery
                      ? "No matching downloads"
                      : filter === "all"
                      ? "No downloads yet"
                      : `No ${filter} downloads`}
                  </p>
                  <p
                    className="mt-1 max-w-[300px] text-[12.5px] leading-[18px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {searchQuery
                      ? "Try clearing the search query or switching queue filters."
                      : "Paste a link anywhere with Ctrl+V, press Ctrl+N, or start a download from your browser."}
                  </p>
                  {!searchQuery && filter === "all" && (
                    <button
                      onClick={() => {
                        setPendingInitialUrl(null);
                        setShowAddModal(true);
                      }}
                      className="ui-btn-secondary mt-4 flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>Add Download</span>
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {filteredTasks.map((task) => (
                    <DownloadRow
                      key={task.id}
                      task={task}
                      selected={task.id === selectedId}
                      activated={task.id === activatedId}
                      inspected={task.id === inspectId}
                      onSelect={() => {
                        setSelectedId(task.id);
                        if (inspectId && inspectId !== task.id) {
                          setInspectId(task.id);
                        }
                      }}
                      onDoubleClick={() => handleRowDoubleClick(task)}
                      onContextMenu={(e) => openContextMenu(e, task)}
                      onInspect={() =>
                        setInspectId((curr) => (curr === task.id ? null : task.id))
                      }
                      onPause={() => void pauseDownload(task.id)}
                      onResume={() => void resumeDownload(task.id)}
                      onOpenFile={() => void openPath(task.fullPath, false)}
                      onOpenFolder={() => void openPath(task.fullPath, true)}
                      onRequestDelete={() => {
                        setDeleteFromDisk(false);
                        setConfirmDeleteTask(task);
                      }}
                    />
                  ))}
                </div>
              )}
            </main>

            {/* Right Slide-Over Segment Inspector */}
            <SegmentProgressModal
              task={inspectedTask}
              onClose={() => setInspectId(null)}
            />
          </div>
        </div>
      </div>

      {/* Minimal 28px Status Bar */}
      <footer
        className="flex h-7 shrink-0 items-center justify-between gap-2 px-4 text-[12px]"
        style={{
          backgroundColor: "var(--bg-sidebar)",
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5 truncate">
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: settings.bridgeEnabled
                  ? "var(--success)"
                  : "var(--text-muted)",
              }}
            />
            <span className="font-mono text-[11.5px]">
              {settings.bridgeEnabled ? `127.0.0.1:${settings.bridgePort}` : "Bridge off"}
            </span>
          </span>
          <span>·</span>
          <span className="truncate tabular-nums">
            {counts.active > 0
              ? `${counts.active} active of ${counts.all}`
              : `${counts.all} ${counts.all === 1 ? "item" : "items"}`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
          <Activity
            className="h-3 w-3"
            strokeWidth={1.75}
            style={{ color: totalSpeedBps > 0 ? "var(--accent-text)" : "var(--text-muted)" }}
          />
          <span
            className="font-medium"
            style={{ color: totalSpeedBps > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            {totalSpeedBps > 0 ? formatSpeed(totalSpeedBps) : "0 B/s"}
          </span>
        </div>
      </footer>

      {/* Viewport-Aware Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="ui-context-menu fixed z-50 w-[196px] rounded-[8px] p-1 text-[12.5px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.task.status === "completed" && (
            <button
              onClick={() => {
                void openPath(contextMenu.task.fullPath, false);
                setContextMenu(null);
              }}
              className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
              style={{ color: "var(--text-primary)" }}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
              <span>Open File</span>
            </button>
          )}

          <button
            onClick={() => {
              void openPath(contextMenu.task.fullPath, true);
              setContextMenu(null);
            }}
            className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
            style={{ color: "var(--text-primary)" }}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
            <span>Show in Folder</span>
          </button>

          {contextMenu.task.status === "downloading" ? (
            <button
              onClick={() => {
                void pauseDownload(contextMenu.task.id);
                setContextMenu(null);
              }}
              className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
              style={{ color: "var(--text-primary)" }}
            >
              <Pause className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
              <span>Pause Download</span>
            </button>
          ) : contextMenu.task.status === "paused" || contextMenu.task.status === "error" ? (
            <button
              onClick={() => {
                void resumeDownload(contextMenu.task.id);
                setContextMenu(null);
              }}
              className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
              style={{ color: "var(--text-primary)" }}
            >
              <Play className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--accent-text)" }} />
              <span>Resume Download</span>
            </button>
          ) : null}

          <button
            onClick={() => {
              setInspectId(contextMenu.task.id);
              setContextMenu(null);
            }}
            className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
            style={{ color: "var(--text-primary)" }}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
            <span>Inspect Segments</span>
          </button>

          <button
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.task.url).catch(() => {});
              setContextMenu(null);
            }}
            className="ui-btn-ghost flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
            style={{ color: "var(--text-primary)" }}
          >
            <Copy className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} style={{ color: "var(--text-muted)" }} />
            <span>Copy Download URL</span>
          </button>

          <div
            className="my-1 h-[1px]"
            style={{ backgroundColor: "var(--border-subtle)" }}
          />

          <button
            onClick={() => {
              const target = contextMenu.task;
              setContextMenu(null);
              setDeleteFromDisk(false);
              setConfirmDeleteTask(target);
            }}
            className="ui-btn-ghost ui-action-danger flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left cursor-pointer"
            style={{ color: "var(--danger)" }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span>Remove…</span>
          </button>
        </div>
      )}

      {/* Modals */}
      <AddDownloadModal
        isOpen={showAddModal}
        initialUrl={pendingInitialUrl}
        settings={settings}
        onClose={() => {
          setShowAddModal(false);
          setPendingInitialUrl(null);
        }}
        onCreated={(task) => {
          setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
          setSelectedId(task.id);
        }}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        settings={settings}
        onClose={() => setShowSettingsModal(false)}
        onSaved={(updated) => setSettings(updated)}
      />

      {/* Remove Confirmation Dialog */}
      {confirmDeleteTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
          onClick={() => setConfirmDeleteTask(null)}
        >
          <div
            className="ui-modal-panel w-full max-w-[400px] overflow-hidden rounded-[10px]"
            style={{
              backgroundColor: "var(--bg-elevated)",
              boxShadow: "var(--shadow-modal)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4">
              <h3 className="text-[14px] font-semibold">Remove download</h3>
              <p
                className="mt-1.5 break-all text-[12.5px] leading-[18px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {confirmDeleteTask.fileName}
              </p>

              {confirmDeleteTask.status === "completed" && (
                <label
                  className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-[6px] px-3 py-2 text-[12.5px]"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteFromDisk}
                    onChange={(e) => setDeleteFromDisk(e.target.checked)}
                    className="h-3.5 w-3.5 accent-red-500"
                  />
                  <span>Also delete file from disk</span>
                </label>
              )}
            </div>

            <div
              className="flex items-center justify-end gap-2 px-4 py-2.5"
              style={{
                backgroundColor: "var(--bg-sidebar)",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmDeleteTask(null)}
                className="ui-btn-secondary h-8 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmDeleteTask;
                  const fromDisk = deleteFromDisk;
                  setConfirmDeleteTask(null);
                  void handleRemove(target.id, fromDisk);
                }}
                className="ui-btn-danger h-8 rounded-[6px] px-3 text-[12.5px] font-medium cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
