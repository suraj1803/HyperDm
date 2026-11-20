import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Download,
  FolderOpen,
  Layers,
  Pause,
  Play,
  Plus,
  Settings,
  Split,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import {
  cancelDownload,
  getSettings,
  listDownloads,
  onBrowserDownload,
  onDownloadProgress,
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

const STATUS_BADGES: Record<DownloadStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-slate-800 text-slate-300" },
  probing: { label: "Probing", cls: "bg-amber-500/15 text-amber-300" },
  downloading: { label: "Downloading", cls: "bg-sky-500/15 text-sky-300" },
  paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-300" },
  completed: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-300" },
  error: { label: "Error", cls: "bg-rose-500/15 text-rose-300" },
  cancelled: { label: "Cancelled", cls: "bg-slate-800 text-slate-400" },
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenBrowser: (() => void) | undefined;

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
      } catch (err) {
        console.error("Failed to initialize HyperDM:", err);
      }
    }

    void bootstrap();
    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenBrowser) unlistenBrowser();
    };
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === "active") {
        return t.status === "downloading" || t.status === "queued" || t.status === "probing";
      }
      if (filter === "paused") {
        return t.status === "paused" || t.status === "error" || t.status === "cancelled";
      }
      if (filter === "completed") {
        return t.status === "completed";
      }
      return true;
    });
  }, [tasks, filter]);

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
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Toolbar */}
      <header className="flex items-center justify-between border-b border-slate-800/90 bg-slate-900/90 px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-slate-950 shadow-md shadow-sky-500/20">
              <Zap className="h-4.5 w-4.5 fill-slate-950" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-slate-100">HyperDM</div>
              <div className="text-[10px] font-medium text-sky-400">DYNAMIC ENGINE</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-xs hover:bg-sky-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Add URL
            </button>

            <div className="mx-1 h-5 w-px bg-slate-800" />

            <button
              disabled={
                !selectedTask ||
                selectedTask.status === "downloading" ||
                selectedTask.status === "completed"
              }
              onClick={() => selectedTask && void resumeDownload(selectedTask.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              title="Resume selected download"
            >
              <Play className="h-3.5 w-3.5 text-emerald-400" />
              Resume
            </button>

            <button
              disabled={!selectedTask || selectedTask.status !== "downloading"}
              onClick={() => selectedTask && void pauseDownload(selectedTask.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              title="Pause selected download"
            >
              <Pause className="h-3.5 w-3.5 text-amber-400" />
              Pause
            </button>

            <button
              disabled={
                !selectedTask ||
                selectedTask.status === "completed" ||
                selectedTask.status === "cancelled"
              }
              onClick={() => selectedTask && void cancelDownload(selectedTask.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              title="Cancel selected download"
            >
              <Square className="h-3.5 w-3.5 text-rose-400" />
              Stop
            </button>

            <button
              disabled={!selectedTask}
              onClick={() => selectedTask && void handleRemove(selectedTask.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              title="Remove from list"
            >
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
              Remove
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs">
            <Activity className="h-3.5 w-3.5 text-sky-400" />
            <span className="text-slate-400">Speed:</span>
            <span className="font-mono font-semibold text-sky-400 tabular-nums">
              {totalSpeedBps > 0 ? formatSpeed(totalSpeedBps) : "0 B/s"}
            </span>
          </div>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-slate-800/90 bg-slate-900/40 p-3">
          <div className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </div>
          <nav className="space-y-1">
            {(
              [
                { id: "all", label: "All Downloads", icon: Layers, count: counts.all },
                { id: "active", label: "Downloading", icon: Download, count: counts.active },
                { id: "paused", label: "Paused / Stopped", icon: Pause, count: counts.paused },
                { id: "completed", label: "Completed", icon: CheckCircle2, count: counts.completed },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                      active ? "bg-sky-500/20 text-sky-200" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Split className="h-3.5 w-3.5 text-emerald-400" />
              Dynamic Segmentation
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-500">
              Double-click any download to open the live multi-segment visualizer and watch
              connections split in real time.
            </p>
          </div>
        </aside>

        {/* Download Table */}
        <main className="flex-1 overflow-auto">
          {filteredTasks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-sky-400">
                <Download className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-200">No downloads yet</h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Click <strong className="text-slate-300">Add URL</strong> to start a high-speed
                multi-segment download with IDM-style dynamic work stealing.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Download URL
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">File Name</th>
                  <th className="px-3 py-2.5">Size</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="w-48 px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5 text-right">Speed</th>
                  <th className="px-3 py-2.5 text-right">ETA</th>
                  <th className="px-3 py-2.5 text-right">Segments</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 tabular-nums">
                {filteredTasks.map((task) => {
                  const pct = progressPercent(task.downloaded, task.totalSize);
                  const badge = STATUS_BADGES[task.status];
                  const isSelected = task.id === selectedId;
                  const activeConns = task.segments.filter(
                    (s) => s.status === "downloading" || s.status === "connecting"
                  ).length;

                  return (
                    <tr
                      key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      onDoubleClick={() => setInspectId(task.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-sky-500/10"
                          : "hover:bg-slate-900/70"
                      }`}
                    >
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="truncate font-medium text-slate-100">
                          {task.fileName}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {task.saveDir}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-3 py-3 text-slate-300">
                        {formatBytes(task.totalSize)}
                      </td>

                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-3 py-3">
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">
                            {formatBytes(task.downloaded)}
                          </span>
                          <span className="font-mono text-slate-300">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full transition-all duration-150 ${
                              task.status === "completed"
                                ? "bg-emerald-500"
                                : task.status === "error"
                                ? "bg-rose-500"
                                : "bg-sky-500"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sky-400">
                        {formatSpeed(task.speedBps)}
                      </td>

                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-slate-400">
                        {task.status === "completed" ? "—" : formatEta(task.etaSeconds)}
                      </td>

                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectId(task.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-sky-300"
                          title="Open live segment visualizer"
                        >
                          <Split className="h-3 w-3 text-emerald-400" />
                          {task.status === "downloading"
                            ? `${activeConns} active`
                            : `${task.segments.length || 1} seg`}
                        </button>
                      </td>

                      <td
                        className="whitespace-nowrap px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          {task.status === "downloading" ? (
                            <button
                              onClick={() => void pauseDownload(task.id)}
                              className="rounded p-1.5 text-amber-400 hover:bg-slate-800"
                              title="Pause"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          ) : task.status === "paused" || task.status === "error" ? (
                            <button
                              onClick={() => void resumeDownload(task.id)}
                              className="rounded p-1.5 text-emerald-400 hover:bg-slate-800"
                              title="Resume"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          ) : task.status === "completed" ? (
                            <button
                              onClick={() => void openPath(task.fullPath, true)}
                              className="rounded p-1.5 text-sky-400 hover:bg-slate-800"
                              title="Open folder"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </button>
                          ) : null}

                          <button
                            onClick={() => void handleRemove(task.id)}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </main>
      </div>

      {/* Modals */}
      <AddDownloadModal
        isOpen={showAddModal}
        settings={settings}
        onClose={() => setShowAddModal(false)}
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
