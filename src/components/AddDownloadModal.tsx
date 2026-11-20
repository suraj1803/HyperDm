import { useEffect, useState } from "react";
import {
  FolderOpen,
  Globe,
  Loader2,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react";
import { addDownload, pickDirectory, probeUrl } from "../api/tauri";
import type { AppSettings, DownloadTaskInfo, ProbeResult } from "../types/download";
import { formatBytes } from "../utils/format";

interface AddDownloadModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onCreated: (task: DownloadTaskInfo) => void;
}

export function AddDownloadModal({
  isOpen,
  settings,
  onClose,
  onCreated,
}: AddDownloadModalProps) {
  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState(settings.defaultSaveDir);
  const [fileName, setFileName] = useState("");
  const [maxConnections, setMaxConnections] = useState(settings.maxConnectionsPerDownload);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl("");
      setSaveDir(settings.defaultSaveDir);
      setFileName("");
      setMaxConnections(settings.maxConnectionsPerDownload);
      setProbe(null);
      setError(null);
      setProbing(false);
      setSubmitting(false);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  async function handleProbe() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setProbing(true);
    setError(null);
    try {
      const result = await probeUrl(trimmed);
      setProbe(result);
      setFileName(result.fileName);
    } catch (err) {
      setProbe(null);
      setError(String(err));
    } finally {
      setProbing(false);
    }
  }

  async function handleBrowse() {
    try {
      const dir = await pickDirectory(saveDir);
      if (dir) setSaveDir(dir);
    } catch {
      // User cancelled or dialog unavailable
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a valid HTTP/HTTPS download URL.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const task = await addDownload({
        url: trimmed,
        saveDir: saveDir.trim() || undefined,
        fileName: fileName.trim() || undefined,
        maxConnections,
      });
      onCreated(task);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Add New Download</h2>
              <p className="text-xs text-slate-400">Dynamic multi-segment acceleration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Download URL
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="url"
                  required
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => {
                    if (url.trim().startsWith("http") && !probe) {
                      void handleProbe();
                    }
                  }}
                  placeholder="https://example.com/large-file.iso"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !url.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Probe
              </button>
            </div>
          </div>

          {probe && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-slate-400">
                  Size:{" "}
                  <strong className="font-semibold text-slate-100">
                    {formatBytes(probe.totalSize)}
                  </strong>
                </span>
                {probe.contentType && (
                  <span className="text-slate-500 truncate max-w-[180px]">
                    {probe.contentType.split(";")[0]}
                  </span>
                )}
              </div>
              {probe.supportsRange ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-400">
                  <Zap className="h-3 w-3" />
                  Dynamic Multi-Segment Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-400">
                  <ShieldAlert className="h-3 w-3" />
                  Single Stream Only
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                File Name
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Auto-detected from server"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
                <span>Max Connections</span>
                <span className="font-mono text-sky-400">{maxConnections}</span>
              </label>
              <div className="flex h-[38px] items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3">
                <input
                  type="range"
                  min={1}
                  max={16}
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  className="w-full accent-sky-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Save Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !url.trim()}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Start Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
