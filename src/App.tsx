import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Download,
  Layers,
  Moon,
  Pause,
  Plus,
  Search,
  Settings,
  Split,
  Sun,
  X,
  Zap,
} from "lucide-react";
import {
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
import { DownloadRow } from "./components/DownloadRow";
import { SegmentProgressModal } from "./components/SegmentProgressModal";
import { SettingsModal } from "./components/SettingsModal";
import type { AppSettings, DownloadTaskInfo } from "./types/download";
import { formatSpeed } from "./utils/format";

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

export function App() {
  const [tasks, setTasks] = useState<DownloadTaskInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activatedId, setActivatedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<DownloadTaskInfo | null>(null);
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingYouTubeUrl, setPendingYouTubeUrl] = useState<string | null>(null);
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
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowAddModal(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (confirmDeleteTask) {
          setConfirmDeleteTask(null);
        } else if (selectedId) {
          setSelectedId(null);
        }
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        showAddModal ||
        showSettingsModal ||
        inspectId !== null ||
        confirmDeleteTask !== null ||
        filteredTasks.length === 0
      ) {
        return;
      }

      const currentIdx = filteredTasks.findIndex((t) => t.id === selectedId);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIdx < filteredTasks.length - 1 ? currentIdx + 1 : 0;
        setSelectedId(filteredTasks[nextIdx].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : filteredTasks.length - 1;
        setSelectedId(filteredTasks[prevIdx].id);
      } else if (e.key === "Enter" && currentIdx !== -1) {
        e.preventDefault();
        const target = filteredTasks[currentIdx];
        if (target.status === "completed") {
          void openPath(target.fullPath, false);
        } else {
          setInspectId(target.id);
        }
      } else if (e.key === " " && currentIdx !== -1) {
        e.preventDefault();
        const target = filteredTasks[currentIdx];
        if (target.status === "downloading") {
          void pauseDownload(target.id);
        } else if (target.status === "paused" || target.status === "error") {
          void resumeDownload(target.id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
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

  const totalActiveConns = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "downloading")
        .reduce(
          (acc, t) =>
            acc +
            t.segments.filter((s) => s.status === "downloading" || s.status === "connecting")
              .length,
          0
        ),
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
  }

  function handleRowDoubleClick(task: DownloadTaskInfo) {
    setActivatedId(task.id);
    window.setTimeout(() => {
      setActivatedId((curr) => (curr === task.id ? null : curr));
    }, 240);
    void openPath(task.fullPath, task.status !== "completed");
  }

  const navItems = [
    { id: "all" as const, label: "All Downloads", icon: Layers, count: counts.all },
    { id: "active" as const, label: "Downloading", icon: Download, count: counts.active },
    { id: "paused" as const, label: "Paused & Stopped", icon: Pause, count: counts.paused },
    { id: "completed" as const, label: "Completed", icon: CheckCircle2, count: counts.completed },
  ];

  return (
    <div
      className="flex h-screen flex-col select-none overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Main Workspace Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Precision Sidebar */}
        <aside
          className="flex w-[224px] shrink-0 flex-col justify-between"
          style={{
            backgroundColor: "var(--bg-sidebar)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <div>
            {/* Brand Header */}
            <div
              className="flex h-[56px] items-center justify-between px-4"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-[7px]"
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "var(--accent-fg)",
                  }}
                >
                  <Zap className="h-4 w-4 fill-current" />
                </div>
                <span className="text-[15px] font-semibold tracking-tight">HyperDM</span>
              </div>
              <span
                className="font-mono text-[11.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                v1.0
              </span>
            </div>

            {/* Primary Action */}
            <div className="p-3.5">
              <button
                onClick={() => setShowAddModal(true)}
                className="ui-btn-primary flex h-9 w-full items-center justify-between rounded-[7px] px-3.5 text-[13.5px] font-medium cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New Download
                </span>
                <span
                  className="font-mono text-[11.5px] opacity-80"
                  title="Shortcut: Ctrl+N"
                >
                  ^N
                </span>
              </button>
            </div>

            {/* Filter Navigation */}
            <div className="px-3 pt-1">
              <div
                className="px-2.5 pb-2 text-[11.5px] font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Queue
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = filter === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setFilter(item.id)}
                      className="flex h-9 w-full items-center justify-between rounded-[7px] px-3 text-[13.5px] font-medium transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--bg-active)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon
                          className="h-4 w-4 shrink-0"
                          style={{
                            color: active ? "var(--accent-text)" : "var(--text-muted)",
                          }}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span
                        className="font-mono text-[12px] tabular-nums"
                        style={{
                          color: active ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {item.count}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Sidebar Bottom Engine Summary */}
          <div
            className="px-4 py-3.5 text-[12.5px]"
            style={{
              borderTop: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Split className="h-4 w-4" style={{ color: "var(--success)" }} />
                <span style={{ color: "var(--text-secondary)" }}>Work-Stealing</span>
              </span>
              <span className="font-mono text-[12px] tabular-nums">
                {settings.maxConnectionsPerDownload}x
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span>Concurrent slots</span>
              <span className="font-mono tabular-nums">{settings.maxConcurrentDownloads}</span>
            </div>
          </div>
        </aside>

        {/* Right Main Content Column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Toolbar */}
          <header
            className="flex h-[56px] shrink-0 items-center justify-between gap-3 px-5"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            {/* Inline Search */}
            <div className="relative flex-1 max-w-lg">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter downloads by name or URL..."
                className="ui-input h-9 w-full rounded-[7px] pl-9.5 pr-12 text-[13.5px]"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery("")}
                  className="ui-btn-ghost absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <span className="ui-kbd pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  ^K
                </span>
              )}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className="ui-btn-ghost flex h-9 w-9 items-center justify-center rounded-[7px] cursor-pointer"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
              </button>

              <button
                onClick={() => setShowSettingsModal(true)}
                className="ui-btn-ghost flex h-9 items-center gap-2 rounded-[7px] px-3 text-[13.5px] font-medium cursor-pointer"
                title="Preferences"
              >
                <Settings className="h-[18px] w-[18px]" />
                <span>Settings</span>
              </button>
            </div>
          </header>

          {/* Precision Downloads List */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Subtle View Context Header */}
            <div
              className="flex h-[38px] shrink-0 items-center justify-between px-5 text-[12.5px]"
              style={{
                backgroundColor: "var(--bg-sidebar)",
                borderBottom: "1px solid var(--border-subtle)",
                color: "var(--text-muted)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                  {navItems.find((n) => n.id === filter)?.label}
                </span>
                <span
                  className="rounded-[5px] px-2 py-[1px] font-mono text-[11.5px] tabular-nums"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                  }}
                >
                  {filteredTasks.length}
                </span>
              </div>
              {filteredTasks.length > 0 && (
                <span className="text-[12px] opacity-80">
                  Double-click to open · Space to pause/resume
                </span>
              )}
            </div>

            {/* Rows Container */}
            <div className="flex-1 overflow-y-auto">
              {filteredTasks.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-[10px]"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Download className="h-6 w-6" />
                  </div>
                  <p className="mt-4 text-[15px] font-medium">
                    {searchQuery ? "No matching downloads" : "No downloads yet"}
                  </p>
                  <p
                    className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {searchQuery
                      ? "Try adjusting your filter or clearing the search query."
                      : "Press Ctrl+N to add a direct link or YouTube URL, or trigger a download in your browser."}
                  </p>
                  {!searchQuery && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="ui-btn-primary mt-5 flex h-9 items-center gap-2 rounded-[7px] px-4 text-[13.5px] font-medium cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      Add Download
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
                      onSelect={() => setSelectedId(task.id)}
                      onDoubleClick={() => handleRowDoubleClick(task)}
                      onInspect={() => setInspectId(task.id)}
                      onPause={() => void pauseDownload(task.id)}
                      onResume={() => void resumeDownload(task.id)}
                      onOpenFolder={() => void openPath(task.fullPath, true)}
                      onRequestDelete={() => {
                        setDeleteFromDisk(false);
                        setConfirmDeleteTask(task);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Bottom Telemetry Status Bar */}
      <footer
        className="flex h-[34px] shrink-0 items-center justify-between px-5 text-[12.5px]"
        style={{
          backgroundColor: "var(--bg-sidebar)",
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: settings.bridgeEnabled
                  ? "var(--success)"
                  : "var(--text-muted)",
              }}
            />
            <span>
              Bridge {settings.bridgeEnabled ? `:${settings.bridgePort}` : "off"}
            </span>
          </span>
          <span>·</span>
          <span className="tabular-nums">
            {counts.active} active / {counts.all} total
          </span>
          {totalActiveConns > 0 && (
            <>
              <span>·</span>
              <span className="font-mono tabular-nums">{totalActiveConns} live sockets</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono tabular-nums">
          <Activity
            className="h-3.5 w-3.5"
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

      {/* Modals */}
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

      {/* Delete Confirmation Dialog */}
      {confirmDeleteTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
          <div
            className="w-full max-w-md overflow-hidden rounded-[10px]"
            style={{
              backgroundColor: "var(--bg-elevated)",
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div className="p-5">
              <h3 className="text-[15px] font-semibold">Remove download</h3>
              <p
                className="mt-2 break-all text-[13.5px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {confirmDeleteTask.fileName}
              </p>

              {confirmDeleteTask.status === "completed" && (
                <label
                  className="mt-3.5 flex cursor-pointer items-center gap-2.5 rounded-[7px] px-3 py-2.5 text-[13px]"
                  style={{
                    backgroundColor: "var(--bg-subtle)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteFromDisk}
                    onChange={(e) => setDeleteFromDisk(e.target.checked)}
                    className="h-4 w-4 accent-rose-500"
                  />
                  <span>Also delete file from disk</span>
                </label>
              )}
            </div>

            <div
              className="flex items-center justify-end gap-2.5 px-5 py-3"
              style={{
                backgroundColor: "var(--bg-sidebar)",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmDeleteTask(null)}
                className="ui-btn-secondary h-8.5 rounded-[6px] px-3.5 text-[13px] font-medium cursor-pointer"
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
                className="ui-btn-danger h-8.5 rounded-[6px] px-3.5 text-[13px] font-medium cursor-pointer"
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
