use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::engine::bridge::start_bridge_server;
use crate::engine::manager::DownloadManager;
use crate::engine::models::{AddDownloadRequest, DownloadStatus};
use crate::engine::youtube::{find_ffmpeg, is_youtube_url, parse_ytdlp_json};

#[derive(Clone)]
struct ServerConfig {
    payload: Arc<Vec<u8>>,
    supports_range: bool,
    /// If true, any range starting at byte 0 is artificially throttled so faster workers steal its work.
    slow_first_segment: bool,
    /// If true, drops the first non-HEAD GET connection partway through to test retry logic.
    drop_once: Arc<AtomicBool>,
}

async fn start_test_server(cfg: ServerConfig) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let cfg = cfg.clone();
            tokio::spawn(async move {
                let mut req_buf = vec![0u8; 4096];
                let Ok(n) = socket.read(&mut req_buf).await else {
                    return;
                };
                if n == 0 {
                    return;
                }
                let req_str = String::from_utf8_lossy(&req_buf[..n]);
                let first_line = req_str.lines().next().unwrap_or("");
                let is_head = first_line.starts_with("HEAD ");

                let mut range_header: Option<(u64, u64)> = None;
                for line in req_str.lines() {
                    if let Some(val) = line.strip_prefix("Range: ").or_else(|| line.strip_prefix("range: ")) {
                        if let Some(bytes_part) = val.trim().strip_prefix("bytes=") {
                            let mut parts = bytes_part.split('-');
                            if let (Some(s), Some(e)) = (parts.next(), parts.next()) {
                                if let Ok(start) = s.parse::<u64>() {
                                    let end = e
                                        .parse::<u64>()
                                        .unwrap_or((cfg.payload.len() as u64).saturating_sub(1));
                                    range_header = Some((start, end));
                                }
                            }
                        }
                    }
                }

                let total = cfg.payload.len() as u64;

                if is_head {
                    let accept = if cfg.supports_range {
                        "Accept-Ranges: bytes\r\n"
                    } else {
                        "Accept-Ranges: none\r\n"
                    };
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n{}ETag: \"test-etag-1\"\r\nContent-Disposition: attachment; filename=\"sample.bin\"\r\nConnection: close\r\n\r\n",
                        total, accept
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                if cfg.supports_range {
                    if let Some((start, raw_end)) = range_header {
                        let end = raw_end.min(total - 1);
                        let len = end - start + 1;
                        let header = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nETag: \"test-etag-1\"\r\nConnection: close\r\n\r\n",
                            len, start, end, total
                        );
                        if socket.write_all(header.as_bytes()).await.is_err() {
                            return;
                        }

                        let slice = &cfg.payload[start as usize..=end as usize];
                        let is_slow = cfg.slow_first_segment && start == 0 && len > 1;
                        let should_drop = len > 65536
                            && cfg
                                .drop_once
                                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                                .is_ok();

                        let chunk_size = 32 * 1024;
                        let mut sent = 0usize;
                        for chunk in slice.chunks(chunk_size) {
                            if socket.write_all(chunk).await.is_err() {
                                return;
                            }
                            sent += chunk.len();
                            if should_drop && sent >= 64 * 1024 {
                                // Abruptly close connection mid-stream
                                return;
                            }
                            if is_slow {
                                tokio::time::sleep(Duration::from_millis(25)).await;
                            }
                        }
                        return;
                    }
                }

                // 200 OK full payload (non-Range server)
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    total
                );
                if socket.write_all(header.as_bytes()).await.is_err() {
                    return;
                }
                let _ = socket.write_all(&cfg.payload).await;
            });
        }
    });

    format!("http://{}/sample.bin", addr)
}

fn deterministic_payload(size: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(size);
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    for _ in 0..size {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        data.push((x & 0xff) as u8);
    }
    data
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

async fn wait_for_terminal(mgr: &DownloadManager, id: uuid::Uuid) -> DownloadStatus {
    for _ in 0..400 {
        if let Some(t) = mgr.get_download(id) {
            if matches!(
                t.status,
                DownloadStatus::Completed | DownloadStatus::Error | DownloadStatus::Cancelled
            ) {
                return t.status;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("Timed out waiting for download to finish");
}

#[tokio::test]
async fn test_dynamic_segmentation_work_stealing_and_integrity() {
    let payload = Arc::new(deterministic_payload(4 * 1024 * 1024)); // 4 MiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: true,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let data_dir = tmp.path().join("data");
    let save_dir = tmp.path().join("downloads");
    let mgr = DownloadManager::new(&data_dir, Arc::new(|_| {})).unwrap();

    // Use a smaller min_split_size (256 KiB) so dynamic splits happen aggressively on the 4 MiB test file
    let mut settings = mgr.get_settings();
    settings.min_split_size_bytes = 256 * 1024;
    mgr.update_settings(settings).unwrap();

    let task = mgr
        .add_download(AddDownloadRequest {
            url,
            save_dir: Some(save_dir.to_string_lossy().to_string()),
            file_name: Some("dynamic_test.bin".to_string()),
            max_connections: Some(4),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    let status = wait_for_terminal(&mgr, task.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(task.id).unwrap();
    assert!(
        final_task.dynamic_splits > 0,
        "Expected dynamic work-stealing splits > 0, got {}",
        final_task.dynamic_splits
    );
    assert_eq!(final_task.downloaded, payload.len() as u64);

    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(disk_bytes.len(), payload.len());
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);
}

#[tokio::test]
async fn test_pause_persist_and_resume_integrity() {
    let payload = Arc::new(deterministic_payload(3 * 1024 * 1024)); // 3 MiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: true,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let data_dir = tmp.path().join("data");
    let save_dir = tmp.path().join("downloads");

    let task_id = {
        let mgr = DownloadManager::new(&data_dir, Arc::new(|_| {})).unwrap();
        let task = mgr
            .add_download(AddDownloadRequest {
                url,
                save_dir: Some(save_dir.to_string_lossy().to_string()),
                file_name: Some("resume_test.bin".to_string()),
                max_connections: Some(4),
                headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
            })
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(120)).await;
        mgr.pause_download(task.id).unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        task.id
    };

    // Simulate app restart by creating a brand new DownloadManager from the same data_dir
    let mgr2 = DownloadManager::new(&data_dir, Arc::new(|_| {})).unwrap();
    let reloaded = mgr2.get_download(task_id).unwrap();
    assert!(matches!(
        reloaded.status,
        DownloadStatus::Paused | DownloadStatus::Completed
    ));

    if reloaded.status != DownloadStatus::Completed {
        mgr2.resume_download(task_id).await.unwrap();
        let status = wait_for_terminal(&mgr2, task_id).await;
        assert_eq!(status, DownloadStatus::Completed);
    }

    let final_task = mgr2.get_download(task_id).unwrap();
    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);
}

#[tokio::test]
async fn test_rapid_pause_and_immediate_resume() {
    let payload = Arc::new(deterministic_payload(3 * 1024 * 1024)); // 3 MiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: true,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();

    let task = mgr
        .add_download(AddDownloadRequest {
            url,
            save_dir: Some(tmp.path().join("dl").to_string_lossy().to_string()),
            file_name: Some("rapid_resume.bin".to_string()),
            max_connections: Some(4),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(80)).await;
    // Pause and immediately resume with zero delay
    mgr.pause_download(task.id).unwrap();
    mgr.resume_download(task.id).await.unwrap();

    let status = wait_for_terminal(&mgr, task.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(task.id).unwrap();
    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);
}

#[tokio::test]
async fn test_non_range_server_single_stream_fallback() {
    let payload = Arc::new(deterministic_payload(512 * 1024)); // 512 KiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: false,
        slow_first_segment: false,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();

    let task = mgr
        .add_download(AddDownloadRequest {
            url,
            save_dir: Some(tmp.path().join("dl").to_string_lossy().to_string()),
            file_name: Some("single_stream.bin".to_string()),
            max_connections: Some(8),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    assert!(!task.supports_range);
    let status = wait_for_terminal(&mgr, task.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(task.id).unwrap();
    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);
}

#[tokio::test]
async fn test_mid_stream_drop_retry_recovery() {
    let payload = Arc::new(deterministic_payload(2 * 1024 * 1024)); // 2 MiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: false,
        drop_once: Arc::new(AtomicBool::new(true)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();

    let task = mgr
        .add_download(AddDownloadRequest {
            url,
            save_dir: Some(tmp.path().join("dl").to_string_lossy().to_string()),
            file_name: Some("retry_test.bin".to_string()),
            max_connections: Some(4),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    let status = wait_for_terminal(&mgr, task.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(task.id).unwrap();
    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);
}

#[tokio::test]
async fn test_browser_bridge_health_and_download_handoff() {
    let payload = Arc::new(deterministic_payload(1024 * 1024)); // 1 MiB
    let expected_hash = sha256_hex(&payload);

    let file_url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: false,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();
    let mut settings = mgr.get_settings();
    settings.default_save_dir = tmp.path().join("browser_dl").to_string_lossy().to_string();
    mgr.update_settings(settings).unwrap();

    let notified = Arc::new(AtomicBool::new(false));
    let notified_clone = Arc::clone(&notified);
    let yt_opened = Arc::new(std::sync::Mutex::new(Option::<String>::None));
    let yt_opened_clone = Arc::clone(&yt_opened);
    let bridge_addr = start_bridge_server(
        0,
        mgr.clone(),
        Arc::new(move |_| {
            notified_clone.store(true, Ordering::SeqCst);
        }),
        Arc::new(move |url| {
            *yt_opened_clone.lock().unwrap() = Some(url);
        }),
    )
    .await
    .unwrap();

    let client = reqwest::Client::new();

    // 1. Health check
    let health = client
        .get(format!("http://{}/health", bridge_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
    let health_json: serde_json::Value =
        serde_json::from_str(&health.text().await.unwrap()).unwrap();
    assert_eq!(health_json["app"], "HyperDM");
    assert_eq!(health_json["bridgeEnabled"], true);

    // 2. Handoff download from browser extension with cookies & referer
    let body = serde_json::json!({
        "url": file_url,
        "fileName": "from_browser.bin",
        "referer": "https://example.com/downloads",
        "cookies": "session=abc123",
        "userAgent": "Mozilla/5.0 TestBrowser"
    })
    .to_string();
    let resp = client
        .post(format!("http://{}/api/downloads", bridge_addr))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 201);
    assert!(notified.load(Ordering::SeqCst));

    let created: crate::engine::models::DownloadTaskInfo =
        serde_json::from_str(&resp.text().await.unwrap()).unwrap();
    assert_eq!(
        created.request_headers.get("Cookie").map(String::as_str),
        Some("session=abc123")
    );
    assert_eq!(
        created.request_headers.get("Referer").map(String::as_str),
        Some("https://example.com/downloads")
    );

    let status = wait_for_terminal(&mgr, created.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(created.id).unwrap();
    let disk_bytes = std::fs::read(&final_task.full_path).unwrap();
    assert_eq!(sha256_hex(&disk_bytes), expected_hash);

    // 3. YouTube open-url handoff endpoint
    let yt_resp = client
        .post(format!("http://{}/api/youtube/open", bridge_addr))
        .header("Content-Type", "application/json")
        .header("Origin", "chrome-extension://hyperdmtest")
        .body(r#"{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(yt_resp.status().as_u16(), 200);
    assert_eq!(
        yt_resp
            .headers()
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some("chrome-extension://hyperdmtest")
    );
    assert_eq!(
        yt_opened.lock().unwrap().as_deref(),
        Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    );

    // 4. Reject arbitrary website Origins with 403 Forbidden
    let evil_resp = client
        .get(format!("http://{}/health", bridge_addr))
        .header("Origin", "https://evil.example.com")
        .send()
        .await
        .unwrap();
    assert_eq!(evil_resp.status().as_u16(), 403);
}

#[tokio::test]
async fn test_max_concurrent_downloads_queue_enforcement() {
    let payload = Arc::new(deterministic_payload(2 * 1024 * 1024)); // 2 MiB
    let expected_hash = sha256_hex(&payload);

    let url = start_test_server(ServerConfig {
        payload: Arc::clone(&payload),
        supports_range: true,
        slow_first_segment: true,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let tmp = TempDir::new().unwrap();
    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();
    let mut settings = mgr.get_settings();
    settings.max_concurrent_downloads = 1;
    mgr.update_settings(settings).unwrap();

    let save_dir = tmp.path().join("queued_dl").to_string_lossy().to_string();

    let t1 = mgr
        .add_download(AddDownloadRequest {
            url: url.clone(),
            save_dir: Some(save_dir.clone()),
            file_name: Some("first.bin".to_string()),
            max_connections: Some(2),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    let t2 = mgr
        .add_download(AddDownloadRequest {
            url,
            save_dir: Some(save_dir),
            file_name: Some("second.bin".to_string()),
            max_connections: Some(2),
            headers: Default::default(),
            companion_audio_url: None,
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: None,
        })
        .await
        .unwrap();

    // Second task should start as Queued while first is active (unless first already finished)
    assert!(matches!(
        t2.status,
        DownloadStatus::Queued | DownloadStatus::Downloading | DownloadStatus::Completed
    ));

    assert_eq!(wait_for_terminal(&mgr, t1.id).await, DownloadStatus::Completed);
    assert_eq!(wait_for_terminal(&mgr, t2.id).await, DownloadStatus::Completed);

    let b1 = std::fs::read(mgr.get_download(t1.id).unwrap().full_path).unwrap();
    let b2 = std::fs::read(mgr.get_download(t2.id).unwrap().full_path).unwrap();
    assert_eq!(sha256_hex(&b1), expected_hash);
    assert_eq!(sha256_hex(&b2), expected_hash);
}

#[test]
fn test_youtube_url_detection_and_format_selection() {
    assert!(is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    assert!(is_youtube_url("https://youtu.be/dQw4w9WgXcQ"));
    assert!(is_youtube_url("https://www.youtube.com/shorts/abc123XYZ"));
    assert!(is_youtube_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ"));
    assert!(!is_youtube_url("https://example.com/video.mp4"));
    assert!(!is_youtube_url("https://www.youtube.com/"));

    let fixture = r#"{
        "title": "Sample 4K Test Video",
        "uploader": "HyperDM Channel",
        "duration": 125.4,
        "thumbnail": "https://i.ytimg.com/vi/test/maxresdefault.jpg",
        "formats": [
            {
                "format_id": "140",
                "ext": "m4a",
                "url": "https://cdn.example.com/audio_140.m4a",
                "protocol": "https",
                "vcodec": "none",
                "acodec": "mp4a.40.2",
                "abr": 128.0,
                "filesize": 2000000
            },
            {
                "format_id": "137",
                "ext": "mp4",
                "url": "https://cdn.example.com/video_1080.mp4",
                "protocol": "https",
                "vcodec": "avc1.640028",
                "acodec": "none",
                "height": 1080,
                "fps": 60.0,
                "tbr": 4200.0,
                "filesize": 45000000
            },
            {
                "format_id": "313",
                "ext": "webm",
                "url": "https://cdn.example.com/video_2160.webm",
                "protocol": "https",
                "vcodec": "vp9",
                "acodec": "none",
                "height": 2160,
                "fps": 30.0,
                "tbr": 15000.0,
                "filesize": 120000000
            },
            {
                "format_id": "18",
                "ext": "mp4",
                "url": "https://cdn.example.com/prog_360.mp4",
                "protocol": "https",
                "vcodec": "avc1.42001E",
                "acodec": "mp4a.40.2",
                "height": 360,
                "filesize": 8000000
            }
        ]
    }"#;

    let parsed = parse_ytdlp_json("https://youtu.be/dQw4w9WgXcQ", fixture, true).unwrap();
    assert_eq!(parsed.title, "Sample 4K Test Video");
    assert_eq!(parsed.uploader.as_deref(), Some("HyperDM Channel"));
    assert_eq!(parsed.duration_seconds, Some(125));
    assert!(parsed.ffmpeg_available);
    // Expected order: 2160p adaptive, 1080p adaptive, 360p progressive, Audio Only
    assert_eq!(parsed.formats.len(), 4);
    assert_eq!(parsed.formats[0].height, Some(2160));
    assert!(parsed.formats[0].needs_mux);
    assert_eq!(
        parsed.formats[0].audio_url.as_deref(),
        Some("https://cdn.example.com/audio_140.m4a")
    );
    assert_eq!(parsed.formats[0].approx_size_bytes, Some(122_000_000));
    assert_eq!(parsed.formats[1].height, Some(1080));
    assert!(parsed.formats[1].label.contains("60fps"));
    assert!(!parsed.formats[2].needs_mux);
    assert!(parsed.formats[3].is_audio_only);
}

#[test]
fn test_youtube_multi_language_prefers_original_audio_over_dubbed() {
    let fixture = r#"{
        "title": "Multi-Audio Dubbed Video",
        "language": "en",
        "formats": [
            {
                "format_id": "140-0",
                "format_note": "medium, English (original)",
                "ext": "m4a",
                "url": "https://cdn.example.com/audio_en_original.m4a",
                "protocol": "https",
                "vcodec": "none",
                "acodec": "mp4a.40.2",
                "language": "en",
                "language_preference": 10,
                "abr": 128.0
            },
            {
                "format_id": "140-1",
                "format_note": "medium, Japanese (dubbed)",
                "ext": "m4a",
                "url": "https://cdn.example.com/audio_ja_dubbed.m4a",
                "protocol": "https",
                "vcodec": "none",
                "acodec": "mp4a.40.2",
                "language": "ja",
                "language_preference": -10,
                "abr": 131.5
            },
            {
                "format_id": "137",
                "ext": "mp4",
                "url": "https://cdn.example.com/video_1080.mp4",
                "protocol": "https",
                "vcodec": "avc1.640028",
                "acodec": "none",
                "height": 1080,
                "fps": 30.0,
                "tbr": 3500.0
            }
        ]
    }"#;

    let parsed = parse_ytdlp_json("https://youtu.be/dQw4w9WgXcQ", fixture, true).unwrap();
    assert_eq!(
        parsed.formats[0].audio_url.as_deref(),
        Some("https://cdn.example.com/audio_en_original.m4a")
    );
    let audio_only = parsed.formats.iter().find(|f| f.is_audio_only).unwrap();
    assert_eq!(
        audio_only.video_url,
        "https://cdn.example.com/audio_en_original.m4a"
    );
}

#[tokio::test]
async fn test_adaptive_video_audio_download_and_ffmpeg_mux() {
    let tmp = TempDir::new().unwrap();
    let Some(ffmpeg) = find_ffmpeg(&tmp.path().join("data")) else {
        // Skip gracefully on environments without ffmpeg
        return;
    };
    let src_video = tmp.path().join("src_video.mp4");
    let src_audio = tmp.path().join("src_audio.m4a");

    // Synthesize tiny valid 1-second video-only MP4 and audio-only M4A
    let v_ok = std::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x120:d=1",
            "-c:v",
            "mpeg4",
            "-an",
        ])
        .arg(&src_video)
        .output()
        .unwrap()
        .status
        .success();
    assert!(v_ok, "ffmpeg failed to synthesize test video");

    let a_ok = std::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "aac",
            "-vn",
        ])
        .arg(&src_audio)
        .output()
        .unwrap()
        .status
        .success();
    assert!(a_ok, "ffmpeg failed to synthesize test audio");

    let video_bytes = Arc::new(std::fs::read(&src_video).unwrap());
    let audio_bytes = Arc::new(std::fs::read(&src_audio).unwrap());

    let video_url = start_test_server(ServerConfig {
        payload: video_bytes,
        supports_range: true,
        slow_first_segment: false,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let audio_url = start_test_server(ServerConfig {
        payload: audio_bytes,
        supports_range: true,
        slow_first_segment: false,
        drop_once: Arc::new(AtomicBool::new(false)),
    })
    .await;

    let mgr = DownloadManager::new(&tmp.path().join("data"), Arc::new(|_| {})).unwrap();
    let save_dir = tmp.path().join("out");

    let task = mgr
        .add_download(AddDownloadRequest {
            url: video_url,
            save_dir: Some(save_dir.to_string_lossy().to_string()),
            file_name: Some("muxed_video.mp4".to_string()),
            max_connections: Some(4),
            headers: Default::default(),
            companion_audio_url: Some(audio_url),
            source_page_url: None,
            media_format_id: None,
            media_thumbnail: None,
            media_quality_label: Some("1080p Full HD (MP4)".to_string()),
        })
        .await
        .unwrap();

    let status = wait_for_terminal(&mgr, task.id).await;
    assert_eq!(status, DownloadStatus::Completed);

    let final_task = mgr.get_download(task.id).unwrap();
    let out_path = std::path::Path::new(&final_task.full_path);
    assert!(out_path.exists(), "Muxed output file should exist");
    assert!(
        !crate::engine::coordinator::part_file_path(out_path).exists(),
        "Video .part file should be cleaned up"
    );
    assert!(
        !crate::engine::coordinator::audio_part_file_path(out_path).exists(),
        "Audio .part file should be cleaned up"
    );

    // Verify with ffprobe that the muxed MP4 contains both video and audio streams
    if let Ok(probe_out) = std::process::Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
        .arg(out_path)
        .output()
    {
        if probe_out.status.success() {
            let streams = String::from_utf8_lossy(&probe_out.stdout);
            assert!(streams.contains("video"), "Expected video stream in muxed MP4");
            assert!(streams.contains("audio"), "Expected audio stream in muxed MP4");
        }
    }
}
