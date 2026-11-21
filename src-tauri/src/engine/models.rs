use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Server returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Download not found: {0}")]
    NotFound(Uuid),
    #[error("Invalid state transition: {0}")]
    InvalidState(String),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Download cancelled")]
    Cancelled,
    #[error("YouTube / media tool error: {0}")]
    MediaTool(String),
}

impl Serialize for DownloadError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Probing,
    Downloading,
    Muxing,
    Paused,
    Completed,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentStatus {
    Pending,
    Connecting,
    Downloading,
    Completed,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub url: String,
    pub final_url: String,
    pub file_name: String,
    pub total_size: Option<u64>,
    pub supports_range: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentSnapshot {
    pub id: u32,
    pub start: u64,
    /// Inclusive end byte offset. For unknown-length streams, `end` is 0.
    pub end: u64,
    pub downloaded: u64,
    pub speed_bps: u64,
    pub status: SegmentStatus,
    pub retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTaskInfo {
    pub id: Uuid,
    pub url: String,
    pub final_url: String,
    pub file_name: String,
    pub save_dir: String,
    pub full_path: String,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub supports_range: bool,
    pub max_connections: u32,
    pub status: DownloadStatus,
    pub error_message: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default)]
    pub request_headers: HashMap<String, String>,
    #[serde(default)]
    pub companion_audio_url: Option<String>,
    #[serde(default)]
    pub media_thumbnail: Option<String>,
    #[serde(default)]
    pub media_quality_label: Option<String>,
    pub segments: Vec<SegmentSnapshot>,
    pub dynamic_splits: u32,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_save_dir: String,
    pub max_connections_per_download: u32,
    pub min_split_size_bytes: u64,
    pub max_concurrent_downloads: u32,
    #[serde(default = "default_bridge_enabled")]
    pub bridge_enabled: bool,
    #[serde(default = "default_bridge_port")]
    pub bridge_port: u16,
    #[serde(default = "default_minimize_to_tray")]
    pub minimize_to_tray: bool,
}

fn default_bridge_enabled() -> bool {
    true
}

fn default_bridge_port() -> u16 {
    41920
}

fn default_minimize_to_tray() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        let default_dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .to_string_lossy()
            .to_string();

        Self {
            default_save_dir: default_dir,
            max_connections_per_download: 8,
            min_split_size_bytes: 512 * 1024, // 512 KiB
            max_concurrent_downloads: 3,
            bridge_enabled: true,
            bridge_port: 41920,
            minimize_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDownloadRequest {
    pub url: String,
    pub save_dir: Option<String>,
    pub file_name: Option<String>,
    pub max_connections: Option<u32>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub companion_audio_url: Option<String>,
    #[serde(default)]
    pub media_thumbnail: Option<String>,
    #[serde(default)]
    pub media_quality_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeFormatOption {
    pub id: String,
    pub label: String,
    pub ext: String,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub is_audio_only: bool,
    pub needs_mux: bool,
    pub approx_size_bytes: Option<u64>,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub http_headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeProbeResult {
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_seconds: Option<u64>,
    pub thumbnail: Option<String>,
    pub ffmpeg_available: bool,
    pub formats: Vec<YouTubeFormatOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaToolsStatus {
    pub ytdlp_installed: bool,
    pub ytdlp_path: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_path: Option<String>,
}
