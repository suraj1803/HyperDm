use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::engine::manager::DownloadManager;
use crate::engine::models::{AddDownloadRequest, DownloadTaskInfo};

const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadPayload {
    pub url: String,
    pub file_name: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub cookies: Option<String>,
    pub max_connections: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeOpenPayload {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    app: &'static str,
    version: &'static str,
    status: &'static str,
    bridge_enabled: bool,
}

pub type BrowserNotifyCallback = Arc<dyn Fn(DownloadTaskInfo) + Send + Sync>;
pub type YouTubeOpenCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Starts the loopback-only HTTP bridge (`127.0.0.1:<port>`) for the HyperDM browser extension.
/// Returns the bound `SocketAddr` (useful when binding to port `0` in tests).
pub async fn start_bridge_server(
    port: u16,
    manager: DownloadManager,
    on_browser_download: BrowserNotifyCallback,
    on_youtube_open: YouTubeOpenCallback,
) -> std::io::Result<std::net::SocketAddr> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;

    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let mgr = manager.clone();
            let notify = Arc::clone(&on_browser_download);
            let yt_notify = Arc::clone(&on_youtube_open);
            tokio::spawn(async move {
                let _ = handle_connection(stream, mgr, notify, yt_notify).await;
            });
        }
    });

    Ok(addr)
}

async fn handle_connection(
    mut stream: TcpStream,
    manager: DownloadManager,
    on_browser_download: BrowserNotifyCallback,
    on_youtube_open: YouTubeOpenCallback,
) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];

    // Read until end of HTTP headers (\r\n\r\n)
    let header_end = loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 32 * 1024 {
            send_json(&mut stream, 431, r#"{"error":"Headers too large"}"#, None).await?;
            return Ok(());
        }
    };

    let (method, path, content_length, origin) = {
        let header_str = String::from_utf8_lossy(&buf[..header_end]);
        let mut lines = header_str.lines();
        let request_line = lines.next().unwrap_or("");
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();

        let mut content_length: usize = 0;
        let mut origin: Option<String> = None;
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim();
                if key.eq_ignore_ascii_case("content-length") {
                    content_length = v.trim().parse().unwrap_or(0);
                } else if key.eq_ignore_ascii_case("origin") {
                    origin = Some(v.trim().to_string());
                }
            }
        }
        (method, path, content_length, origin)
    };

    // Security: Reject requests originating from arbitrary websites.
    // Only allow browser extensions, localhost, or non-browser local callers (no Origin header).
    let allowed_origin = match origin.as_deref() {
        None => None,
        Some(o) if is_allowed_origin(o) => Some(o.to_string()),
        Some(_) => {
            send_json(&mut stream, 403, r#"{"error":"Forbidden origin"}"#, None).await?;
            return Ok(());
        }
    };

    if content_length > MAX_BODY_BYTES {
        send_json(
            &mut stream,
            413,
            r#"{"error":"Payload too large"}"#,
            allowed_origin.as_deref(),
        )
        .await?;
        return Ok(());
    }

    // Read any remaining body bytes
    while buf.len() < header_end + content_length {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }

    let body = &buf[header_end..buf.len().min(header_end + content_length)];

    // Handle CORS preflight
    if method == "OPTIONS" {
        let cors_header = allowed_origin
            .as_deref()
            .map(|o| format!("Access-Control-Allow-Origin: {}\r\n", o))
            .unwrap_or_default();
        let resp = format!(
            "HTTP/1.1 204 No Content\r\n\
            {}\
            Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
            Access-Control-Allow-Headers: Content-Type\r\n\
            Vary: Origin\r\n\
            Content-Length: 0\r\n\
            Connection: close\r\n\r\n",
            cors_header
        );
        stream.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    let cors_origin = allowed_origin.as_deref();

    match (method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            let settings = manager.get_settings();
            let payload = HealthResponse {
                app: "HyperDM",
                version: env!("CARGO_PKG_VERSION"),
                status: "ok",
                bridge_enabled: settings.bridge_enabled,
            };
            let json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
            send_json(&mut stream, 200, &json, cors_origin).await?;
        }
        ("POST", "/api/downloads") => {
            let settings = manager.get_settings();
            if !settings.bridge_enabled {
                send_json(
                    &mut stream,
                    503,
                    r#"{"error":"Browser integration is disabled in HyperDM settings"}"#,
                    cors_origin,
                )
                .await?;
                return Ok(());
            }

            let parsed: BrowserDownloadPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => {
                    let msg = serde_json::json!({ "error": format!("Invalid JSON: {}", e) });
                    send_json(&mut stream, 400, &msg.to_string(), cors_origin).await?;
                    return Ok(());
                }
            };

            let mut headers = HashMap::new();
            if let Some(ref referer) = parsed.referer {
                if !referer.trim().is_empty() {
                    headers.insert("Referer".to_string(), referer.clone());
                }
            }
            if let Some(ref ua) = parsed.user_agent {
                if !ua.trim().is_empty() {
                    headers.insert("User-Agent".to_string(), ua.clone());
                }
            }
            if let Some(ref cookies) = parsed.cookies {
                if !cookies.trim().is_empty() {
                    headers.insert("Cookie".to_string(), cookies.clone());
                }
            }

            let req = AddDownloadRequest {
                url: parsed.url,
                save_dir: None,
                file_name: parsed.file_name,
                max_connections: parsed.max_connections,
                headers,
                companion_audio_url: None,
                source_page_url: None,
                media_format_id: None,
                media_thumbnail: None,
                media_quality_label: None,
            };

            match manager.add_download(req).await {
                Ok(task) => {
                    on_browser_download(task.clone());
                    let json = serde_json::to_string(&task).unwrap_or_else(|_| "{}".to_string());
                    send_json(&mut stream, 201, &json, cors_origin).await?;
                }
                Err(e) => {
                    let msg = serde_json::json!({ "error": e.to_string() });
                    send_json(&mut stream, 400, &msg.to_string(), cors_origin).await?;
                }
            }
        }
        ("POST", "/api/youtube/open") => {
            let settings = manager.get_settings();
            if !settings.bridge_enabled {
                send_json(
                    &mut stream,
                    503,
                    r#"{"error":"Browser integration is disabled in HyperDM settings"}"#,
                    cors_origin,
                )
                .await?;
                return Ok(());
            }

            let parsed: YouTubeOpenPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => {
                    let msg = serde_json::json!({ "error": format!("Invalid JSON: {}", e) });
                    send_json(&mut stream, 400, &msg.to_string(), cors_origin).await?;
                    return Ok(());
                }
            };

            on_youtube_open(parsed.url);
            send_json(&mut stream, 200, r#"{"ok":true}"#, cors_origin).await?;
        }
        _ => {
            send_json(&mut stream, 404, r#"{"error":"Not found"}"#, cors_origin).await?;
        }
    }

    Ok(())
}

fn is_allowed_origin(origin: &str) -> bool {
    let lower = origin.to_ascii_lowercase();
    lower.starts_with("chrome-extension://")
        || lower.starts_with("moz-extension://")
        || lower.starts_with("extension://")
        || lower.starts_with("safari-web-extension://")
        || lower.starts_with("http://127.0.0.1")
        || lower.starts_with("http://localhost")
        || lower == "tauri://localhost"
        || lower == "http://tauri.localhost"
}

async fn send_json(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    cors_origin: Option<&str>,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let cors_header = cors_origin
        .map(|o| format!("Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n", o))
        .unwrap_or_default();
    let resp = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json\r\n\
         {}\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        status,
        reason,
        cors_header,
        body.len(),
        body
    );
    stream.write_all(resp.as_bytes()).await
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
