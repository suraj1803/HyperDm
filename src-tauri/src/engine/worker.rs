use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::sync::{atomic::Ordering, Arc};
use std::time::{Duration, Instant};

#[cfg(unix)]
fn write_all_at_offset(file: &File, data: &[u8], offset: u64) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(data, offset)
}

#[cfg(windows)]
fn write_all_at_offset(file: &File, data: &[u8], offset: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    let mut written = 0usize;
    while written < data.len() {
        let n = file.seek_write(&data[written..], offset + written as u64)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "failed to write whole buffer",
            ));
        }
        written += n;
    }
    Ok(())
}

use futures_util::StreamExt;
use reqwest::{header, Client};
use tokio_util::sync::CancellationToken;

use crate::engine::models::{DownloadError, SegmentStatus};
use crate::engine::prober::{build_header_map, is_googlevideo_url, with_query_range};
use crate::engine::segment::LiveSegment;

const MAX_RETRIES: u32 = 5;
const MAX_THROTTLE_RECONNECTS: u32 = 8;
const WRITE_BUFFER_THRESHOLD: usize = 512 * 1024; // 512 KiB buffered flush to reduce spawn_blocking overhead
/// YouTube's googlevideo CDN bursts the first ~2–4 MiB at full line speed before
/// applying trickle pacing. Capping each `&range=` sub-request to 2 MiB over
/// HTTP/1.1 Keep-Alive keeps every chunk inside the unthrottled burst window.
const YOUTUBE_SUB_RANGE_BYTES: u64 = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const STREAM_STALL_TIMEOUT: Duration = Duration::from_secs(15);
const YT_THROTTLE_GRACE: Duration = Duration::from_secs(2);
const YT_THROTTLE_MIN_BPS: u64 = 48 * 1024; // 48 KiB/s
const YT_THROTTLE_WINDOW: Duration = Duration::from_secs(3);

#[derive(Debug)]
pub enum WorkerOutcome {
    Completed { segment_id: u32 },
    Paused { segment_id: u32 },
    Failed { segment_id: u32, error: String },
}

/// Runs a single HTTP Range worker for `segment`.
/// Dynamically respects `segment`'s upper bound if another worker splits it mid-flight.
pub async fn run_range_worker(
    client: Client,
    url: String,
    etag: Option<String>,
    custom_headers: HashMap<String, String>,
    file: Arc<File>,
    segment: Arc<LiveSegment>,
    cancel: CancellationToken,
) -> WorkerOutcome {
    run_range_worker_with_options(
        client,
        url,
        etag,
        custom_headers,
        file,
        segment,
        cancel,
        false,
        REQUEST_TIMEOUT,
        STREAM_STALL_TIMEOUT,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_range_worker_with_options(
    client: Client,
    url: String,
    etag: Option<String>,
    custom_headers: HashMap<String, String>,
    file: Arc<File>,
    segment: Arc<LiveSegment>,
    cancel: CancellationToken,
    force_query_range: bool,
    request_timeout: Duration,
    stall_timeout: Duration,
) -> WorkerOutcome {
    let seg_id = segment.id;
    let extra_headers = build_header_map(&custom_headers);
    let is_googlevideo = is_googlevideo_url(&url);
    let use_query_range = is_googlevideo || force_query_range;
    let mut attempt: u32 = 0;
    let mut throttle_reconnects: u32 = 0;
    let mut force_fresh_socket = false;

    loop {
        if cancel.is_cancelled() {
            segment.speed_bps.store(0, Ordering::Relaxed);
            if !segment.is_complete() {
                segment.set_status(SegmentStatus::Paused);
            }
            return WorkerOutcome::Paused { segment_id: seg_id };
        }

        let Some((range_start, range_end)) = segment.next_range() else {
            segment.speed_bps.store(0, Ordering::Relaxed);
            segment.set_status(SegmentStatus::Completed);
            return WorkerOutcome::Completed { segment_id: seg_id };
        };

        let req_end = if use_query_range {
            range_end.min(range_start.saturating_add(YOUTUBE_SUB_RANGE_BYTES - 1))
        } else {
            range_end
        };
        let is_sub_ranged = req_end < range_end;

        segment.set_status(SegmentStatus::Connecting);

        let mut req = if use_query_range {
            let req_url = with_query_range(&url, range_start, req_end);
            client.get(&req_url).headers(extra_headers.clone())
        } else {
            let mut r = client
                .get(&url)
                .headers(extra_headers.clone())
                .header(header::RANGE, format!("bytes={}-{}", range_start, req_end));
            if let Some(ref tag) = etag {
                r = r.header(header::IF_RANGE, tag);
            }
            r
        };

        if attempt > 0 || force_fresh_socket {
            req = req.header(header::CONNECTION, "close");
            force_fresh_socket = false;
        }

        let resp_res = tokio::select! {
            _ = cancel.cancelled() => {
                segment.speed_bps.store(0, Ordering::Relaxed);
                segment.set_status(SegmentStatus::Paused);
                return WorkerOutcome::Paused { segment_id: seg_id };
            }
            res = tokio::time::timeout(request_timeout, req.send()) => res,
        };

        let resp = match resp_res {
            Ok(Ok(r)) => {
                let code = r.status().as_u16();
                let valid_status = code == 206
                    || (use_query_range && code == 200)
                    || (code == 200 && range_start == 0);
                if !valid_status {
                    attempt += 1;
                    segment.retries.store(attempt, Ordering::Relaxed);
                    // Fail fast on expired YouTube URLs (403/410) after 1 retry so manager can refresh
                    let fast_fail = is_googlevideo && (code == 403 || code == 410) && attempt >= 2;
                    if fast_fail || attempt > MAX_RETRIES {
                        segment.speed_bps.store(0, Ordering::Relaxed);
                        segment.set_status(SegmentStatus::Error);
                        return WorkerOutcome::Failed {
                            segment_id: seg_id,
                            error: format!("Unexpected HTTP status {} for range request", code),
                        };
                    }
                    if !backoff_wait(attempt, &cancel).await {
                        segment.set_status(SegmentStatus::Paused);
                        return WorkerOutcome::Paused { segment_id: seg_id };
                    }
                    continue;
                }
                r
            }
            Ok(Err(err)) => {
                attempt += 1;
                segment.retries.store(attempt, Ordering::Relaxed);
                if attempt > MAX_RETRIES {
                    segment.speed_bps.store(0, Ordering::Relaxed);
                    segment.set_status(SegmentStatus::Error);
                    return WorkerOutcome::Failed {
                        segment_id: seg_id,
                        error: err.to_string(),
                    };
                }
                if !backoff_wait(attempt, &cancel).await {
                    segment.set_status(SegmentStatus::Paused);
                    return WorkerOutcome::Paused { segment_id: seg_id };
                }
                continue;
            }
            Err(_) => {
                attempt += 1;
                segment.retries.store(attempt, Ordering::Relaxed);
                force_fresh_socket = true;
                if attempt > MAX_RETRIES {
                    segment.speed_bps.store(0, Ordering::Relaxed);
                    segment.set_status(SegmentStatus::Error);
                    return WorkerOutcome::Failed {
                        segment_id: seg_id,
                        error: "Range request timed out".to_string(),
                    };
                }
                if !backoff_wait(attempt, &cancel).await {
                    segment.set_status(SegmentStatus::Paused);
                    return WorkerOutcome::Paused { segment_id: seg_id };
                }
                continue;
            }
        };

        segment.set_status(SegmentStatus::Downloading);
        let mut stream = resp.bytes_stream();
        let mut write_buf: Vec<u8> = Vec::with_capacity(WRITE_BUFFER_THRESHOLD + 65536);

        let req_started = Instant::now();
        let mut window_start = Instant::now();
        let mut window_bytes: u64 = 0;
        let mut slow_since: Option<Instant> = None;
        let mut stream_err: Option<String> = None;
        let mut throttled = false;
        let mut reached_end = false;

        loop {
            let next_chunk = tokio::select! {
                _ = cancel.cancelled() => {
                    // Flush whatever is buffered before pausing
                    let _ = flush_buffer(&file, &segment, &mut write_buf).await;
                    segment.speed_bps.store(0, Ordering::Relaxed);
                    if segment.is_complete() {
                        segment.set_status(SegmentStatus::Completed);
                        return WorkerOutcome::Completed { segment_id: seg_id };
                    } else {
                        segment.set_status(SegmentStatus::Paused);
                        return WorkerOutcome::Paused { segment_id: seg_id };
                    }
                }
                chunk = tokio::time::timeout(stall_timeout, stream.next()) => chunk,
            };

            match next_chunk {
                Ok(Some(Ok(bytes))) => {
                    if bytes.is_empty() {
                        continue;
                    }
                    // Reset retry counter once we are actively receiving data
                    attempt = 0;

                    write_buf.extend_from_slice(&bytes);
                    window_bytes += bytes.len() as u64;

                    let elapsed = window_start.elapsed();
                    if elapsed >= Duration::from_millis(200) {
                        let bps = (window_bytes as f64 / elapsed.as_secs_f64()) as u64;
                        segment.speed_bps.store(bps, Ordering::Relaxed);
                        window_start = Instant::now();
                        window_bytes = 0;

                        if is_googlevideo && req_started.elapsed() >= YT_THROTTLE_GRACE {
                            if bps < YT_THROTTLE_MIN_BPS {
                                let since = *slow_since.get_or_insert_with(Instant::now);
                                if since.elapsed() >= YT_THROTTLE_WINDOW {
                                    let _ = flush_buffer(&file, &segment, &mut write_buf).await;
                                    throttled = true;
                                    force_fresh_socket = true;
                                    break;
                                }
                            } else {
                                slow_since = None;
                            }
                        }
                    }

                    if write_buf.len() >= WRITE_BUFFER_THRESHOLD {
                        match flush_buffer(&file, &segment, &mut write_buf).await {
                            Ok(hit_bound) => {
                                if hit_bound {
                                    reached_end = true;
                                    break;
                                }
                            }
                            Err(e) => {
                                segment.speed_bps.store(0, Ordering::Relaxed);
                                segment.set_status(SegmentStatus::Error);
                                return WorkerOutcome::Failed {
                                    segment_id: seg_id,
                                    error: e.to_string(),
                                };
                            }
                        }
                    }
                }
                Ok(Some(Err(e))) => {
                    let _ = flush_buffer(&file, &segment, &mut write_buf).await;
                    stream_err = Some(e.to_string());
                    force_fresh_socket = true;
                    break;
                }
                Ok(None) => {
                    // Stream finished cleanly; flush remaining buffer
                    if let Err(e) = flush_buffer(&file, &segment, &mut write_buf).await {
                        segment.speed_bps.store(0, Ordering::Relaxed);
                        segment.set_status(SegmentStatus::Error);
                        return WorkerOutcome::Failed {
                            segment_id: seg_id,
                            error: e.to_string(),
                        };
                    }
                    break;
                }
                Err(_) => {
                    let _ = flush_buffer(&file, &segment, &mut write_buf).await;
                    stream_err = Some("Stream stalled (read timeout)".to_string());
                    force_fresh_socket = true;
                    break;
                }
            }
        }

        if reached_end || segment.is_complete() {
            segment.speed_bps.store(0, Ordering::Relaxed);
            segment.set_status(SegmentStatus::Completed);
            return WorkerOutcome::Completed { segment_id: seg_id };
        }

        if throttled {
            throttle_reconnects += 1;
            if throttle_reconnects <= MAX_THROTTLE_RECONNECTS {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        segment.speed_bps.store(0, Ordering::Relaxed);
                        segment.set_status(SegmentStatus::Paused);
                        return WorkerOutcome::Paused { segment_id: seg_id };
                    }
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {}
                }
                continue;
            }
            segment.speed_bps.store(0, Ordering::Relaxed);
            segment.set_status(SegmentStatus::Error);
            return WorkerOutcome::Failed {
                segment_id: seg_id,
                error: "YouTube stream throttled persistently".to_string(),
            };
        }

        // If we intentionally requested a 2 MiB sub-range (e.g., googlevideo.com) and it finished cleanly,
        // immediately continue to the next sub-range over the same HTTP/1.1 Keep-Alive connection.
        if is_sub_ranged && stream_err.is_none() {
            if let Some((next_start, _)) = segment.next_range() {
                if next_start > req_end {
                    attempt = 0;
                    throttle_reconnects = 0;
                    continue;
                }
            }
        }

        // Stream ended prematurely or errored -> retry from updated offset
        attempt += 1;
        segment.retries.store(attempt, Ordering::Relaxed);
        if attempt > MAX_RETRIES {
            segment.speed_bps.store(0, Ordering::Relaxed);
            segment.set_status(SegmentStatus::Error);
            return WorkerOutcome::Failed {
                segment_id: seg_id,
                error: stream_err.unwrap_or_else(|| "Connection closed prematurely".to_string()),
            };
        }
        if !backoff_wait(attempt, &cancel).await {
            segment.speed_bps.store(0, Ordering::Relaxed);
            segment.set_status(SegmentStatus::Paused);
            return WorkerOutcome::Paused { segment_id: seg_id };
        }
    }
}

/// Flushes `buf` to disk at the segment's exact offset using `write_all_at`.
/// Returns `Ok(true)` if the segment reached its (possibly dynamically shrunk) upper bound.
async fn flush_buffer(
    file: &Arc<File>,
    segment: &Arc<LiveSegment>,
    buf: &mut Vec<u8>,
) -> Result<bool, DownloadError> {
    if buf.is_empty() {
        return Ok(segment.is_complete());
    }

    let req_len = buf.len() as u64;
    let Some((write_offset, allowed_len)) = segment.reserve_write(req_len) else {
        buf.clear();
        return Ok(true);
    };

    let to_write = allowed_len as usize;
    let hit_bound = to_write < buf.len();
    let mut payload = std::mem::replace(buf, Vec::with_capacity(WRITE_BUFFER_THRESHOLD + 65536));
    payload.truncate(to_write);

    let file_clone = Arc::clone(file);
    let write_res =
        tokio::task::spawn_blocking(move || write_all_at_offset(&file_clone, &payload, write_offset))
            .await
            .map_err(|e| DownloadError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    match write_res {
        Ok(()) => {
            segment.commit_write(allowed_len);
            Ok(hit_bound || segment.is_complete())
        }
        Err(e) => {
            segment.rollback_write(allowed_len);
            Err(DownloadError::Io(e))
        }
    }
}

/// Single-stream fallback worker for servers that do not support HTTP Range requests
/// or do not provide Content-Length.
pub async fn run_single_stream_worker(
    client: Client,
    url: String,
    custom_headers: HashMap<String, String>,
    part_path: std::path::PathBuf,
    segment: Arc<LiveSegment>,
    cancel: CancellationToken,
) -> WorkerOutcome {
    let seg_id = segment.id;
    segment.set_status(SegmentStatus::Connecting);
    let extra_headers = build_header_map(&custom_headers);

    let resp_res = tokio::select! {
        _ = cancel.cancelled() => {
            segment.set_status(SegmentStatus::Paused);
            return WorkerOutcome::Paused { segment_id: seg_id };
        }
        res = client.get(&url).headers(extra_headers).send() => res,
    };

    let resp = match resp_res {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            segment.set_status(SegmentStatus::Error);
            return WorkerOutcome::Failed {
                segment_id: seg_id,
                error: format!("HTTP status {}", r.status().as_u16()),
            };
        }
        Err(e) => {
            segment.set_status(SegmentStatus::Error);
            return WorkerOutcome::Failed {
                segment_id: seg_id,
                error: e.to_string(),
            };
        }
    };

    let mut file = match File::create(&part_path) {
        Ok(f) => f,
        Err(e) => {
            segment.set_status(SegmentStatus::Error);
            return WorkerOutcome::Failed {
                segment_id: seg_id,
                error: e.to_string(),
            };
        }
    };

    segment.set_status(SegmentStatus::Downloading);
    let mut stream = resp.bytes_stream();
    let mut window_start = Instant::now();
    let mut window_bytes: u64 = 0;

    loop {
        let next_chunk = tokio::select! {
            _ = cancel.cancelled() => {
                let _ = file.flush();
                segment.speed_bps.store(0, Ordering::Relaxed);
                segment.set_status(SegmentStatus::Paused);
                return WorkerOutcome::Paused { segment_id: seg_id };
            }
            chunk = stream.next() => chunk,
        };

        match next_chunk {
            Some(Ok(bytes)) => {
                if let Err(e) = file.write_all(&bytes) {
                    segment.speed_bps.store(0, Ordering::Relaxed);
                    segment.set_status(SegmentStatus::Error);
                    return WorkerOutcome::Failed {
                        segment_id: seg_id,
                        error: e.to_string(),
                    };
                }
                let len = bytes.len() as u64;
                segment.advance_unbounded(len);
                window_bytes += len;

                let elapsed = window_start.elapsed();
                if elapsed >= Duration::from_millis(200) {
                    let bps = (window_bytes as f64 / elapsed.as_secs_f64()) as u64;
                    segment.speed_bps.store(bps, Ordering::Relaxed);
                    window_start = Instant::now();
                    window_bytes = 0;
                }
            }
            Some(Err(e)) => {
                segment.speed_bps.store(0, Ordering::Relaxed);
                segment.set_status(SegmentStatus::Error);
                return WorkerOutcome::Failed {
                    segment_id: seg_id,
                    error: e.to_string(),
                };
            }
            None => {
                let _ = file.sync_all();
                segment.speed_bps.store(0, Ordering::Relaxed);
                segment.set_status(SegmentStatus::Completed);
                return WorkerOutcome::Completed { segment_id: seg_id };
            }
        }
    }
}

async fn backoff_wait(attempt: u32, cancel: &CancellationToken) -> bool {
    let delay_ms = (250u64 * (1u64 << (attempt.min(5) - 1))).min(5000);
    tokio::select! {
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => true,
    }
}
