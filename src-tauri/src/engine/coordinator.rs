use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::engine::models::{DownloadError, DownloadStatus, DownloadTaskInfo, SegmentStatus};
use crate::engine::prober::{build_header_map, is_googlevideo_url, with_query_range};
use crate::engine::segment::{build_initial_segments, try_split_largest_segment, LiveSegment};
use crate::engine::worker::{run_range_worker, run_single_stream_worker, WorkerOutcome};
use crate::engine::youtube::mux_video_and_audio;

pub type ProgressCallback = Arc<dyn Fn(DownloadTaskInfo) + Send + Sync>;

pub fn part_file_path(full_path: &Path) -> PathBuf {
    let mut os = full_path.as_os_str().to_os_string();
    os.push(".hyperdm.part");
    PathBuf::from(os)
}

pub fn audio_part_file_path(full_path: &Path) -> PathBuf {
    let mut os = full_path.as_os_str().to_os_string();
    os.push(".hyperdm.audio.part");
    PathBuf::from(os)
}

/// Runs a single download from its current `DownloadTaskInfo` state (new or resumed)
/// until completion, pause, cancellation, or error.
pub async fn run_download_coordinator(
    client: Client,
    data_dir: PathBuf,
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

    // If this is an adaptive YouTube download, start downloading the companion audio track
    // in parallel with the video so merging is nearly instantaneous once video completes.
    let audio_handle: Option<tokio::task::JoinHandle<Result<(), DownloadError>>> =
        task.companion_audio_url.clone().map(|audio_url| {
            let audio_client = client.clone();
            let audio_headers = task.request_headers.clone();
            let audio_dest = audio_part_file_path(&final_path);
            let audio_cancel = cancel.clone();
            tokio::spawn(async move {
                download_companion_audio(
                    &audio_client,
                    &audio_url,
                    &audio_headers,
                    &audio_dest,
                    &audio_cancel,
                )
                .await
            })
        });

    // Decide between dynamic multi-segment mode and single-stream fallback
    let use_range = task.supports_range && task.total_size.unwrap_or(0) > 0;

    if !use_range {
        return run_single_stream_download(
            client,
            data_dir,
            task,
            part_path,
            final_path,
            audio_handle,
            cancel,
            on_progress,
        )
        .await;
    }

    let total_size = task.total_size.unwrap();
    let effective_min_split = if is_googlevideo_url(&task.final_url) {
        min_split_size.max(1024 * 1024)
    } else {
        min_split_size
    };

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
        build_initial_segments(total_size, task.max_connections, effective_min_split)
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

    // If all segments were already complete (e.g., resumed right before rename/mux)
    if active_workers == 0 {
        return finalize_download(
            &client,
            &data_dir,
            task,
            &segments,
            &part_path,
            &final_path,
            audio_handle,
            &cancel,
            on_progress,
        )
        .await;
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
                                effective_min_split,
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
            return finalize_download(
                &client,
                &data_dir,
                task,
                &segments,
                &part_path,
                &final_path,
                audio_handle,
                &cancel,
                on_progress,
            )
            .await;
        }
        if let Some(h) = audio_handle {
            let _ = h.await;
        }
        task.status = DownloadStatus::Paused;
        on_progress(task.clone());
        return task;
    }

    let all_done = segments.iter().all(|s| s.is_complete());
    if all_done {
        finalize_download(
            &client,
            &data_dir,
            task,
            &segments,
            &part_path,
            &final_path,
            audio_handle,
            &cancel,
            on_progress,
        )
        .await
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
    data_dir: PathBuf,
    mut task: DownloadTaskInfo,
    part_path: PathBuf,
    final_path: PathBuf,
    audio_handle: Option<tokio::task::JoinHandle<Result<(), DownloadError>>>,
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
            finalize_download(
                &client,
                &data_dir,
                task,
                &segments,
                &part_path,
                &final_path,
                audio_handle,
                &cancel,
                on_progress,
            )
            .await
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

async fn download_companion_audio(
    client: &Client,
    audio_url: &str,
    headers: &HashMap<String, String>,
    dest: &Path,
    cancel: &CancellationToken,
) -> Result<(), DownloadError> {
    const MAX_AUDIO_RETRIES: u32 = 5;
    const AUDIO_CHUNK: u64 = 4 * 1024 * 1024;

    let extra = build_header_map(headers);
    let mut file = File::create(dest)?;

    // Probe audio size & range support (with retries for transient googlevideo socket resets)
    let mut probed = None;
    for attempt in 0..3u32 {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        match crate::engine::prober::probe_url(client, audio_url, headers).await {
            Ok(p) => {
                probed = Some(p);
                break;
            }
            Err(_) if attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(300 * (attempt as u64 + 1))).await;
            }
            Err(_) => break,
        }
    }

    if let Some(p) = probed {
        if p.supports_range {
            if let Some(total) = p.total_size {
                let use_query_range = is_googlevideo_url(&p.final_url);
                let chunk_size: u64 = if use_query_range {
                    2 * 1024 * 1024
                } else {
                    AUDIO_CHUNK
                };
                let mut offset: u64 = 0;
                let mut attempt: u32 = 0;

                while offset < total {
                    if cancel.is_cancelled() {
                        return Err(DownloadError::Cancelled);
                    }
                    let end = (offset + chunk_size - 1).min(total - 1);
                    let mut req = if use_query_range {
                        let req_url = with_query_range(&p.final_url, offset, end);
                        client.get(&req_url).headers(extra.clone())
                    } else {
                        client
                            .get(&p.final_url)
                            .headers(extra.clone())
                            .header(reqwest::header::RANGE, format!("bytes={}-{}", offset, end))
                    };
                    if attempt > 0 {
                        // Force a fresh TCP/TLS socket on retry instead of reusing a stale pooled socket
                        req = req.header(reqwest::header::CONNECTION, "close");
                    }

                    let send_res = tokio::select! {
                        _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
                        r = tokio::time::timeout(Duration::from_secs(15), req.send()) => r,
                    };

                    let resp = match send_res {
                        Ok(Ok(r)) if r.status().is_success() || r.status().as_u16() == 206 => r,
                        Ok(Ok(r)) => {
                            attempt += 1;
                            if attempt > MAX_AUDIO_RETRIES {
                                return Err(DownloadError::HttpStatus(r.status().as_u16()));
                            }
                            let delay = (300u64 * (1u64 << (attempt - 1))).min(4000);
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                            continue;
                        }
                        Ok(Err(e)) => {
                            attempt += 1;
                            if attempt > MAX_AUDIO_RETRIES {
                                return Err(DownloadError::Http(e));
                            }
                            let delay = (300u64 * (1u64 << (attempt - 1))).min(4000);
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                            continue;
                        }
                        Err(_) => {
                            attempt += 1;
                            if attempt > MAX_AUDIO_RETRIES {
                                return Err(DownloadError::MediaTool(
                                    "Audio chunk request timed out".into(),
                                ));
                            }
                            let delay = (300u64 * (1u64 << (attempt - 1))).min(4000);
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                            continue;
                        }
                    };

                    let mut stream = resp.bytes_stream();
                    let mut chunk_err: Option<DownloadError> = None;

                    loop {
                        let next = tokio::select! {
                            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
                            c = tokio::time::timeout(Duration::from_secs(15), stream.next()) => c,
                        };
                        match next {
                            Ok(Some(Ok(bytes))) => {
                                if !bytes.is_empty() {
                                    file.write_all(&bytes)?;
                                    offset += bytes.len() as u64;
                                    attempt = 0;
                                }
                            }
                            Ok(Some(Err(e))) => {
                                chunk_err = Some(DownloadError::Http(e));
                                break;
                            }
                            Ok(None) => break,
                            Err(_) => {
                                chunk_err = Some(DownloadError::MediaTool(
                                    "Audio stream stalled".into(),
                                ));
                                break;
                            }
                        }
                    }

                    if let Some(err) = chunk_err {
                        attempt += 1;
                        if attempt > MAX_AUDIO_RETRIES {
                            return Err(err);
                        }
                        let delay = (300u64 * (1u64 << (attempt - 1))).min(4000);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    }
                }
                file.sync_all()?;
                return Ok(());
            }
        }
    }

    // Fallback single-stream audio download with retries, timeout & cancellation
    let mut attempt: u32 = 0;
    loop {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let mut req = client.get(audio_url).headers(extra.clone());
        if attempt > 0 {
            req = req.header(reqwest::header::CONNECTION, "close");
        }
        let resp = match tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
            r = tokio::time::timeout(Duration::from_secs(30), req.send()) => r,
        } {
            Ok(Ok(r)) if r.status().is_success() => r,
            Ok(Ok(r)) => {
                attempt += 1;
                if attempt > MAX_AUDIO_RETRIES {
                    return Err(DownloadError::HttpStatus(r.status().as_u16()));
                }
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                continue;
            }
            Ok(Err(e)) => {
                attempt += 1;
                if attempt > MAX_AUDIO_RETRIES {
                    return Err(DownloadError::Http(e));
                }
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                continue;
            }
            Err(_) => {
                attempt += 1;
                if attempt > MAX_AUDIO_RETRIES {
                    return Err(DownloadError::MediaTool("Audio request timed out".into()));
                }
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                continue;
            }
        };

        let mut file = File::create(dest)?;
        let mut stream = resp.bytes_stream();
        let mut failed = None;
        while let Some(chunk) = match tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
            c = tokio::time::timeout(Duration::from_secs(30), stream.next()) => c,
        } {
            Ok(c) => c,
            Err(_) => {
                failed = Some(DownloadError::MediaTool("Audio stream stalled".into()));
                None
            }
        } {
            match chunk {
                Ok(bytes) => file.write_all(&bytes)?,
                Err(e) => {
                    failed = Some(DownloadError::Http(e));
                    break;
                }
            }
        }

        if let Some(err) = failed {
            attempt += 1;
            if attempt > MAX_AUDIO_RETRIES {
                return Err(err);
            }
            tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
            continue;
        }

        file.sync_all()?;
        return Ok(());
    }
}

async fn finalize_download(
    client: &Client,
    data_dir: &Path,
    mut task: DownloadTaskInfo,
    segments: &[Arc<LiveSegment>],
    part_path: &Path,
    final_path: &Path,
    audio_handle: Option<tokio::task::JoinHandle<Result<(), DownloadError>>>,
    cancel: &CancellationToken,
    on_progress: ProgressCallback,
) -> DownloadTaskInfo {
    if let Some(audio_url) = task.companion_audio_url.clone() {
        task.status = DownloadStatus::Muxing;
        task.speed_bps = 0;
        task.eta_seconds = None;
        on_progress(task.clone());

        let audio_part = audio_part_file_path(final_path);
        let audio_res = match audio_handle {
            Some(handle) => match handle.await {
                Ok(res) => res,
                Err(e) => Err(DownloadError::MediaTool(format!("Audio task panicked: {}", e))),
            },
            None => {
                download_companion_audio(client, &audio_url, &task.request_headers, &audio_part, cancel)
                    .await
            }
        };

        match audio_res {
            Ok(()) => {}
            Err(DownloadError::Cancelled) => {
                let _ = fs::remove_file(&audio_part);
                task.status = DownloadStatus::Paused;
                on_progress(task.clone());
                return task;
            }
            Err(e) => {
                let _ = fs::remove_file(&audio_part);
                task.status = DownloadStatus::Error;
                task.error_message = Some(format!("Failed to download audio track: {}", e));
                on_progress(task.clone());
                return task;
            }
        }

        if let Err(e) =
            mux_video_and_audio(client, data_dir, part_path, &audio_part, final_path).await
        {
            let _ = fs::remove_file(&audio_part);
            task.status = DownloadStatus::Error;
            task.error_message = Some(e.to_string());
            on_progress(task.clone());
            return task;
        }

        let _ = fs::remove_file(part_path);
        let _ = fs::remove_file(&audio_part);
    } else if part_path.exists() {
        if let Err(e) = fs::rename(part_path, final_path) {
            task.status = DownloadStatus::Error;
            task.error_message = Some(format!("Failed to finalize file: {}", e));
            on_progress(task.clone());
            return task;
        }
    }

    task.segments = segments.iter().map(|s| s.snapshot()).collect();
    if let Ok(meta) = fs::metadata(final_path) {
        let final_len = meta.len();
        if task.companion_audio_url.is_some() || task.total_size.is_none() {
            task.total_size = Some(final_len);
            task.downloaded = final_len;
        } else {
            task.downloaded = segments.iter().map(|s| s.downloaded_bytes()).sum();
        }
    } else {
        task.downloaded = segments.iter().map(|s| s.downloaded_bytes()).sum();
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
