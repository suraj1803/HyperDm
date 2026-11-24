use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::Client;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::engine::coordinator::{
    audio_part_file_path, part_file_path, run_download_coordinator, ProgressCallback,
};
use crate::engine::models::{
    AddDownloadRequest, AppSettings, DownloadError, DownloadStatus, DownloadTaskInfo,
    MediaToolsStatus, ProbeResult, YouTubeProbeResult,
};
use crate::engine::persistence::StateStore;
use crate::engine::prober::{build_http_client, probe_url, sanitize_filename};
use crate::engine::youtube::{
    install_or_update_ffmpeg, install_or_update_ytdlp, media_tools_status, probe_youtube,
};

struct ActiveRun {
    run_id: Uuid,
    token: CancellationToken,
    done_rx: tokio::sync::watch::Receiver<bool>,
}

struct InnerState {
    tasks: HashMap<Uuid, DownloadTaskInfo>,
    active_runs: HashMap<Uuid, ActiveRun>,
    cancelled_ids: HashMap<Uuid, bool>,
    settings: AppSettings,
    last_persist: Instant,
}

#[derive(Clone)]
pub struct DownloadManager {
    client: Client,
    data_dir: PathBuf,
    store: StateStore,
    state: Arc<RwLock<InnerState>>,
    emitter: ProgressCallback,
}

impl DownloadManager {
    pub fn new(data_dir: &Path, emitter: ProgressCallback) -> Result<Self, DownloadError> {
        let client = build_http_client()?;
        let store = StateStore::new(data_dir)?;
        let saved_tasks = store.load_downloads();
        let settings = store.load_settings();

        let mut tasks = HashMap::new();
        for t in saved_tasks {
            tasks.insert(t.id, t);
        }

        Ok(Self {
            client,
            data_dir: data_dir.to_path_buf(),
            store,
            state: Arc::new(RwLock::new(InnerState {
                tasks,
                active_runs: HashMap::new(),
                cancelled_ids: HashMap::new(),
                settings,
                last_persist: Instant::now(),
            })),
            emitter,
        })
    }

    pub async fn probe(&self, url: &str) -> Result<ProbeResult, DownloadError> {
        probe_url(&self.client, url, &HashMap::new()).await
    }

    pub async fn probe_youtube(&self, url: &str) -> Result<YouTubeProbeResult, DownloadError> {
        probe_youtube(&self.client, &self.data_dir, url).await
    }

    pub fn media_tools_status(&self) -> MediaToolsStatus {
        media_tools_status(&self.data_dir)
    }

    pub async fn install_ytdlp(&self) -> Result<MediaToolsStatus, DownloadError> {
        install_or_update_ytdlp(&self.client, &self.data_dir).await?;
        Ok(media_tools_status(&self.data_dir))
    }

    pub async fn install_ffmpeg(&self) -> Result<MediaToolsStatus, DownloadError> {
        install_or_update_ffmpeg(&self.client, &self.data_dir).await?;
        Ok(media_tools_status(&self.data_dir))
    }

    pub fn list_downloads(&self) -> Vec<DownloadTaskInfo> {
        let guard = self.state.read().unwrap();
        let mut list: Vec<DownloadTaskInfo> = guard.tasks.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub fn get_download(&self, id: Uuid) -> Option<DownloadTaskInfo> {
        self.state.read().unwrap().tasks.get(&id).cloned()
    }

    pub fn get_settings(&self) -> AppSettings {
        self.state.read().unwrap().settings.clone()
    }

    pub fn update_settings(&self, mut settings: AppSettings) -> Result<AppSettings, DownloadError> {
        settings.max_connections_per_download = settings.max_connections_per_download.clamp(1, 16);
        settings.min_split_size_bytes = settings.min_split_size_bytes.max(64 * 1024);
        settings.max_concurrent_downloads = settings.max_concurrent_downloads.clamp(1, 10);

        self.store.save_settings(&settings)?;
        self.state.write().unwrap().settings = settings.clone();
        if tokio::runtime::Handle::try_current().is_ok() {
            self.schedule_next_queued();
        }
        Ok(settings)
    }

    pub async fn add_download(
        &self,
        req: AddDownloadRequest,
    ) -> Result<DownloadTaskInfo, DownloadError> {
        let probe = probe_url(&self.client, &req.url, &req.headers).await?;
        let settings = self.get_settings();

        let save_dir = req
            .save_dir
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| settings.default_save_dir.clone());

        let raw_name = req
            .file_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| probe.file_name.clone());
        let file_name = unique_filename(Path::new(&save_dir), &sanitize_filename(&raw_name));
        let full_path = Path::new(&save_dir)
            .join(&file_name)
            .to_string_lossy()
            .to_string();

        let max_connections = req
            .max_connections
            .unwrap_or(settings.max_connections_per_download)
            .clamp(1, 16);

        let task = DownloadTaskInfo {
            id: Uuid::new_v4(),
            url: probe.url,
            final_url: probe.final_url,
            file_name,
            save_dir,
            full_path,
            total_size: probe.total_size,
            downloaded: 0,
            speed_bps: 0,
            eta_seconds: None,
            supports_range: probe.supports_range,
            max_connections,
            status: DownloadStatus::Queued,
            error_message: None,
            etag: probe.etag,
            last_modified: probe.last_modified,
            request_headers: req.headers,
            companion_audio_url: req.companion_audio_url,
            source_page_url: req.source_page_url,
            media_format_id: req.media_format_id,
            media_thumbnail: req.media_thumbnail,
            media_quality_label: req.media_quality_label,
            segments: Vec::new(),
            dynamic_splits: 0,
            created_at: Utc::now(),
            completed_at: None,
        };

        {
            let mut guard = self.state.write().unwrap();
            guard.tasks.insert(task.id, task.clone());
        }
        self.persist_now();
        (self.emitter)(task.clone());

        self.spawn_task(task.id)?;
        Ok(self.get_download(task.id).unwrap_or(task))
    }

    pub fn pause_download(&self, id: Uuid) -> Result<DownloadTaskInfo, DownloadError> {
        let token = {
            let mut guard = self.state.write().unwrap();
            let task = guard
                .tasks
                .get(&id)
                .ok_or(DownloadError::NotFound(id))?;
            if task.status != DownloadStatus::Downloading && task.status != DownloadStatus::Queued {
                return Ok(task.clone());
            }
            guard.cancelled_ids.remove(&id);
            guard.active_runs.get(&id).map(|r| r.token.clone())
        };

        if let Some(t) = token {
            t.cancel();
        }

        let updated = {
            let mut guard = self.state.write().unwrap();
            let task = guard
                .tasks
                .get_mut(&id)
                .ok_or(DownloadError::NotFound(id))?;
            task.status = DownloadStatus::Paused;
            task.speed_bps = 0;
            task.eta_seconds = None;
            task.clone()
        };

        self.persist_now();
        (self.emitter)(updated.clone());
        self.schedule_next_queued();
        Ok(updated)
    }

    pub async fn resume_download(&self, id: Uuid) -> Result<DownloadTaskInfo, DownloadError> {
        let wait_rx = {
            let guard = self.state.read().unwrap();
            let task = guard
                .tasks
                .get(&id)
                .ok_or(DownloadError::NotFound(id))?;
            if task.status == DownloadStatus::Completed {
                return Ok(task.clone());
            }
            if let Some(run) = guard.active_runs.get(&id) {
                if !run.token.is_cancelled() {
                    // Already actively downloading
                    return Ok(task.clone());
                }
                // Previous run was just paused and is still flushing; wait for it to finish cleanly
                Some(run.done_rx.clone())
            } else {
                None
            }
        };

        if let Some(mut rx) = wait_rx {
            let _ = rx.wait_for(|&done| done).await;
        }

        // Re-check status & refresh expired YouTube signed URLs if needed
        if let Some(task) = self.get_download(id) {
            if task.status == DownloadStatus::Completed {
                return Ok(task);
            }
            let age_hours = Utc::now()
                .signed_duration_since(task.created_at)
                .num_hours();
            let looks_expired = task
                .error_message
                .as_deref()
                .map(|m| m.contains("403") || m.contains("410") || m.contains("throttled"))
                .unwrap_or(false)
                || age_hours >= 5;

            if looks_expired && task.source_page_url.is_some() {
                let _ = self.refresh_youtube_urls(id).await;
            }
        }

        self.spawn_task(id)?;
        self.get_download(id).ok_or(DownloadError::NotFound(id))
    }

    async fn refresh_youtube_urls(&self, id: Uuid) -> bool {
        let Some(task) = self.get_download(id) else {
            return false;
        };
        let Some(ref page_url) = task.source_page_url else {
            return false;
        };
        let Ok(yt) = self.probe_youtube(page_url).await else {
            return false;
        };

        let matched = task
            .media_format_id
            .as_deref()
            .and_then(|fid| yt.formats.iter().find(|f| f.id == fid))
            .or_else(|| {
                task.media_quality_label
                    .as_deref()
                    .and_then(|lbl| yt.formats.iter().find(|f| f.label == lbl))
            })
            .or_else(|| yt.formats.first());

        let Some(fmt) = matched else {
            return false;
        };

        {
            let mut guard = self.state.write().unwrap();
            if let Some(t) = guard.tasks.get_mut(&id) {
                t.url = fmt.video_url.clone();
                t.final_url = fmt.video_url.clone();
                t.companion_audio_url = fmt.audio_url.clone();
                t.request_headers = fmt.http_headers.clone();
                t.error_message = None;
                t.created_at = Utc::now();
            } else {
                return false;
            }
        }
        self.persist_now();
        true
    }

    pub fn pause_all(&self) {
        let active_ids: Vec<Uuid> = {
            let guard = self.state.read().unwrap();
            guard
                .tasks
                .values()
                .filter(|t| {
                    t.status == DownloadStatus::Downloading || t.status == DownloadStatus::Queued
                })
                .map(|t| t.id)
                .collect()
        };
        for id in active_ids {
            let _ = self.pause_download(id);
        }
    }

    pub async fn resume_all(&self) {
        let paused_ids: Vec<Uuid> = {
            let guard = self.state.read().unwrap();
            guard
                .tasks
                .values()
                .filter(|t| t.status == DownloadStatus::Paused)
                .map(|t| t.id)
                .collect()
        };
        for id in paused_ids {
            let _ = self.resume_download(id).await;
        }
    }

    pub fn cancel_download(&self, id: Uuid) -> Result<DownloadTaskInfo, DownloadError> {
        let (token, full_path) = {
            let mut guard = self.state.write().unwrap();
            let full_path = {
                let task = guard
                    .tasks
                    .get_mut(&id)
                    .ok_or(DownloadError::NotFound(id))?;
                task.status = DownloadStatus::Cancelled;
                task.speed_bps = 0;
                task.eta_seconds = None;
                task.full_path.clone()
            };
            guard.cancelled_ids.insert(id, true);
            (guard.active_runs.get(&id).map(|r| r.token.clone()), full_path)
        };

        if let Some(t) = token {
            t.cancel();
        }

        let full = Path::new(&full_path);
        let _ = fs::remove_file(part_file_path(full));
        let _ = fs::remove_file(audio_part_file_path(full));

        self.persist_now();
        let updated = self.get_download(id).ok_or(DownloadError::NotFound(id))?;
        (self.emitter)(updated.clone());
        self.schedule_next_queued();
        Ok(updated)
    }

    pub fn remove_download(&self, id: Uuid, delete_file: bool) -> Result<(), DownloadError> {
        let (token, task) = {
            let mut guard = self.state.write().unwrap();
            let token = guard.active_runs.remove(&id).map(|r| r.token);
            guard.cancelled_ids.insert(id, true);
            let task = guard.tasks.remove(&id);
            (token, task)
        };

        if let Some(t) = token {
            t.cancel();
        }

        if let Some(task) = task {
            let full = Path::new(&task.full_path);
            let _ = fs::remove_file(part_file_path(full));
            let _ = fs::remove_file(audio_part_file_path(full));
            if delete_file {
                let _ = fs::remove_file(full);
            }
        }

        self.persist_now();
        self.schedule_next_queued();
        Ok(())
    }

    fn schedule_next_queued(&self) {
        let next_ids: Vec<Uuid> = {
            let guard = self.state.read().unwrap();
            let active_count = guard
                .active_runs
                .values()
                .filter(|r| !r.token.is_cancelled())
                .count();
            let max_concurrent = guard.settings.max_concurrent_downloads.max(1) as usize;
            if active_count >= max_concurrent {
                return;
            }
            let slots = max_concurrent - active_count;
            let mut queued: Vec<&DownloadTaskInfo> = guard
                .tasks
                .values()
                .filter(|t| {
                    t.status == DownloadStatus::Queued && !guard.active_runs.contains_key(&t.id)
                })
                .collect();
            queued.sort_by(|a, b| a.created_at.cmp(&b.created_at));
            queued.into_iter().take(slots).map(|t| t.id).collect()
        };

        for qid in next_ids {
            let _ = self.spawn_task(qid);
        }
    }

    fn spawn_task(&self, id: Uuid) -> Result<(), DownloadError> {
        let (task, min_split_size, token, run_id, done_tx) = {
            let mut guard = self.state.write().unwrap();
            if guard.active_runs.contains_key(&id) {
                return Ok(());
            }
            let active_count = guard
                .active_runs
                .values()
                .filter(|r| !r.token.is_cancelled())
                .count();
            let max_concurrent = guard.settings.max_concurrent_downloads.max(1) as usize;
            if active_count >= max_concurrent {
                if let Some(task) = guard.tasks.get_mut(&id) {
                    task.status = DownloadStatus::Queued;
                    task.error_message = None;
                    let queued_clone = task.clone();
                    drop(guard);
                    self.persist_now();
                    (self.emitter)(queued_clone);
                }
                return Ok(());
            }
            let min_split = guard.settings.min_split_size_bytes;
            let task = guard
                .tasks
                .get_mut(&id)
                .ok_or(DownloadError::NotFound(id))?;
            task.status = DownloadStatus::Downloading;
            task.error_message = None;
            let cloned = task.clone();
            let token = CancellationToken::new();
            let run_id = Uuid::new_v4();
            let (done_tx, done_rx) = tokio::sync::watch::channel(false);
            guard.cancelled_ids.remove(&id);
            guard.active_runs.insert(
                id,
                ActiveRun {
                    run_id,
                    token: token.clone(),
                    done_rx,
                },
            );
            (cloned, min_split, token, run_id, done_tx)
        };

        let manager = self.clone();
        let client = self.client.clone();

        tokio::spawn(async move {
            let progress_mgr = manager.clone();
            let on_progress: ProgressCallback = Arc::new(move |updated: DownloadTaskInfo| {
                let should_persist = {
                    let mut guard = progress_mgr.state.write().unwrap();
                    if !guard.tasks.contains_key(&updated.id) {
                        return;
                    }
                    guard.tasks.insert(updated.id, updated.clone());
                    let due = guard.last_persist.elapsed() >= Duration::from_secs(2);
                    if due {
                        guard.last_persist = Instant::now();
                    }
                    due
                };
                if should_persist {
                    progress_mgr.persist_now();
                }
                (progress_mgr.emitter)(updated);
            });

            let mut current_task = task;
            let mut current_token = token;
            let mut auto_refreshed = false;

            let mut final_task = loop {
                let result = run_download_coordinator(
                    client.clone(),
                    manager.data_dir.clone(),
                    current_task,
                    min_split_size,
                    current_token,
                    Arc::clone(&on_progress),
                )
                .await;

                let should_refresh = !auto_refreshed
                    && result.status == DownloadStatus::Error
                    && result.source_page_url.is_some()
                    && result
                        .error_message
                        .as_deref()
                        .map(|m| m.contains("403") || m.contains("410") || m.contains("throttled"))
                        .unwrap_or(false);

                if !should_refresh {
                    break result;
                }

                let user_stopped = {
                    let guard = manager.state.read().unwrap();
                    guard.cancelled_ids.contains_key(&result.id)
                        || !guard.tasks.contains_key(&result.id)
                };
                if user_stopped {
                    break result;
                }

                auto_refreshed = true;
                // Save latest segment progress before refreshing signed URLs
                {
                    let mut guard = manager.state.write().unwrap();
                    if guard.tasks.contains_key(&result.id) {
                        guard.tasks.insert(result.id, result.clone());
                    }
                }

                if !manager.refresh_youtube_urls(result.id).await {
                    break result;
                }

                let next_token = CancellationToken::new();
                let next_task = {
                    let mut guard = manager.state.write().unwrap();
                    if guard.cancelled_ids.contains_key(&result.id) {
                        break result;
                    }
                    if let Some(run) = guard.active_runs.get_mut(&result.id) {
                        if run.run_id == run_id {
                            run.token = next_token.clone();
                        }
                    }
                    guard.tasks.get(&result.id).cloned()
                };

                match next_task {
                    Some(t) => {
                        current_task = t;
                        current_token = next_token;
                    }
                    None => break result,
                }
            };

            {
                let mut guard = manager.state.write().unwrap();
                if guard
                    .active_runs
                    .get(&final_task.id)
                    .map(|r| r.run_id == run_id)
                    .unwrap_or(false)
                {
                    guard.active_runs.remove(&final_task.id);
                }
                if guard.cancelled_ids.remove(&final_task.id).is_some() {
                    final_task.status = DownloadStatus::Cancelled;
                    let part = part_file_path(Path::new(&final_task.full_path));
                    let _ = fs::remove_file(part);
                }
                if guard.tasks.contains_key(&final_task.id) {
                    guard.tasks.insert(final_task.id, final_task.clone());
                }
            }

            manager.persist_now();
            (manager.emitter)(final_task);
            let _ = done_tx.send(true);
            manager.schedule_next_queued();
        });

        Ok(())
    }

    fn persist_now(&self) {
        let tasks: Vec<DownloadTaskInfo> = {
            let guard = self.state.read().unwrap();
            guard.tasks.values().cloned().collect()
        };
        let _ = self.store.save_downloads(&tasks);
    }
}

fn unique_filename(dir: &Path, desired: &str) -> String {
    let candidate = dir.join(desired);
    if !candidate.exists() && !part_file_path(&candidate).exists() {
        return desired.to_string();
    }

    let path = Path::new(desired);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = path.extension().and_then(|s| s.to_str());

    for i in 1..10_000 {
        let next = match ext {
            Some(e) => format!("{} ({}).{}", stem, i, e),
            None => format!("{} ({})", stem, i),
        };
        let p = dir.join(&next);
        if !p.exists() && !part_file_path(&p).exists() {
            return next;
        }
    }
    PathBuf::from(desired).to_string_lossy().to_string()
}
