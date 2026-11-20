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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    app: &'static str,
    version: &'static str,
    status: &'static str,
    bridge_enabled: bool,
}

pub type BrowserNotifyCallback = Arc<dyn Fn(DownloadTaskInfo) + Send + Sync>;

/// Starts the loopback-only HTTP bridge (`127.0.0.1:<port>`) for the HyperDM browser extension.
/// Returns the bound `SocketAddr` (useful when binding to port `0` in tests).
pub async fn start_bridge_server(
    port: u16,
    manager: DownloadManager,
    on_browser_download: BrowserNotifyCallback,
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
            tokio::spawn(async move {
                let _ = handle_connection(stream, mgr, notify).await;
            });
        }
    });

    Ok(addr)
}

async fn handle_connection(
    mut stream: TcpStream,
    manager: DownloadManager,
    on_browser_download: BrowserNotifyCallback,
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
            send_json(&mut stream, 431, r#"{"error":"Headers too large"}"#).await?;
            return Ok(());
        }
    };

    let (method, path, content_length) = {
        let header_str = String::from_utf8_lossy(&buf[..header_end]);
        let mut lines = header_str.lines();
        let request_line = lines.next().unwrap_or("");
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();

        let mut content_length: usize = 0;
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case("content-length") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
        }
        (method, path, content_length)
    };

    if content_length > MAX_BODY_BYTES {
        send_json(&mut stream, 413, r#"{"error":"Payload too large"}"#).await?;
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
        let resp = "HTTP/1.1 204 No Content\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
            Access-Control-Allow-Headers: Content-Type\r\n\
            Content-Length: 0\r\n\
            Connection: close\r\n\r\n";
        stream.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

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
            send_json(&mut stream, 200, &json).await?;
        }
        ("POST", "/api/downloads") => {
            let settings = manager.get_settings();
            if !settings.bridge_enabled {
                send_json(
                    &mut stream,
                    503,
                    r#"{"error":"Browser integration is disabled in HyperDM settings"}"#,
                )
                .await?;
                return Ok(());
            }

            let parsed: BrowserDownloadPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => {
                    let msg = serde_json::json!({ "error": format!("Invalid JSON: {}", e) });
                    send_json(&mut stream, 400, &msg.to_string()).await?;
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
            };

            match manager.add_download(req).await {
                Ok(task) => {
                    on_browser_download(task.clone());
                    let json = serde_json::to_string(&task).unwrap_or_else(|_| "{}".to_string());
                    send_json(&mut stream, 201, &json).await?;
                }
                Err(e) => {
                    let msg = serde_json::json!({ "error": e.to_string() });
                    send_json(&mut stream, 400, &msg.to_string()).await?;
                }
            }
        }
        _ => {
            send_json(&mut stream, 404, r#"{"error":"Not found"}"#).await?;
        }
    }

    Ok(())
}

async fn send_json(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let resp = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        status,
        reason,
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
