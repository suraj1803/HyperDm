use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use reqwest::Client;
use serde::Deserialize;
use tokio::process::Command;
use url::Url;

use crate::engine::models::{
    DownloadError, MediaToolsStatus, YouTubeFormatOption, YouTubeProbeResult,
};

/// Returns true if the URL points to a YouTube watch page, Shorts, Music, or youtu.be link.
pub fn is_youtube_url(raw_url: &str) -> bool {
    let Ok(parsed) = Url::parse(raw_url.trim()) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let h = host.to_ascii_lowercase();
    let is_yt_host = h == "youtube.com"
        || h.ends_with(".youtube.com")
        || h == "youtu.be"
        || h.ends_with(".youtu.be");
    if !is_yt_host {
        return false;
    }

    if h == "youtu.be" || h.ends_with(".youtu.be") {
        return parsed.path().trim_matches('/').len() >= 6;
    }

    let path = parsed.path();
    path.starts_with("/watch")
        || path.starts_with("/shorts/")
        || path.starts_with("/live/")
        || path.starts_with("/embed/")
}

fn ytdlp_binary_name() -> &'static str {
    #[cfg(windows)]
    {
        "yt-dlp.exe"
    }
    #[cfg(not(windows))]
    {
        "yt-dlp"
    }
}

fn ytdlp_release_url() -> &'static str {
    #[cfg(windows)]
    {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    }
    #[cfg(target_os = "macos")]
    {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    }
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{}.exe", binary));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}

pub fn find_ytdlp(data_dir: &Path) -> Option<PathBuf> {
    if let Some(sys) = find_in_path("yt-dlp") {
        return Some(sys);
    }
    let managed = data_dir.join("bin").join(ytdlp_binary_name());
    if managed.is_file() {
        return Some(managed);
    }
    None
}

pub fn find_ffmpeg() -> Option<PathBuf> {
    find_in_path("ffmpeg")
}

pub fn media_tools_status(data_dir: &Path) -> MediaToolsStatus {
    let ytdlp = find_ytdlp(data_dir);
    let ffmpeg = find_ffmpeg();
    MediaToolsStatus {
        ytdlp_installed: ytdlp.is_some(),
        ytdlp_path: ytdlp.map(|p| p.to_string_lossy().to_string()),
        ffmpeg_installed: ffmpeg.is_some(),
        ffmpeg_path: ffmpeg.map(|p| p.to_string_lossy().to_string()),
    }
}

/// Downloads the official standalone yt-dlp binary into `<data_dir>/bin/`.
pub async fn install_or_update_ytdlp(
    client: &Client,
    data_dir: &Path,
) -> Result<PathBuf, DownloadError> {
    let bin_dir = data_dir.join("bin");
    fs::create_dir_all(&bin_dir)?;
    let target = bin_dir.join(ytdlp_binary_name());
    let tmp = bin_dir.join(format!("{}.downloading", ytdlp_binary_name()));

    let resp = client.get(ytdlp_release_url()).send().await?;
    if !resp.status().is_success() {
        return Err(DownloadError::MediaTool(format!(
            "Failed to download yt-dlp (HTTP {})",
            resp.status().as_u16()
        )));
    }

    let bytes = resp.bytes().await?;
    fs::write(&tmp, &bytes)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tmp)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp, perms)?;
    }

    fs::rename(&tmp, &target)?;
    Ok(target)
}

#[derive(Debug, Deserialize)]
struct RawYtDlpJson {
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    #[serde(default)]
    formats: Vec<RawYtDlpFormat>,
}

#[derive(Debug, Deserialize)]
struct RawYtDlpFormat {
    format_id: Option<String>,
    ext: Option<String>,
    url: Option<String>,
    protocol: Option<String>,
    vcodec: Option<String>,
    acodec: Option<String>,
    height: Option<u32>,
    fps: Option<f64>,
    tbr: Option<f64>,
    abr: Option<f64>,
    filesize: Option<u64>,
    filesize_approx: Option<u64>,
    #[serde(default)]
    http_headers: HashMap<String, String>,
}

/// Runs yt-dlp (auto-installing it into `<data_dir>/bin/` if missing) to extract YouTube metadata
/// and direct signed stream URLs suitable for HyperDM's dynamic segmentation engine.
pub async fn probe_youtube(
    client: &Client,
    data_dir: &Path,
    url: &str,
) -> Result<YouTubeProbeResult, DownloadError> {
    if !is_youtube_url(url) {
        return Err(DownloadError::InvalidUrl(
            "Not a supported YouTube URL".to_string(),
        ));
    }

    let ytdlp_path = match find_ytdlp(data_dir) {
        Some(p) => p,
        None => install_or_update_ytdlp(client, data_dir).await?,
    };

    let output = Command::new(&ytdlp_path)
        .args([
            "--dump-single-json",
            "--no-playlist",
            "--no-warnings",
            "--skip-download",
            url,
        ])
        .output()
        .await
        .map_err(|e| DownloadError::MediaTool(format!("Failed to execute yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(DownloadError::MediaTool(format!(
            "yt-dlp failed: {}",
            stderr.trim()
        )));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let ffmpeg_available = find_ffmpeg().is_some();
    parse_ytdlp_json(url, &json_str, ffmpeg_available)
}

/// Pure JSON parser & format selector (unit-tested directly without network access).
pub fn parse_ytdlp_json(
    original_url: &str,
    json_str: &str,
    ffmpeg_available: bool,
) -> Result<YouTubeProbeResult, DownloadError> {
    let raw: RawYtDlpJson = serde_json::from_str(json_str)?;
    let title = raw
        .title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "YouTube Video".to_string());
    let uploader = raw.uploader.or(raw.channel);
    let duration_seconds = raw.duration.map(|d| d.max(0.0).round() as u64);

    // Filter to direct HTTP/HTTPS streams (skip m3u8/HLS manifests that can't use byte ranges)
    let direct_formats: Vec<&RawYtDlpFormat> = raw
        .formats
        .iter()
        .filter(|f| {
            let Some(ref u) = f.url else {
                return false;
            };
            if !u.starts_with("http://") && !u.starts_with("https://") {
                return false;
            }
            let proto = f.protocol.as_deref().unwrap_or("https").to_ascii_lowercase();
            proto == "https" || proto == "http"
        })
        .collect();

    // Find best M4A audio stream (ideal for lossless MP4 muxing) and best overall audio stream
    let best_m4a_audio = direct_formats
        .iter()
        .filter(|f| is_audio_only(f) && f.ext.as_deref() == Some("m4a"))
        .max_by(|a, b| audio_score(a).total_cmp(&audio_score(b)))
        .copied();

    let best_any_audio = direct_formats
        .iter()
        .filter(|f| is_audio_only(f))
        .max_by(|a, b| audio_score(a).total_cmp(&audio_score(b)))
        .copied();

    let paired_audio = best_m4a_audio.or(best_any_audio);

    // Best video-only stream per resolution height (prefer MP4/H.264/AV1 for broad compatibility)
    let mut best_video_by_height: BTreeMap<u32, &RawYtDlpFormat> = BTreeMap::new();
    for f in &direct_formats {
        if !is_video_only(f) {
            continue;
        }
        let Some(h) = f.height else {
            continue;
        };
        if h < 240 {
            continue;
        }
        best_video_by_height
            .entry(h)
            .and_modify(|existing| {
                if video_score(f) > video_score(existing) {
                    *existing = f;
                }
            })
            .or_insert(f);
    }

    let mut options: Vec<YouTubeFormatOption> = Vec::new();

    // 1. Adaptive HD/4K video + paired audio (highest resolution first)
    if let Some(audio) = paired_audio {
        let audio_url = audio.url.clone().unwrap_or_default();
        let audio_size = audio.filesize.or(audio.filesize_approx);

        for (&height, &vid) in best_video_by_height.iter().rev() {
            let vid_url = vid.url.clone().unwrap_or_default();
            let vid_size = vid.filesize.or(vid.filesize_approx);
            let combined_size = match (vid_size, audio_size) {
                (Some(v), Some(a)) => Some(v + a),
                (Some(v), None) => Some(v),
                _ => None,
            };
            let fps = vid.fps.map(|x| x.round() as u32);
            let quality_tag = match height {
                2160.. => format!("{}p 4K", height),
                1440..=2159 => format!("{}p QHD", height),
                1080..=1439 => format!("{}p Full HD", height),
                720..=1079 => format!("{}p HD", height),
                _ => format!("{}p", height),
            };
            let fps_suffix = if fps.unwrap_or(0) >= 50 {
                format!(" {}fps", fps.unwrap())
            } else {
                String::new()
            };

            options.push(YouTubeFormatOption {
                id: format!(
                    "{}+{}",
                    vid.format_id.as_deref().unwrap_or("v"),
                    audio.format_id.as_deref().unwrap_or("a")
                ),
                label: format!("{}{} (MP4)", quality_tag, fps_suffix),
                ext: "mp4".to_string(),
                height: Some(height),
                fps,
                is_audio_only: false,
                needs_mux: true,
                approx_size_bytes: combined_size,
                video_url: vid_url,
                audio_url: Some(audio_url.clone()),
                http_headers: vid.http_headers.clone(),
            });
        }
    }

    // 2. Best progressive (pre-muxed) fallback stream (works even without ffmpeg)
    if let Some(prog) = direct_formats
        .iter()
        .filter(|f| is_progressive(f))
        .max_by_key(|f| f.height.unwrap_or(0))
        .copied()
    {
        let h = prog.height.unwrap_or(360);
        let ext = prog.ext.clone().unwrap_or_else(|| "mp4".to_string());
        options.push(YouTubeFormatOption {
            id: prog.format_id.clone().unwrap_or_else(|| "prog".to_string()),
            label: format!("{}p Standard ({} · Direct)", h, ext.to_ascii_uppercase()),
            ext,
            height: Some(h),
            fps: prog.fps.map(|x| x.round() as u32),
            is_audio_only: false,
            needs_mux: false,
            approx_size_bytes: prog.filesize.or(prog.filesize_approx),
            video_url: prog.url.clone().unwrap_or_default(),
            audio_url: None,
            http_headers: prog.http_headers.clone(),
        });
    }

    // 3. Best Audio-Only option
    if let Some(audio) = paired_audio {
        let ext = audio.ext.clone().unwrap_or_else(|| "m4a".to_string());
        let bitrate = audio.abr.or(audio.tbr).map(|b| format!(" · {} kbps", b.round() as u32)).unwrap_or_default();
        options.push(YouTubeFormatOption {
            id: audio.format_id.clone().unwrap_or_else(|| "audio".to_string()),
            label: format!("Audio Only ({}{})", ext.to_ascii_uppercase(), bitrate),
            ext,
            height: None,
            fps: None,
            is_audio_only: true,
            needs_mux: false,
            approx_size_bytes: audio.filesize.or(audio.filesize_approx),
            video_url: audio.url.clone().unwrap_or_default(),
            audio_url: None,
            http_headers: audio.http_headers.clone(),
        });
    }

    if options.is_empty() {
        return Err(DownloadError::MediaTool(
            "No downloadable direct streams found for this YouTube video".to_string(),
        ));
    }

    Ok(YouTubeProbeResult {
        url: original_url.to_string(),
        title,
        uploader,
        duration_seconds,
        thumbnail: raw.thumbnail,
        ffmpeg_available,
        formats: options,
    })
}

fn is_audio_only(f: &RawYtDlpFormat) -> bool {
    let v = f.vcodec.as_deref().unwrap_or("none");
    let a = f.acodec.as_deref().unwrap_or("none");
    v == "none" && a != "none"
}

fn is_video_only(f: &RawYtDlpFormat) -> bool {
    let v = f.vcodec.as_deref().unwrap_or("none");
    let a = f.acodec.as_deref().unwrap_or("none");
    v != "none" && a == "none"
}

fn is_progressive(f: &RawYtDlpFormat) -> bool {
    let v = f.vcodec.as_deref().unwrap_or("none");
    let a = f.acodec.as_deref().unwrap_or("none");
    v != "none" && a != "none"
}

fn audio_score(f: &RawYtDlpFormat) -> f64 {
    let ext_bonus = if f.ext.as_deref() == Some("m4a") { 100.0 } else { 0.0 };
    ext_bonus + f.abr.or(f.tbr).unwrap_or(0.0)
}

fn video_score(f: &RawYtDlpFormat) -> f64 {
    let mp4_bonus = if f.ext.as_deref() == Some("mp4") { 5000.0 } else { 0.0 };
    let avc_bonus = if f
        .vcodec
        .as_deref()
        .map(|c| c.starts_with("avc1"))
        .unwrap_or(false)
    {
        1000.0
    } else {
        0.0
    };
    mp4_bonus + avc_bonus + f.fps.unwrap_or(30.0) * 10.0 + f.tbr.unwrap_or(0.0)
}

/// Losslessly muxes downloaded video + audio streams into `output_path` using `ffmpeg`.
pub async fn mux_video_and_audio(
    video_part: &Path,
    audio_part: &Path,
    output_path: &Path,
) -> Result<(), DownloadError> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        DownloadError::MediaTool(
            "ffmpeg is required to merge HD video and audio tracks, but was not found in PATH"
                .to_string(),
        )
    })?;

    // Attempt 1: Instant lossless stream copy
    let status = Command::new(&ffmpeg)
        .args(["-y", "-i"])
        .arg(video_part)
        .arg("-i")
        .arg(audio_part)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(output_path)
        .output()
        .await
        .map_err(|e| DownloadError::MediaTool(format!("Failed to run ffmpeg: {}", e)))?;

    if status.status.success() {
        return Ok(());
    }

    // Attempt 2: Video stream copy + AAC audio transcode (handles Opus-in-MP4 compatibility)
    let fallback = Command::new(&ffmpeg)
        .args(["-y", "-i"])
        .arg(video_part)
        .arg("-i")
        .arg(audio_part)
        .args(["-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart"])
        .arg(output_path)
        .output()
        .await
        .map_err(|e| DownloadError::MediaTool(format!("Failed to run ffmpeg fallback: {}", e)))?;

    if fallback.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&fallback.stderr);
        Err(DownloadError::MediaTool(format!(
            "ffmpeg muxing failed: {}",
            stderr.lines().last().unwrap_or("unknown error")
        )))
    }
}
