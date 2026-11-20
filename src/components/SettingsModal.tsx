import { useEffect, useState } from "react";
import { FolderOpen, Settings as SettingsIcon, X } from "lucide-react";
import { pickDirectory, updateSettings } from "../api/tauri";
import type { AppSettings } from "../types/download";

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSaved: (updated: AppSettings) => void;
}

export function SettingsModal({
  isOpen,
  settings,
  onClose,
  onSaved,
}: SettingsModalProps) {
  const [defaultSaveDir, setDefaultSaveDir] = useState(settings.defaultSaveDir);
  const [maxConnections, setMaxConnections] = useState(settings.maxConnectionsPerDownload);
  const [minSplitKb, setMinSplitKb] = useState(Math.round(settings.minSplitSizeBytes / 1024));
  const [bridgeEnabled, setBridgeEnabled] = useState(settings.bridgeEnabled);
  const [bridgePort, setBridgePort] = useState(settings.bridgePort);
  const [minimizeToTray, setMinimizeToTray] = useState(settings.minimizeToTray);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDefaultSaveDir(settings.defaultSaveDir);
      setMaxConnections(settings.maxConnectionsPerDownload);
      setMinSplitKb(Math.round(settings.minSplitSizeBytes / 1024));
      setBridgeEnabled(settings.bridgeEnabled);
      setBridgePort(settings.bridgePort);
      setMinimizeToTray(settings.minimizeToTray);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  async function handleBrowse() {
    try {
      const dir = await pickDirectory(defaultSaveDir);
      if (dir) setDefaultSaveDir(dir);
    } catch {
      // Cancelled
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateSettings({
        ...settings,
        defaultSaveDir,
        maxConnectionsPerDownload: maxConnections,
        minSplitSizeBytes: minSplitKb * 1024,
        bridgeEnabled,
        bridgePort,
        minimizeToTray,
      });
      onSaved(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <SettingsIcon className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">HyperDM Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Default Download Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={defaultSaveDir}
                onChange={(e) => setDefaultSaveDir(e.target.value)}
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

          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Default Max Connections per Download</span>
              <span className="font-mono text-sky-400">{maxConnections}</span>
            </label>
            <input
              type="range"
              min={1}
              max={16}
              value={maxConnections}
              onChange={(e) => setMaxConnections(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              IDM-style default is 8 connections. Higher values can improve speed on high-latency links.
            </p>
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Minimum Dynamic Split Size</span>
              <span className="font-mono text-sky-400">{minSplitKb} KB</span>
            </label>
            <input
              type="range"
              min={128}
              max={4096}
              step={128}
              value={minSplitKb}
              onChange={(e) => setMinSplitKb(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Idle workers split an active segment in half whenever its remaining tail exceeds this threshold.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Browser Extension Bridge
                </div>
                <div className="text-[11px] text-slate-500">
                  Accept intercepted downloads from Chrome, Brave, Edge & Firefox
                </div>
              </div>
              <input
                type="checkbox"
                checked={bridgeEnabled}
                onChange={(e) => setBridgeEnabled(e.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-400">Local Bridge Port (restart to apply)</span>
              <input
                type="number"
                min={1024}
                max={65535}
                value={bridgePort}
                onChange={(e) => setBridgePort(Number(e.target.value) || 41920)}
                className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-right font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Load <code className="text-sky-400">browser-extension/</code> via{" "}
              <code className="text-slate-300">chrome://extensions</code> (Developer Mode → Load unpacked) or Firefox{" "}
              <code className="text-slate-300">about:debugging</code>.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">
                Close Window to System Tray
              </div>
              <div className="text-[11px] text-slate-500">
                Keep downloads & browser bridge running in the background when closed
              </div>
            </div>
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={(e) => setMinimizeToTray(e.target.checked)}
              className="h-4 w-4 accent-sky-500"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
