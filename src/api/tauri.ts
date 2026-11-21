import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AddDownloadRequest,
  AppSettings,
  DownloadTaskInfo,
  MediaToolsStatus,
  ProbeResult,
  YouTubeProbeResult,
} from "../types/download";

export async function probeUrl(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_url", { url });
}

export async function probeYouTube(url: string): Promise<YouTubeProbeResult> {
  return invoke<YouTubeProbeResult>("probe_youtube", { url });
}

export async function getMediaToolsStatus(): Promise<MediaToolsStatus> {
  return invoke<MediaToolsStatus>("get_media_tools_status");
}

export async function installYtDlp(): Promise<MediaToolsStatus> {
  return invoke<MediaToolsStatus>("install_ytdlp");
}

export async function installFfmpeg(): Promise<MediaToolsStatus> {
  return invoke<MediaToolsStatus>("install_ffmpeg");
}

export async function addDownload(request: AddDownloadRequest): Promise<DownloadTaskInfo> {
  return invoke<DownloadTaskInfo>("add_download", { request });
}

export async function listDownloads(): Promise<DownloadTaskInfo[]> {
  return invoke<DownloadTaskInfo[]>("list_downloads");
}

export async function pauseDownload(id: string): Promise<DownloadTaskInfo> {
  return invoke<DownloadTaskInfo>("pause_download", { id });
}

export async function resumeDownload(id: string): Promise<DownloadTaskInfo> {
  return invoke<DownloadTaskInfo>("resume_download", { id });
}

export async function cancelDownload(id: string): Promise<DownloadTaskInfo> {
  return invoke<DownloadTaskInfo>("cancel_download", { id });
}

export async function removeDownload(id: string, deleteFile: boolean): Promise<void> {
  return invoke<void>("remove_download", { id, deleteFile });
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("update_settings", { settings });
}

export async function openPath(path: string, revealFolder: boolean): Promise<void> {
  return invoke<void>("open_path", { path, revealFolder });
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}

export async function onDownloadProgress(
  handler: (task: DownloadTaskInfo) => void
): Promise<UnlistenFn> {
  return listen<DownloadTaskInfo>("download:progress", (event) => {
    handler(event.payload);
  });
}

export async function onBrowserDownload(
  handler: (task: DownloadTaskInfo) => void
): Promise<UnlistenFn> {
  return listen<DownloadTaskInfo>("download:from-browser", (event) => {
    handler(event.payload);
  });
}

export async function onYouTubeOpen(
  handler: (url: string) => void
): Promise<UnlistenFn> {
  return listen<string>("youtube:open-url", (event) => {
    handler(event.payload);
  });
}
