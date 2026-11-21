export type DownloadStatus =
  | "queued"
  | "probing"
  | "downloading"
  | "muxing"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export type SegmentStatus =
  | "pending"
  | "connecting"
  | "downloading"
  | "completed"
  | "paused"
  | "error";

export interface ProbeResult {
  url: string;
  finalUrl: string;
  fileName: string;
  totalSize: number | null;
  supportsRange: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
}

export interface SegmentSnapshot {
  id: number;
  start: number;
  end: number;
  downloaded: number;
  speedBps: number;
  status: SegmentStatus;
  retries: number;
}

export interface DownloadTaskInfo {
  id: string;
  url: string;
  finalUrl: string;
  fileName: string;
  saveDir: string;
  fullPath: string;
  totalSize: number | null;
  downloaded: number;
  speedBps: number;
  etaSeconds: number | null;
  supportsRange: boolean;
  maxConnections: number;
  status: DownloadStatus;
  errorMessage: string | null;
  etag: string | null;
  lastModified: string | null;
  companionAudioUrl?: string | null;
  mediaThumbnail?: string | null;
  mediaQualityLabel?: string | null;
  segments: SegmentSnapshot[];
  dynamicSplits: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AppSettings {
  defaultSaveDir: string;
  maxConnectionsPerDownload: number;
  minSplitSizeBytes: number;
  maxConcurrentDownloads: number;
  bridgeEnabled: boolean;
  bridgePort: number;
  minimizeToTray: boolean;
}

export interface AddDownloadRequest {
  url: string;
  saveDir?: string;
  fileName?: string;
  maxConnections?: number;
  headers?: Record<string, string>;
  companionAudioUrl?: string;
  mediaThumbnail?: string;
  mediaQualityLabel?: string;
}

export interface YouTubeFormatOption {
  id: string;
  label: string;
  ext: string;
  height: number | null;
  fps: number | null;
  isAudioOnly: boolean;
  needsMux: boolean;
  approxSizeBytes: number | null;
  videoUrl: string;
  audioUrl: string | null;
  httpHeaders: Record<string, string>;
}

export interface YouTubeProbeResult {
  url: string;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  ffmpegAvailable: boolean;
  formats: YouTubeFormatOption[];
}

export interface MediaToolsStatus {
  ytdlpInstalled: boolean;
  ytdlpPath: string | null;
  ffmpegInstalled: boolean;
  ffmpegPath: string | null;
}
