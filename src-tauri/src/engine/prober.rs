use std::collections::HashMap;
use std::time::Duration;

use percent_encoding::percent_decode_str;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{header, Client};
use url::Url;

use crate::engine::models::{DownloadError, ProbeResult};

pub fn build_header_map(custom: &HashMap<String, String>) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (k, v) in custom {
        let lower = k.to_ascii_lowercase();
        // Skip hop-by-hop or range/encoding headers that interfere with raw parallel byte-range streaming
        if matches!(
            lower.as_str(),
            "accept-encoding" | "range" | "connection" | "host" | "content-length"
        ) {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            map.insert(name, val);
        }
    }
    map
}

pub fn is_googlevideo_url(raw_url: &str) -> bool {
    Url::parse(raw_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .map(|h| h == "googlevideo.com" || h.ends_with(".googlevideo.com"))
        .unwrap_or(false)
}

/// Appends or replaces the `range=start-end` query parameter on a URL.
/// Used for `googlevideo.com` to match YouTube's native player framing and stay inside
/// the CDN's unthrottled initial burst window.
pub fn with_query_range(raw_url: &str, start: u64, end: u64) -> String {
    let Ok(mut parsed) = Url::parse(raw_url) else {
        return raw_url.to_string();
    };
    let existing: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("range"))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    {
        let mut pairs = parsed.query_pairs_mut();
        pairs.clear();
        for (k, v) in existing {
            pairs.append_pair(&k, &v);
        }
        pairs.append_pair("range", &format!("{}-{}", start, end));
    }
    parsed.to_string()
}

fn strip_query_range(raw_url: &str) -> String {
    let Ok(mut parsed) = Url::parse(raw_url) else {
        return raw_url.to_string();
    };
    let has_range = parsed
        .query_pairs()
        .any(|(k, _)| k.eq_ignore_ascii_case("range"));
    if !has_range {
        return raw_url.to_string();
    }
    let existing: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("range"))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    {
        let mut pairs = parsed.query_pairs_mut();
        pairs.clear();
        for (k, v) in existing {
            pairs.append_pair(&k, &v);
        }
    }
    parsed.to_string()
}

fn extract_clen_from_url(raw_url: &str) -> Option<u64> {
    let parsed = Url::parse(raw_url).ok()?;
    parsed
        .query_pairs()
        .find(|(k, _)| k.eq_ignore_ascii_case("clen"))
        .and_then(|(_, v)| v.parse::<u64>().ok())
}

pub fn build_http_client() -> Result<Client, DownloadError> {
    Client::builder()
        .user_agent(concat!(
            "HyperDM/",
            env!("CARGO_PKG_VERSION"),
            " (High-Speed Download Manager)"
        ))
        // Force HTTP/1.1 so each parallel worker opens its own dedicated TCP socket
        // instead of multiplexing all segments over a single HTTP/2 connection.
        .http1_only()
        .tcp_nodelay(true)
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .pool_max_idle_per_host(64)
        .pool_idle_timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(DownloadError::Http)
}

pub async fn probe_url(
    client: &Client,
    raw_url: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<ProbeResult, DownloadError> {
    let parsed = Url::parse(raw_url).map_err(|e| DownloadError::InvalidUrl(e.to_string()))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(DownloadError::InvalidUrl(
            "Only http:// and https:// URLs are supported".to_string(),
        ));
    }

    let extra_headers = build_header_map(custom_headers);
    let is_googlevideo = is_googlevideo_url(raw_url);
    let url_clen = if is_googlevideo {
        extract_clen_from_url(raw_url).filter(|&n| n > 0)
    } else {
        None
    };

    // Attempt 1: HEAD request (skipped for googlevideo.com, which frequently rejects HEAD)
    let mut final_url = raw_url.to_string();
    let mut total_size: Option<u64> = url_clen;
    let mut supports_range = false;
    let mut etag: Option<String> = None;
    let mut last_modified: Option<String> = None;
    let mut content_type: Option<String> = None;
    let mut content_disposition: Option<String> = None;
    let mut head_ok = false;

    if !is_googlevideo {
        if let Ok(resp) = client
            .head(raw_url)
            .headers(extra_headers.clone())
            .send()
            .await
        {
            if resp.status().is_success() {
                head_ok = true;
                final_url = resp.url().to_string();
                let headers = resp.headers();

                total_size = headers
                    .get(header::CONTENT_LENGTH)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok());

                supports_range = headers
                    .get(header::ACCEPT_RANGES)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.to_ascii_lowercase().contains("bytes"))
                    .unwrap_or(false);

                etag = headers
                    .get(header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                last_modified = headers
                    .get(header::LAST_MODIFIED)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                content_type = headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                content_disposition = headers
                    .get(header::CONTENT_DISPOSITION)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
            }
        }
    }

    // Attempt 2: Fallback to GET Range: bytes=0-0 (or &range=0-0 for googlevideo.com with clen)
    if !head_ok || total_size.is_none() || !supports_range {
        let used_query_range = is_googlevideo && url_clen.is_some();
        let req = if used_query_range {
            client
                .get(with_query_range(&final_url, 0, 0))
                .headers(extra_headers)
        } else {
            client
                .get(&final_url)
                .headers(extra_headers)
                .header(header::RANGE, "bytes=0-0")
        };

        let resp = req.send().await?;

        let status = resp.status();
        if !status.is_success() && status.as_u16() != 206 {
            return Err(DownloadError::HttpStatus(status.as_u16()));
        }

        final_url = if used_query_range {
            strip_query_range(resp.url().as_str())
        } else {
            resp.url().to_string()
        };
        let headers = resp.headers();

        if status.as_u16() == 206 {
            supports_range = true;
            if let Some(cr) = headers
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(parsed_total) = parse_content_range_total(cr) {
                    total_size = Some(parsed_total);
                }
            }
        } else if used_query_range {
            // googlevideo.com returns 200 OK for &range=0-0 with Content-Length: 1
            supports_range = true;
            if total_size.is_none() {
                total_size = extract_clen_from_url(&final_url);
            }
        } else {
            // 200 OK in response to Range: bytes=0-0 means server ignored Range
            supports_range = false;
            if total_size.is_none() {
                total_size = headers
                    .get(header::CONTENT_LENGTH)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok());
            }
        }

        if etag.is_none() {
            etag = headers
                .get(header::ETAG)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
        if last_modified.is_none() {
            last_modified = headers
                .get(header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
        if content_type.is_none() {
            content_type = headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
        if content_disposition.is_none() {
            content_disposition = headers
                .get(header::CONTENT_DISPOSITION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
    }

    let file_name = extract_filename(content_disposition.as_deref(), &final_url);

    Ok(ProbeResult {
        url: raw_url.to_string(),
        final_url,
        file_name,
        total_size,
        supports_range: supports_range && total_size.unwrap_or(0) > 0,
        etag,
        last_modified,
        content_type,
    })
}

fn parse_content_range_total(header_val: &str) -> Option<u64> {
    // Format: "bytes 0-0/123456" or "bytes */123456"
    let slash_idx = header_val.rfind('/')?;
    let total_str = header_val[slash_idx + 1..].trim();
    if total_str == "*" {
        return None;
    }
    total_str.parse::<u64>().ok()
}

pub fn extract_filename(content_disposition: Option<&str>, url_str: &str) -> String {
    if let Some(cd) = content_disposition {
        if let Some(name) = parse_content_disposition_filename(cd) {
            let clean = sanitize_filename(&name);
            if !clean.is_empty() {
                return clean;
            }
        }
    }

    if let Ok(parsed) = Url::parse(url_str) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.filter(|s| !s.is_empty()).last() {
                let decoded = percent_decode_str(last).decode_utf8_lossy();
                let clean = sanitize_filename(&decoded);
                if !clean.is_empty() {
                    return clean;
                }
            }
        }
    }

    "download.bin".to_string()
}

fn parse_content_disposition_filename(cd: &str) -> Option<String> {
    // Check RFC 5987 filename*=UTF-8''... first
    for part in cd.split(';') {
        let trimmed = part.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("filename*=") {
            let val = trimmed[10..].trim().trim_matches('"');
            if let Some(idx) = val.find("''") {
                let encoded = &val[idx + 2..];
                return Some(percent_decode_str(encoded).decode_utf8_lossy().to_string());
            }
            return Some(val.to_string());
        }
    }
    // Fallback to filename="..."
    for part in cd.split(';') {
        let trimmed = part.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("filename=") {
            let val = trimmed[9..].trim().trim_matches('"');
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

pub fn sanitize_filename(name: &str) -> String {
    let base = name
        .replace(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .trim_matches('.')
        .to_string();
    if base.is_empty() {
        "download.bin".to_string()
    } else {
        base
    }
}
