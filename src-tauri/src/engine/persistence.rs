use std::fs;
use std::path::{Path, PathBuf};

use crate::engine::models::{AppSettings, DownloadError, DownloadStatus, DownloadTaskInfo};

#[derive(Debug, Clone)]
pub struct StateStore {
    downloads_path: PathBuf,
    settings_path: PathBuf,
}

impl StateStore {
    pub fn new(data_dir: &Path) -> Result<Self, DownloadError> {
        fs::create_dir_all(data_dir)?;
        Ok(Self {
            downloads_path: data_dir.join("downloads.json"),
            settings_path: data_dir.join("settings.json"),
        })
    }

    pub fn load_downloads(&self) -> Vec<DownloadTaskInfo> {
        let Ok(raw) = fs::read_to_string(&self.downloads_path) else {
            return Vec::new();
        };
        let mut tasks: Vec<DownloadTaskInfo> = serde_json::from_str(&raw).unwrap_or_default();
        // Any task that was actively downloading before an unexpected exit should appear as Paused
        for t in &mut tasks {
            if matches!(
                t.status,
                DownloadStatus::Downloading
                    | DownloadStatus::Probing
                    | DownloadStatus::Queued
                    | DownloadStatus::Muxing
            ) {
                t.status = DownloadStatus::Paused;
                t.speed_bps = 0;
                t.eta_seconds = None;
            }
        }
        tasks
    }

    pub fn save_downloads(&self, tasks: &[DownloadTaskInfo]) -> Result<(), DownloadError> {
        atomic_write_json(&self.downloads_path, tasks)
    }

    pub fn load_settings(&self) -> AppSettings {
        let Ok(raw) = fs::read_to_string(&self.settings_path) else {
            return AppSettings::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), DownloadError> {
        atomic_write_json(&self.settings_path, settings)
    }
}

fn atomic_write_json<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
) -> Result<(), DownloadError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(value)?;
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
