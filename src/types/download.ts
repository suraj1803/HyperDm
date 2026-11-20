export type DownloadStatus =
  | "queued"
  | "probing"
  | "downloading"
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
}
