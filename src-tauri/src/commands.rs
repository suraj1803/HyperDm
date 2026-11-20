use std::path::Path;
use std::process::Command;

use tauri::State;
use uuid::Uuid;

use crate::engine::manager::DownloadManager;
use crate::engine::models::{
    AddDownloadRequest, AppSettings, DownloadError, DownloadTaskInfo, ProbeResult,
};

#[tauri::command]
pub async fn probe_url(
    manager: State<'_, DownloadManager>,
    url: String,
) -> Result<ProbeResult, DownloadError> {
    manager.probe(&url).await
}

#[tauri::command]
pub async fn add_download(
    manager: State<'_, DownloadManager>,
    request: AddDownloadRequest,
) -> Result<DownloadTaskInfo, DownloadError> {
    manager.add_download(request).await
}

#[tauri::command]
pub fn list_downloads(manager: State<'_, DownloadManager>) -> Vec<DownloadTaskInfo> {
    manager.list_downloads()
}

#[tauri::command]
pub fn pause_download(
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<DownloadTaskInfo, DownloadError> {
    let uuid = Uuid::parse_str(&id).map_err(|_| DownloadError::InvalidState("Invalid ID".into()))?;
    manager.pause_download(uuid)
}

#[tauri::command]
pub async fn resume_download(
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<DownloadTaskInfo, DownloadError> {
    let uuid = Uuid::parse_str(&id).map_err(|_| DownloadError::InvalidState("Invalid ID".into()))?;
    manager.resume_download(uuid).await
}

#[tauri::command]
pub fn cancel_download(
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<DownloadTaskInfo, DownloadError> {
    let uuid = Uuid::parse_str(&id).map_err(|_| DownloadError::InvalidState("Invalid ID".into()))?;
    manager.cancel_download(uuid)
}

#[tauri::command]
pub fn remove_download(
    manager: State<'_, DownloadManager>,
    id: String,
    delete_file: bool,
) -> Result<(), DownloadError> {
    let uuid = Uuid::parse_str(&id).map_err(|_| DownloadError::InvalidState("Invalid ID".into()))?;
    manager.remove_download(uuid, delete_file)
}

#[tauri::command]
pub fn get_settings(manager: State<'_, DownloadManager>) -> AppSettings {
    manager.get_settings()
}

#[tauri::command]
pub fn update_settings(
    manager: State<'_, DownloadManager>,
    settings: AppSettings,
) -> Result<AppSettings, DownloadError> {
    manager.update_settings(settings)
}

#[tauri::command]
pub fn open_path(path: String, reveal_folder: bool) -> Result<(), DownloadError> {
    let target = if reveal_folder {
        Path::new(&path)
            .parent()
            .unwrap_or_else(|| Path::new(&path))
            .to_path_buf()
    } else {
        Path::new(&path).to_path_buf()
    };

    #[cfg(target_os = "linux")]
    let cmd = ("xdg-open", target.as_os_str());
    #[cfg(target_os = "macos")]
    let cmd = ("open", target.as_os_str());
    #[cfg(target_os = "windows")]
    let cmd = ("explorer", target.as_os_str());

    Command::new(cmd.0).arg(cmd.1).spawn()?;
    Ok(())
}
