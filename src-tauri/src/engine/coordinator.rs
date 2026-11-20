use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::Client;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::engine::models::{DownloadError, DownloadStatus, DownloadTaskInfo, SegmentStatus};
use crate::engine::segment::{build_initial_segments, try_split_largest_segment, LiveSegment};
use crate::engine::worker::{run_range_worker, run_single_stream_worker, WorkerOutcome};

pub type ProgressCallback = Arc<dyn Fn(DownloadTaskInfo) + Send + Sync>;

pub fn part_file_path(full_path: &Path) -> PathBuf {
    let mut os = full_path.as_os_str().to_os_string();
    os.push(".hyperdm.part");
    PathBuf::from(os)
}

/// Runs a single download from its current `DownloadTaskInfo` state (new or resumed)
/// until completion, pause, cancellation, or error.
pub async fn run_download_coordinator(
    client: Client,
    mut task: DownloadTaskInfo,
    min_split_size: u64,
    cancel: CancellationToken,
    on_progress: ProgressCallback,
) -> DownloadTaskInfo {
    let final_path = PathBuf::from(&task.full_path);
    if let Some(parent) = final_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            task.status = DownloadStatus::Error;
            task.error_message = Some(format!("Failed to create directory: {}", e));
            on_progress(task.clone());
            return task;
        }
    }

    let part_path = part_file_path(&final_path);
    task.status = DownloadStatus::Downloading;
    task.error_message = None;

    // Decide between dynamic multi-segment mode and single-stream fallback
    let use_range = task.supports_range && task.total_size.unwrap_or(0) > 0;

    if !use_range {
        return run_single_stream_download(client, task, part_path, final_path, cancel, on_progress)
            .await;
    }

    let total_size = task.total_size.unwrap();

    // Open or create & pre-allocate the .part file
    let file = match prepare_part_file(&part_path, total_size) {
        Ok(f) => Arc::new(f),
        Err(e) => {
            task.status = DownloadStatus::Error;
            task.error_message = Some(e.to_string());
            on_progress(task.clone());
            return task;
        }
    };

    // Initialize or restore segments
    let mut segments: Vec<Arc<LiveSegment>> = if !task.segments.is_empty() {
        task.segments
            .iter()
            .map(|s| Arc::new(LiveSegment::from_snapshot(s)))
            .collect()
    } else {
        build_initial_segments(total_size, task.max_connections, min_split_size)
    };

    let mut next_seg_id: u32 = segments.iter().map(|s| s.id).max().unwrap_or(0) + 1;

    // Channel for worker outcomes
    let (tx, mut rx) = mpsc::channel::<WorkerOutcome>(64);
    let mut active_workers: usize = 0;

    // Spawn workers for all incomplete segments (up to max_connections)
    for seg in &segments {
        if seg.status() != SegmentStatus::Completed && !seg.is_complete() {
            spawn_range_worker(
                &client,
                &task.final_url,
                &task.etag,
                &task.request_headers,
                &file,
                seg,
                &cancel,
                &tx,
            );
            active_workers += 1;
        }
    }

    // If all segments were already complete (e.g., resumed right before rename)
    if active_workers == 0 {
        return finalize_download(task, &segments, &part_path, &final_path, on_progress);
    }

    let mut tick = tokio::time::interval(Duration::from_millis(150));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Rolling 1.5-second window for smooth aggregate speed & ETA
    let mut speed_samples: VecDeque<(Instant, u64)> = VecDeque::new();
    let initial_downloaded: u64 = segments.iter().map(|s| s.downloaded_bytes()).sum();
    speed_samples.push_back((Instant::now(), initial_downloaded));

    let mut had_error: Option<String> = None;

    while active_workers > 0 {
        tokio::select! {
            _ = tick.tick() => {
                update_task_telemetry(&mut task, &segments, &mut speed_samples);
                on_progress(task.clone());
            }
            Some(outcome) = rx.recv() => {
                active_workers -= 1;

                match outcome {
                    WorkerOutcome::Completed { .. } => {
                        // IDM Dynamic File Segmentation:
                        // Immediately steal half of the largest remaining active segment!
                        if !cancel.is_cancelled() && had_error.is_none() {
                            if let Some(new_seg) = try_split_largest_segment(
                                &segments,
                                next_seg_id,
                                min_split_size,
                            ) {
                                next_seg_id += 1;
                                task.dynamic_splits += 1;
                                spawn_range_worker(
                                    &client,
                                    &task.final_url,
                                    &task.etag,
                                    &task.request_headers,
                                    &file,
                                    &new_seg,
                                    &cancel,
                                    &tx,
                                );
                                segments.push(new_seg);
                                active_workers += 1;
                            }
                        }
                    }
                    WorkerOutcome::Paused { .. } => {
                        // Worker stopped cleanly due to cancellation token
                    }
                    WorkerOutcome::Failed { error, .. } => {
                        if had_error.is_none() {
                            had_error = Some(error);
                            cancel.cancel();
                        }
                    }
                }
            }
        }
    }

    // Drop file handle before rename/sync
    let _ = file.sync_all();
    drop(file);

    update_task_telemetry(&mut task, &segments, &mut speed_samples);
    task.speed_bps = 0;
    task.eta_seconds = None;

    if let Some(err) = had_error {
        task.status = DownloadStatus::Error;
        task.error_message = Some(err);
        on_progress(task.clone());
        return task;
    }

    if cancel.is_cancelled() {
        // Distinguish Pause vs Cancel in the manager; coordinator marks Paused
        let all_done = segments.iter().all(|s| s.is_complete());
        if all_done {
            return finalize_download(task, &segments, &part_path, &final_path, on_progress);
        }
        task.status = DownloadStatus::Paused;
        on_progress(task.clone());
        return task;
    }

    let all_done = segments.iter().all(|s| s.is_complete());
    if all_done {
        finalize_download(task, &segments, &part_path, &final_path, on_progress)
    } else {
        task.status = DownloadStatus::Error;
        task.error_message = Some("Download ended with incomplete segments".to_string());
        on_progress(task.clone());
        task
    }
}

fn spawn_range_worker(
    client: &Client,
    url: &str,
    etag: &Option<String>,
    request_headers: &HashMap<String, String>,
    file: &Arc<std::fs::File>,
    seg: &Arc<LiveSegment>,
    cancel: &CancellationToken,
    tx: &mpsc::Sender<WorkerOutcome>,
) {
    let client = client.clone();
    let url = url.to_string();
    let etag = etag.clone();
    let request_headers = request_headers.clone();
    let file = Arc::clone(file);
    let seg = Arc::clone(seg);
    let cancel = cancel.clone();
    let tx = tx.clone();

    tokio::spawn(async move {
        let outcome = run_range_worker(client, url, etag, request_headers, file, seg, cancel).await;
        let _ = tx.send(outcome).await;
    });
}

async fn run_single_stream_download(
    client: Client,
    mut task: DownloadTaskInfo,
    part_path: PathBuf,
    final_path: PathBuf,
    cancel: CancellationToken,
    on_progress: ProgressCallback,
) -> DownloadTaskInfo {
    let end = task.total_size.map(|s| s.saturating_sub(1)).unwrap_or(0);
    let seg = Arc::new(LiveSegment::new(1, 0, end));
    let segments = vec![Arc::clone(&seg)];

    let (tx, mut rx) = mpsc::channel::<WorkerOutcome>(1);
    let worker_client = client.clone();
    let worker_url = task.final_url.clone();
    let worker_headers = task.request_headers.clone();
    let worker_part = part_path.clone();
    let worker_seg = Arc::clone(&seg);
    let worker_cancel = cancel.clone();

    tokio::spawn(async move {
        let outcome = run_single_stream_worker(
            worker_client,
            worker_url,
            worker_headers,
            worker_part,
            worker_seg,
            worker_cancel,
        )
        .await;
        let _ = tx.send(outcome).await;
    });

    let mut tick = tokio::time::interval(Duration::from_millis(150));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut speed_samples: VecDeque<(Instant, u64)> = VecDeque::new();
    speed_samples.push_back((Instant::now(), 0));

    let outcome = loop {
        tokio::select! {
            _ = tick.tick() => {
                update_task_telemetry(&mut task, &segments, &mut speed_samples);
                on_progress(task.clone());
            }
            Some(out) = rx.recv() => break out,
        }
    };

    update_task_telemetry(&mut task, &segments, &mut speed_samples);
    task.speed_bps = 0;
    task.eta_seconds = None;

    match outcome {
        WorkerOutcome::Completed { .. } => {
            if task.total_size.is_none() {
                task.total_size = Some(task.downloaded);
            }
            finalize_download(task, &segments, &part_path, &final_path, on_progress)
        }
        WorkerOutcome::Paused { .. } => {
            task.status = DownloadStatus::Paused;
            on_progress(task.clone());
            task
        }
        WorkerOutcome::Failed { error, .. } => {
            task.status = DownloadStatus::Error;
            task.error_message = Some(error);
            on_progress(task.clone());
            task
        }
    }
}

fn prepare_part_file(part_path: &Path, total_size: u64) -> Result<std::fs::File, DownloadError> {
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(part_path)?;
    if file.metadata()?.len() != total_size {
        file.set_len(total_size)?;
    }
    Ok(file)
}

fn finalize_download(
    mut task: DownloadTaskInfo,
    segments: &[Arc<LiveSegment>],
    part_path: &Path,
    final_path: &Path,
    on_progress: ProgressCallback,
) -> DownloadTaskInfo {
    if part_path.exists() {
        if let Err(e) = fs::rename(part_path, final_path) {
            task.status = DownloadStatus::Error;
            task.error_message = Some(format!("Failed to finalize file: {}", e));
            on_progress(task.clone());
            return task;
        }
    }

    task.segments = segments.iter().map(|s| s.snapshot()).collect();
    task.downloaded = segments.iter().map(|s| s.downloaded_bytes()).sum();
    if task.total_size.is_none() {
        task.total_size = Some(task.downloaded);
    }
    task.speed_bps = 0;
    task.eta_seconds = Some(0);
    task.status = DownloadStatus::Completed;
    task.completed_at = Some(Utc::now());
    on_progress(task.clone());
    task
}

fn update_task_telemetry(
    task: &mut DownloadTaskInfo,
    segments: &[Arc<LiveSegment>],
    samples: &mut VecDeque<(Instant, u64)>,
) {
    let now = Instant::now();
    let downloaded: u64 = segments.iter().map(|s| s.downloaded_bytes()).sum();
    task.downloaded = downloaded;
    task.segments = segments.iter().map(|s| s.snapshot()).collect();

    samples.push_back((now, downloaded));
    while let Some(&(t, _)) = samples.front() {
        if now.duration_since(t) > Duration::from_millis(1500) && samples.len() > 2 {
            samples.pop_front();
        } else {
            break;
        }
    }

    if let (Some(&(t0, b0)), Some(&(t1, b1))) = (samples.front(), samples.back()) {
        let dt = t1.duration_since(t0).as_secs_f64();
        if dt > 0.05 && b1 >= b0 {
            let speed = ((b1 - b0) as f64 / dt) as u64;
            task.speed_bps = speed;
            if let Some(total) = task.total_size {
                if speed > 0 && total > downloaded {
                    task.eta_seconds = Some((total - downloaded) / speed);
                } else if total <= downloaded {
                    task.eta_seconds = Some(0);
                } else {
                    task.eta_seconds = None;
                }
            }
        }
    }
}
