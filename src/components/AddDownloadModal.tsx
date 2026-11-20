import { useEffect, useState } from "react";
import {
  FolderOpen,
  Globe,
  Loader2,
  ShieldAlert,
  Sparkles,
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
      // Cancelled
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
      <div
        className="w-full max-w-xl rounded-[28px] p-6"
        style={{
          backgroundColor: "var(--md-surface-container-high)",
          boxShadow: "var(--md-shadow-3)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: "var(--md-primary-container)",
                color: "var(--md-on-primary-container)",
              }}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-medium tracking-tight">New Download</h2>
              <p className="text-xs" style={{ color: "var(--md-on-surface-variant)" }}>
                Dynamic multi-segment acceleration
              </p>
            </div>
          </div>
          <button onClick={onClose} className="md-icon-btn p-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* URL Input */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              Download URL
            </label>
            <div className="flex gap-2.5">
              <div className="relative flex-1">
                <Globe
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: "var(--md-on-surface-variant)" }}
                />
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
                  className="md-input w-full rounded-xl py-2.5 pl-10 pr-3.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !url.trim()}
                className="md-btn-tonal flex items-center gap-1.5 rounded-full px-4 text-xs font-medium"
              >
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Probe
              </button>
            </div>
          </div>

          {/* Probe Result Card */}
          {probe && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-xs"
              style={{ backgroundColor: "var(--md-surface-container)" }}
            >
              <div className="flex items-center gap-3">
                <span style={{ color: "var(--md-on-surface-variant)" }}>
                  Size:{" "}
                  <strong className="font-semibold" style={{ color: "var(--md-on-surface)" }}>
                    {formatBytes(probe.totalSize)}
                  </strong>
                </span>
                {probe.contentType && (
                  <span
                    className="truncate max-w-[180px]"
                    style={{ color: "var(--md-on-surface-variant)" }}
                  >
                    {probe.contentType.split(";")[0]}
                  </span>
                )}
              </div>
              {probe.supportsRange ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--md-tertiary-container)",
                    color: "var(--md-on-tertiary-container)",
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Dynamic Multi-Segment Ready
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium"
                  style={{
                    backgroundColor: "var(--md-warning-container)",
                    color: "var(--md-on-warning-container)",
                  }}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Single Stream Only
                </span>
              )}
            </div>
          )}

          {/* Filename & Connections */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                File Name
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Auto-detected from server"
                className="md-input w-full rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label
                className="mb-1.5 flex items-center justify-between text-xs font-medium"
                style={{ color: "var(--md-on-surface-variant)" }}
              >
                <span>Max Connections</span>
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }}
                >
                  {maxConnections}
                </span>
              </label>
              <div
                className="flex h-[42px] items-center rounded-xl px-3.5"
                style={{ backgroundColor: "var(--md-surface-container)" }}
              >
                <input
                  type="range"
                  min={1}
                  max={16}
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  className="md-slider w-full"
                />
              </div>
            </div>
          </div>

          {/* Save Directory */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: "var(--md-on-surface-variant)" }}
            >
              Save Folder
            </label>
            <div className="flex gap-2.5">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="md-input flex-1 rounded-xl px-3.5 py-2.5 text-sm"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="md-btn-outlined flex items-center gap-1.5 rounded-full px-4 text-xs font-medium"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </button>
            </div>
          </div>

          {error && (
            <div
              className="rounded-2xl px-4 py-3 text-xs"
              style={{
                backgroundColor: "var(--md-error-container)",
                color: "var(--md-on-error-container)",
              }}
            >
              {error}
            </div>
          )}

          {/* M3 Dialog Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-2.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: "var(--md-primary)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !url.trim()}
              className="md-btn-filled flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-semibold"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Start Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
