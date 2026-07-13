// crates/hyperclip_ipc/src/youtube.rs
// yt-dlp spawn — ported from electron/services/youtube.ts
// Async streaming with progress emission + ffprobe metadata

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::download_progress::{parse_ytdlp_stderr, DownloadProgress};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YtdlpVideoInfo {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub duration: f64,
    pub channel_name: String,
    pub channel_id: String,
    pub upload_date: String,
    pub file_size: u64,
    pub resolution: String,
}

pub fn get_youtube_client_priority() -> String {
    let s_path = crate::store::get_settings_path();
    let s_store = crate::store::SettingsStore::load(&s_path);

    if let Some(arr) = s_store.settings.get("ytDlpClientPriority").and_then(|v| v.as_array()) {
        let clients: Vec<String> = arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !clients.is_empty() {
            return clients.join(",");
        }
    }

    if let Some(arr) = s_store.settings.get("yt_dlp_client_priority").and_then(|v| v.as_array()) {
        let clients: Vec<String> = arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !clients.is_empty() {
            return clients.join(",");
        }
    }

    // web is fast and reliable without VPN, android is fallback
    // Removed ios (slow extraction) and tv_embedded (unnecessary) to save ~1-2s
    "web,android".to_string()
}

#[derive(Debug, Clone)]
pub struct DownloadOptions {
    pub url: String,
    pub output_path: PathBuf,
    pub trim_start: String,
    pub trim_end: String,
    pub quality: u32,
    pub client_priority: Vec<String>,
    pub concurrent_fragments: u32,
    pub cookies_file: Option<PathBuf>,
    /// Number of parallel instances for multi-instance download (RAM-aware)
    pub multi_instance: u32,
    /// Enable simulated progress for better UX while yt-dlp is initializing
    pub simulated_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DownloadFailureType {
    Permanent,    // Private, deleted, region-locked - mark seen and don't retry
    Retryable,    // Network error, rate limit, timeout - retry with backoff
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub codec: String,
    pub fps: f64,
    /// Type of failure if download failed
    pub failure_type: Option<DownloadFailureType>,
    /// Seconds until retry is recommended (for retryable failures)
    pub retry_after_sec: Option<u64>,
}

fn get_ytdlp_proxy_args(s_store: &crate::store::SettingsStore) -> Option<String> {
    let enabled = s_store.settings.get("proxyEnabled")
        .or_else(|| s_store.settings.get("proxy_enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !enabled {
        return None;
    }

    let host = s_store.settings.get("proxyHost")
        .or_else(|| s_store.settings.get("proxy_host"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if host.is_empty() {
        return None;
    }

    let port = s_store.settings.get("proxyPort")
        .or_else(|| s_store.settings.get("proxy_port"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let username = s_store.settings.get("proxyUsername")
        .or_else(|| s_store.settings.get("proxy_username"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let password = s_store.settings.get("proxyPassword")
        .or_else(|| s_store.settings.get("proxy_password"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let protocol = if host.contains("://") { "" } else { "http://" };
    let auth = if !username.is_empty() && !password.is_empty() {
        format!("{}:{}@", username, password)
    } else if !username.is_empty() {
        format!("{}@", username)
    } else {
        "".to_string()
    };
    
    let port_str = if port > 0 { format!(":{}", port) } else { "".to_string() };
    Some(format!("{}{}{}{}", protocol, auth, host, port_str))
}

pub fn build_ytdlp_args(opts: &DownloadOptions) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--newline".to_string(),
        "-f".to_string(),
        format!("bestvideo[height<=?{}]+bestaudio/best[height<=?{}]/best", opts.quality, opts.quality),
        "-o".to_string(),
        opts.output_path.to_string_lossy().to_string(),
        "--concurrent-fragments".to_string(),
        opts.concurrent_fragments.to_string(),
        "--remux-video".to_string(),
        "mp4".to_string(),
        "--force-ipv4".to_string(),
        "--no-check-certificate".to_string(),
    ];

    let s_path = crate::store::get_settings_path();
    let s_store = crate::store::SettingsStore::load(&s_path);
    let bypass_vpn = s_store.settings.get("bypassVpn")
        .or_else(|| s_store.settings.get("bypass_vpn"))
        .or_else(|| s_store.settings.get("directRouteIp"))
        .or_else(|| s_store.settings.get("direct_route_ip"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if bypass_vpn {
        // Allow manual override of the source IP via settings.
        // Lets users bypass VPN when auto-detection picks the wrong NIC.
        let manual_ip = s_store.settings.get("sourceAddress")
            .or_else(|| s_store.settings.get("source_address"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s.parse::<std::net::Ipv4Addr>().is_ok());

        let bind_ip = manual_ip.or_else(get_physical_ip);

        if let Some(ip) = bind_ip {
            tracing::info!("[Youtube] Direct IP binding enabled (build_ytdlp_args). Binding to: {}", ip);
            args.push("--source-address".to_string());
            args.push(ip);
        } else {
            tracing::warn!("[Youtube] bypass_vpn=true but no source IP detected — set sourceAddress in settings to override");
        }
    }

    if let Some(proxy_url) = get_ytdlp_proxy_args(&s_store) {
        tracing::info!("[Youtube] Proxy configured (build_ytdlp_args). Using proxy: {}", proxy_url);
        args.push("--proxy".to_string());
        args.push(proxy_url);
    }

    let clients = opts.client_priority.join(",");
    if !clients.is_empty() {
        args.push("--extractor-args".to_string());
        args.push(format!("youtube:player_client={}", clients));
    }

    // Use bundled Node JS runtime if available to prevent deprecation warning
    args.push("--js-runtimes".to_string());
    args.push(find_node_runtime_arg());
    args.push("--remote-components".to_string());
    args.push("ejs:github".to_string());

    // Specify bundled ffmpeg location if available
    if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_dir);
    }

    if !opts.trim_start.is_empty() || !opts.trim_end.is_empty() {
        let end = if opts.trim_end.is_empty() { "99:00:00" } else { &opts.trim_end };
        args.push("--download-sections".to_string());
        if is_zero_timestamp(&opts.trim_start) {
            args.push(format!("*00:00:00-{}", end));
        } else {
            args.push(format!("*{}-{}", opts.trim_start, end));
        }
    }
    if let Some(cookies) = &opts.cookies_file {
        args.push("--cookies".to_string());
        args.push(cookies.to_string_lossy().to_string());
    }
    args.push(opts.url.clone());
    args
}

/// Emit download progress event via central emit_raw.
/// Called by the progress callback during streaming download.
pub fn emit_download_progress(workspace_id: &str, progress: &DownloadProgress) {
    let event = json!({
        "method": "download:progress-event",
        "params": {
            "workspace_id": workspace_id,
            "percent": progress.percent,
            "speed_mbps": progress.speed_mbps,
            "eta_sec": progress.eta_sec,
        }
    });
    crate::emit_raw(&serde_json::to_string(&event).unwrap_or_default());
}

pub fn get_ytdlp_cache_dir() -> std::path::PathBuf {
    let cache_dir = crate::store::get_data_dir().join(".cache").join("yt-dlp");
    let _ = std::fs::create_dir_all(&cache_dir);
    cache_dir
}

pub fn get_physical_ip() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // VPN / virtual NIC patterns in BOTH InterfaceAlias AND InterfaceDescription.
        // Covers NordVPN/NordLynx, Cloudflare WARP, WireGuard, Tailscale, ZeroTier,
        // OpenVPN/TAP, ExpressVPN, Mullvad, Surfshark, Windscribe, ProtonVPN,
        // Radmin VPN, Cisco, SoftEther, IPSec/PPTP/L2TP/SSTP, Hyper-V, VMWare,
        // VirtualBox, Docker/WSL bridge, generic TAP/WinTun/TunTap adapters.
        // ALSO matches generic names like "Local Area Connection*" because
        // some VPN clients don't set a brand-specific alias.
        let vpn_pattern = "warp|vpn|tap|tun|wireguard|tailscale|zerotier|virtualbox|vmware|pseudo\
                           |cf-|cloudflare|radmin|openvpn|cisco|softether|ipsec|pptp|l2tp|sstp\
                           |nord|express|mullvad|surfshark|windscribe|proton|ipvanish|hidemy\
                           |vypr|hotspot|opera|cyberghost|zenmate|fortinet|paloalto|sophos\
                           |hyper-v|hyperv|wintun|tuntap|wire|tun$|tap$";

        // Strategy: enumerate ALL adapters with their description + alias + IPs + metric.
        // Pick the FIRST one that:
        //   1. Is NOT a known VPN/virtual NIC (matches vpn_pattern in alias OR description)
        //   2. Has an IPv4 address that's NOT a tunnel range (10.x, 172.16-31.x, 169.254.x)
        //   3. Is "Up" status
        // Tie-break: lowest RouteMetric (physical NICs typically have lower metric than tunnel).
        let cmd_str = format!(
            "$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | \
                Where-Object {{ $_.Status -eq 'Up' }}; \
             foreach ($a in $adapters) {{ \
                 $ip = Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | \
                       Select-Object -First 1 -ExpandProperty IPAddress; \
                 if (-not $ip) {{ continue }}; \
                 $metric = (Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | \
                            Select-Object -First 1 -ExpandProperty RouteMetric); \
                 if (-not $metric) {{ $metric = 9999 }}; \
                 Write-Output (\"$($a.Name)|$($a.InterfaceDescription)|$ip|$metric\") \
             }}",
        );

        let output = Command::new("powershell")
            .args(&["-NoProfile", "-Command", &cmd_str])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                // Each line: alias|description|ip|metric
                #[derive(Debug)]
                struct Candidate {
                    alias: String,
                    desc: String,
                    ip: std::net::Ipv4Addr,
                    metric: u32,
                }

                let mut candidates: Vec<Candidate> = Vec::new();
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let parts: Vec<&str> = trimmed.split('|').collect();
                    if parts.len() < 4 {
                        continue;
                    }
                    let alias = parts[0].to_string();
                    let desc = parts[1].to_string();
                    let ip: std::net::Ipv4Addr = match parts[2].parse() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let metric: u32 = parts[3].parse().unwrap_or(9999);
                    candidates.push(Candidate { alias, desc, ip, metric });
                }

                // Filter out VPN/virtual adapters by alias AND description.
                candidates.retain(|c| {
                    let combined = format!("{} {}", c.alias.to_lowercase(), c.desc.to_lowercase());
                    !regex_match_simple(&combined, vpn_pattern)
                });

                // Filter out loopback / link-local / tunnel IP ranges.
                candidates.retain(|c| {
                    let octets = c.ip.octets();
                    if octets[0] == 127 || (octets[0] == 169 && octets[1] == 254) {
                        return false;
                    }
                    true
                });

                // Sort by metric ascending (physical NIC has lower metric).
                candidates.sort_by_key(|c| c.metric);

                // Prefer LAN (192.168.x.x), then 10.x.x.x (some home networks),
                // then public IPs, then anything else.
                let score = |ip: std::net::Ipv4Addr| -> u8 {
                    let o = ip.octets();
                    if o[0] == 192 && o[1] == 168 { return 0; }      // LAN — best
                    if o[0] == 10 { return 1; }                       // home router, often LAN
                    if o[0] == 172 && o[1] >= 16 && o[1] <= 31 { return 4; } // tunnel-ish
                    return 2;                                          // public
                };
                candidates.sort_by_key(|c| (score(c.ip), c.metric));

                if let Some(best) = candidates.first() {
                    tracing::info!(
                        "[Youtube] Physical IP detected: {} (alias='{}', desc='{}', metric={})",
                        best.ip, best.alias, best.desc, best.metric
                    );
                    return Some(best.ip.to_string());
                }

                tracing::warn!("[Youtube] No suitable physical IP found after filtering. Adapters seen but all matched VPN patterns or had tunnel-range IPs.");
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                tracing::warn!("[Youtube] get_physical_ip PowerShell failed: {}", stderr);
            }
        }
    }
    tracing::warn!("[Youtube] Could not detect physical IP — set sourceAddress manually in settings.json");
    None
}

#[cfg(target_os = "windows")]
/// Simple case-insensitive substring match against an alternation pattern.
fn regex_match_simple(input: &str, pattern: &str) -> bool {
    // pattern is "foo|bar|baz" — split on '|', check any substring match
    for alt in pattern.split('|') {
        let alt = alt.trim();
        if alt.is_empty() {
            continue;
        }
        // Use anchored check: pattern is treated as substring search, not regex.
        // Allow exact-token match for short patterns ending in $ (e.g., "tap$")
        if alt.ends_with('$') {
            let prefix = &alt[..alt.len() - 1];
            // Match the token boundary: end of string OR whitespace after
            if let Some(idx) = input.find(prefix) {
                let after = idx + prefix.len();
                if after == input.len() {
                    return true;
                }
                let next_char = input[after..].chars().next().unwrap_or(' ');
                if !next_char.is_alphanumeric() {
                    return true;
                }
            }
        } else {
            if input.contains(alt) {
                return true;
            }
        }
    }
    false
}

/// Async download with streaming progress via callback.

/// Spawns yt-dlp, reads stderr line-by-line, calls on_progress for each line.
pub fn download_video_streaming<F>(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
    actual_duration_sec: Option<u64>,
    quality: u32,
    concurrent_fragments: u32,
    mut on_progress: F,
) -> Result<DownloadResult, String>
where
    F: FnMut(DownloadProgress),
{
    let fmt = if quality <= 360 {
        "18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/best[height<=?360]/worst".to_string()
    } else {
        format!("bestvideo[height<=?{height}]+bestaudio/best[height<=?{height}]/worst", height = quality)
    };
    let clean_out = crate::store::clean_unc_path(output_path);
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());
    let ytdlp = find_ytdlp_path();
    let clients = get_youtube_client_priority();

    let s_path = crate::store::get_settings_path();
    let s_store = crate::store::SettingsStore::load(&s_path);
    let bypass_vpn = s_store.settings.get("bypassVpn")
        .or_else(|| s_store.settings.get("bypass_vpn"))
        .or_else(|| s_store.settings.get("directRouteIp"))
        .or_else(|| s_store.settings.get("direct_route_ip"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false); // Default to false so we respect VPN by default

    // Manual override — let users specify the NIC IP directly if auto-detection picks the wrong one.
    let manual_source_ip = s_store.settings.get("sourceAddress")
        .or_else(|| s_store.settings.get("source_address"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.parse::<std::net::Ipv4Addr>().is_ok());

    // Performance: --download-sections forces yt-dlp to stream via ffmpeg which is slower
    // than yt-dlp's native HTTP downloader with concurrent fragments. However, for videos
    // up to ~30 min the network savings from downloading only the needed portion
    // (often 50-70% smaller) outweigh the ffmpeg overhead. 360p LAN speed ~2-3 MB/s
    // means downloading 20MB full video takes 8s vs ~4s with download-sections.
    let use_download_sections = if let Some(dur) = actual_duration_sec {
        let long_video_threshold = 30 * 60; // 30 minutes
        trim_minutes > 0 && dur <= long_video_threshold
    } else {
        false
    };

    // Helper closure to execute yt-dlp with or without cookies
    let run_ytdlp_attempt = |use_cookies: bool, progress_cb: &mut F| -> Result<(std::process::ExitStatus, String), String> {
        let mut cmd = Command::new(&ytdlp);
        cmd.env("PYTHONUTF8", "1");
        cmd.args([
            "--js-runtimes", &find_node_runtime_arg(),
            "--remote-components", "ejs:github",
            "--no-check-certificates",
            "--force-ipv4",
        ]);

        if bypass_vpn {
            let bind_ip = manual_source_ip.clone().or_else(get_physical_ip);
            if let Some(ip) = bind_ip {
                tracing::info!("[Youtube] Direct IP binding enabled. Binding yt-dlp to local physical IP: {}", ip);
                cmd.args(["--source-address", &ip]);
            } else {
                tracing::warn!("[Youtube] bypass_vpn=true but no source IP detected — set sourceAddress in settings to override");
            }
        }

        if let Some(proxy_url) = get_ytdlp_proxy_args(&s_store) {
            tracing::info!("[Youtube] Proxy configured. Running yt-dlp with proxy: {}", proxy_url);
            cmd.args(["--proxy", &proxy_url]);
        }

        if !clients.is_empty() {
            cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
        }

        if use_cookies && !clean_cookies.is_empty() {
            cmd.args(["--cookies", &clean_cookies]);
        }

        cmd.args([
            "-f", &fmt,
            "--concurrent-fragments", &concurrent_fragments.to_string(),
            "--no-playlist",
            "--no-color",
            "--newline",
            "--remux-video", "mp4",
            "--socket-timeout", "30",
            "--retries", "3",
            "--cache-dir", &clean_cache,
            "-o", &clean_out,
        ]);

        if use_download_sections {
            let hours = trim_minutes / 60;
            let mins = trim_minutes % 60;
            let range_str = format!("*00:00:00-{:02}:{:02}:00", hours, mins);
            cmd.args(["--download-sections", &range_str]);
        }

        if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
            cmd.args(["--ffmpeg-location", &ffmpeg_dir]);
        }

        cmd.arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000);
        }

        tracing::info!("[Youtube] Spawning yt-dlp (cookies={}): {:?}", use_cookies, cmd);

        let mut child = cmd.spawn().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut reader = BufReader::new(stdout);

        let stderr_handle = std::thread::spawn(move || {
            let mut err_str = String::new();
            let mut reader = BufReader::new(stderr);
            let mut line_bytes = Vec::new();
            loop {
                line_bytes.clear();
                match reader.read_until(b'\n', &mut line_bytes) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        err_str.push_str(&line);
                    }
                    Err(_) => break,
                }
            }
            err_str
        });

        let mut line_bytes = Vec::new();
        loop {
            line_bytes.clear();
            match reader.read_until(b'\n', &mut line_bytes) {
                Ok(0) => break,
                Ok(_) => {
                    let line_str = String::from_utf8_lossy(&line_bytes);
                    let line_trimmed = line_str.trim_end_matches(|c| c == '\r' || c == '\n');
                    if let Some(progress) = parse_ytdlp_stderr(line_trimmed) {
                        progress_cb(progress);
                    }
                }
                Err(e) => {
                    tracing::warn!("stdout read warning: {}", e);
                }
            }
        }

        let status = child.wait().map_err(|e| format!("wait failed: {}", e))?;
        let stderr_output = stderr_handle.join().unwrap_or_else(|_| "Failed to join stderr thread".to_string());
        Ok((status, stderr_output))
    };

    // First attempt: try downloading anonymously (no cookies) so android client works at max speed
    let (mut status, mut stderr_output) = run_ytdlp_attempt(false, &mut on_progress)?;

    // Second attempt: if failed and cookies are available, check if we need to retry with cookies
    if !status.success() && !clean_cookies.is_empty() {
        let err_lower = stderr_output.to_lowercase();
        let needs_auth = err_lower.contains("confirm your age")
            || err_lower.contains("sign in to confirm")
            || err_lower.contains("sign in")
            || err_lower.contains("login")
            || err_lower.contains("private video")
            || err_lower.contains("login_required")
            || err_lower.contains("unauthorized")
            || err_lower.contains("format is not available")
            || err_lower.contains("forbidden")
            || err_lower.contains("error 403");

        if needs_auth {
            tracing::info!("[Youtube] Anonymous download failed or restricted. Retrying with cookies...");
            // Clean up any partial files
            let _ = std::fs::remove_file(&clean_out);
            let part_path = format!("{}.part", clean_out);
            let _ = std::fs::remove_file(&part_path);

            let retry_res = run_ytdlp_attempt(true, &mut on_progress)?;
            status = retry_res.0;
            stderr_output = retry_res.1;
        }
    }

    if !status.success() {
        tracing::error!("yt-dlp failed (exit={:?}). Stderr: {}", status.code(), stderr_output);
        return Err(format!("yt-dlp failed (exit={:?}): {}", status.code(), stderr_output));
    }

    let duration = match maybe_trim_file(output_path, trim_minutes) {
        Ok(dur) => dur,
        Err(e) => {
            tracing::warn!("Local trimming failed: {}", e);
            probe_media_file(output_path).0
        }
    };

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe to get real metadata
    let (_, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
        failure_type: None,
        retry_after_sec: None,
    })
}

/// ffprobe wrapper — extract duration, resolution, codec, fps from a media file.
pub fn probe_media_file(path: &str) -> (f64, u32, u32, String, f64) {
    let ffprobe = find_ffprobe_path();
    let mut cmd = Command::new(&ffprobe);
    let clean_path = crate::store::clean_unc_path(path);
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        &clean_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&s) {
                let duration = data["format"]["duration"].as_str()
                    .and_then(|d| d.parse::<f64>().ok())
                    .unwrap_or(0.0);

                // Find the first video stream
                let mut width = 0u32;
                let mut height = 0u32;
                let mut codec = "h264".to_string();
                let mut fps = 30.0;

                if let Some(streams) = data["streams"].as_array() {
                    for stream in streams {
                        if stream["codec_type"].as_str() == Some("video") {
                            width = stream["width"].as_u64().unwrap_or(0) as u32;
                            height = stream["height"].as_u64().unwrap_or(0) as u32;
                            codec = stream["codec_name"].as_str().unwrap_or("h264").to_string();

                            // Parse frame rate like "30/1" or "30000/1001"
                            let r_frame_rate = stream["r_frame_rate"].as_str().unwrap_or("30/1");
                            if let Some(slash) = r_frame_rate.find('/') {
                                let num: f64 = r_frame_rate[..slash].parse().unwrap_or(30.0);
                                let den: f64 = r_frame_rate[slash + 1..].parse().unwrap_or(1.0);
                                if den > 0.0 {
                                    fps = num / den;
                                }
                            }
                            break;
                        }
                    }
                }

                return (duration, width, height, codec, fps);
            }
            (0.0, 0, 0, "unknown".into(), 0.0)
        }
        _ => (0.0, 0, 0, "unknown".into(), 0.0),
    }
}

/// Sync download (blocking, no progress streaming) — kept for backward compat.
pub fn download_video(
    url: &str,
    output_path: &str,
    cookies_path: &str,
    trim_minutes: u32,
    actual_duration_sec: Option<u64>,
    quality: u32,
    concurrent_fragments: u32,
) -> Result<DownloadResult, String> {
    let fmt = if quality <= 360 {
        "18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/best[height<=?360]/worst".to_string()
    } else {
        format!("bestvideo[height<=?{height}]+bestaudio/best[height<=?{height}]/worst", height = quality)
    };
    let clean_out = crate::store::clean_unc_path(output_path);
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());
    let ytdlp = find_ytdlp_path();
    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.env("PYTHONUTF8", "1");
    cmd.args([
        "--js-runtimes", &find_node_runtime_arg(),
        "--remote-components", "ejs:github",
        "--no-check-certificates",
        "--force-ipv4",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "-f", &fmt,
        "--concurrent-fragments", &concurrent_fragments.to_string(),
        "--no-playlist",
        "--no-color",
        "--remux-video", "mp4",
        "--socket-timeout", "30",
        "--retries", "3",
        "--cache-dir", &clean_cache,
        "-o", &clean_out,
    ]);

    let mut use_download_sections = if let Some(dur) = actual_duration_sec {
        trim_minutes > 0 && (dur == 0 || dur > ((trim_minutes * 60) as u64 + 30))
    } else {
        trim_minutes > 0
    };

    // Optimization: bypass download sections if the entire video is to be downloaded
    if use_download_sections {
        let is_entire_video = actual_duration_sec
            .filter(|&d| d > 0) // duration=0 means unknown (Chrome detect), not "entire video"
            .map(|dur| dur <= (trim_minutes * 60) as u64)
            .unwrap_or(false);
        if is_entire_video {
            tracing::info!("[Youtube] Bypassing --download-sections because the entire video is to be downloaded (duration: {:?}s, trim: {}m).", actual_duration_sec, trim_minutes);
            use_download_sections = false;
        }
    }

    if use_download_sections {
        let hours = trim_minutes / 60;
        let mins = trim_minutes % 60;
        let range_str = format!("*00:00:00-{:02}:{:02}:00", hours, mins);
        cmd.args(["--download-sections", &range_str]);
    }

    if let Some(ffmpeg_dir) = find_ffmpeg_bin_dir() {
        cmd.args(["--ffmpeg-location", &ffmpeg_dir]);
    }

    cmd.arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().map_err(|e| format!("yt-dlp spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let duration = match maybe_trim_file(output_path, trim_minutes) {
        Ok(dur) => dur,
        Err(e) => {
            tracing::warn!("Local trimming failed: {}", e);
            parse_duration_from_stderr(&String::from_utf8_lossy(&output.stderr))
        }
    };

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Run ffprobe for real metadata
    let (_, width, height, codec, fps) = probe_media_file(output_path);

    Ok(DownloadResult {
        path: output_path.to_string(),
        duration,
        width,
        height,
        file_size,
        codec,
        fps,
        failure_type: None,
        retry_after_sec: None,
    })
}

/// Probe available formats without downloading
pub fn probe_formats(url: &str, cookies_path: &str) -> Result<Vec<u32>, String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.env("PYTHONUTF8", "1");
    cmd.args([
        "--js-runtimes", &node_runtime,
        "--remote-components", "ejs:github",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| e.to_string())?;

    let heights: Vec<u32> = data
        .get("formats")
        .and_then(|f| f.as_array())
        .map(|arr| {
            let mut set = std::collections::HashSet::new();
            for f in arr {
                if let Some(h) = f.get("height").and_then(|h| h.as_u64()) {
                    set.insert(h as u32);
                }
            }
            let mut heights: Vec<u32> = set.into_iter().collect();
            heights.sort();
            heights
        })
        .unwrap_or_default();

    Ok(heights)
}

/// Get video info without downloading
pub fn get_video_info(url: &str, cookies_path: &str) -> Result<YtdlpVideoInfo, String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.env("PYTHONUTF8", "1");
    cmd.args([
        "--js-runtimes", &node_runtime,
        "--remote-components", "ejs:github",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| e.to_string())?;

    Ok(YtdlpVideoInfo {
        id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        thumbnail: data.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        duration: data.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        channel_name: data.get("channel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        channel_id: data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        upload_date: data.get("upload_date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        file_size: data.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0),
        resolution: "".to_string(),
    })
}

/// Pre-check video availability before downloading (ported from electron/services/youtube.ts)
/// Returns (available: bool, error_reason: Option<String>, video_info: Option<YtdlpVideoInfo>)
pub fn probe_video_availability(url: &str, cookies_path: &str) -> Result<(bool, Option<String>, Option<YtdlpVideoInfo>), String> {
    let ytdlp = find_ytdlp_path();
    let node_runtime = find_node_runtime_arg();
    let clean_cookies = crate::store::clean_unc_path(cookies_path);
    let cache_dir = get_ytdlp_cache_dir();
    let clean_cache = crate::store::clean_unc_path(&cache_dir.to_string_lossy());

    let clients = get_youtube_client_priority();
    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--js-runtimes", &node_runtime,
        "--remote-components", "ejs:github",
    ]);
    if !clients.is_empty() {
        cmd.args(["--extractor-args", &format!("youtube:player_client={}", clients)]);
    }
    cmd.args([
        "--cookies", &clean_cookies,
        "--dump-json",
        "--no-download",
        "--socket-timeout", "30",
        "--cache-dir", &clean_cache,
        url,
    ]);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                // Check for private/deleted/unavailable
                let availability = data.get("availability").and_then(|v| v.as_str()).unwrap_or("public");
                let is_private = data.get("is_private").and_then(|v| v.as_bool()).unwrap_or(false);
                let age_limit = data.get("age_limit").and_then(|v| v.as_u64()).unwrap_or(0);
                let live_status = data.get("live_status").and_then(|v| v.as_str()).unwrap_or("not_live");

                let error_reason = if availability != "public" || is_private {
                    Some(format!("Video unavailable: {}", availability))
                } else if live_status == "is_live" {
                    Some("Live stream not supported".to_string())
                } else if age_limit > 0 {
                    Some("Age-restricted video".to_string())
                } else {
                    None
                };

                let info = YtdlpVideoInfo {
                    id: data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    thumbnail: data.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    duration: data.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    channel_name: data.get("channel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    channel_id: data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    upload_date: data.get("upload_date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    file_size: data.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0),
                    resolution: "".to_string(),
                };

                Ok((error_reason.is_none(), error_reason, Some(info)))
            } else {
                Ok((false, Some("Parse failed".to_string()), None))
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            tracing::warn!("[Probe] video unavailable or query failed: {}", stderr);
            Ok((false, Some(format!("Probe failed: {}", stderr)), None))
        }
        Err(e) => {
            tracing::warn!("[Probe] spawn failed: {}", e);
            Ok((false, Some(format!("Spawn failed: {}", e)), None))
        }
    }
}

/// Find ffprobe executable
fn find_ffprobe_path() -> String {
    // 1. Try bundled ffprobe in resources first
    let bundled = crate::store::get_resources_dir().join("ffmpeg/bin/ffprobe.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        return cleaned.replace('\\', "/");
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        candidates.push(format!("{}/scoop/shims/ffprobe.exe", userprofile.replace('\\', "/")));
    }
    candidates.push("ffprobe".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            let cleaned = crate::store::clean_unc_path(p);
            return cleaned.replace('\\', "/");
        }
    }
    "ffprobe".to_string()
}

/// Find yt-dlp executable
pub fn find_ytdlp_path() -> String {
    // 1. Try bundled yt-dlp in resources first
    let bundled = crate::store::get_resources_dir().join("yt-dlp/yt-dlp.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        return crate::store::clean_unc_path(&path_str);
    }

    // 2. Fallback candidates
    let mut candidates = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        let clean_appdata = appdata.replace('\\', "/");
        candidates.push(format!("{}/Python/Python312/Scripts/yt-dlp.exe", clean_appdata));
        candidates.push(format!("{}/Python/Python313/Scripts/yt-dlp.exe", clean_appdata));
        candidates.push(format!("{}/Python/Python314/Scripts/yt-dlp.exe", clean_appdata));
    }
    candidates.push("yt-dlp".to_string());

    for p in &candidates {
        if std::path::Path::new(p).exists() {
            let cleaned = crate::store::clean_unc_path(p);
            return cleaned;
        }
    }
    "yt-dlp".to_string()
}

/// Resolve the ffmpeg bin directory path to pass to yt-dlp.
fn find_ffmpeg_bin_dir() -> Option<String> {
    let path = crate::ffmpeg::get_ffmpeg_path();
    if path == "ffmpeg" {
        None
    } else {
        let parent = std::path::Path::new(&path).parent()?;
        let path_str = parent.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        Some(cleaned.replace('\\', "/"))
    }
}

/// Resolve the bundled Node.js path to pass to yt-dlp as JS runtime.
pub fn find_node_runtime_arg() -> String {
    let bundled = crate::store::get_resources_dir().join("node/node.exe");
    if bundled.exists() {
        let path_str = bundled.to_string_lossy().to_string();
        let cleaned = crate::store::clean_unc_path(&path_str);
        format!("node:{}", cleaned.replace('\\', "/"))
    } else {
        "node".to_string()
    }
}

/// Trims the downloaded file to the limit locally using ffmpeg copy.
fn maybe_trim_file(output_path: &str, trim_minutes: u32) -> Result<f64, String> {
    let (duration, _, _, _, _) = probe_media_file(output_path);
    let limit_sec = (trim_minutes * 60) as f64;
    tracing::info!("[Youtube] maybe_trim_file: duration={:.1}s, trim_minutes={}, limit_sec={:.1}s", duration, trim_minutes, limit_sec);

    if trim_minutes > 0 && duration > limit_sec {
        tracing::info!("[Youtube] Trimming file to {}s: {}", limit_sec, output_path);
        let temp_path = format!("{}.temp", output_path);
        if let Err(e) = std::fs::rename(output_path, &temp_path) {
            return Err(format!("Failed to rename file for trimming: {}", e));
        }

        let ffmpeg = crate::ffmpeg::get_ffmpeg_path();
        let clean_temp = crate::store::clean_unc_path(&temp_path);
        let clean_output = crate::store::clean_unc_path(output_path);

        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-y",
            "-i", &clean_temp,
            "-t", &format!("{}", trim_minutes * 60),
            "-c", "copy",
            &clean_output,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000);
        }

        match cmd.output() {
            Ok(out) if out.status.success() => {
                let _ = std::fs::remove_file(&temp_path);
                let trimmed_size = std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
                tracing::info!("[Youtube] Trim successful: {}s → {:.1} MB", limit_sec, trimmed_size as f64 / 1_048_576.0);
                Ok(limit_sec)
            }
            Ok(out) => {
                // Restore original file
                let _ = std::fs::rename(&temp_path, output_path);
                let err_msg = String::from_utf8_lossy(&out.stderr);
                tracing::warn!("[Youtube] FFmpeg trimming failed (exit={:?}). Stderr: {}", out.status.code(), err_msg);
                Err(format!("FFmpeg trimming failed (exit={:?}): {}", out.status.code(), err_msg))
            }
            Err(e) => {
                // Restore original file
                let _ = std::fs::rename(&temp_path, output_path);
                tracing::warn!("[Youtube] FFmpeg trim spawn failed: {}", e);
                Err(format!("FFmpeg trim spawn failed: {}", e))
            }
        }
    } else {
        Ok(duration)
    }
}

/// Parse duration from yt-dlp stderr output
fn parse_duration_from_stderr(stderr: &str) -> f64 {
    // Try "Duration: 00:05:30.50" format
    if let Some(pos) = stderr.find("Duration:") {
        let s = &stderr[pos..];
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() >= 3 {
            let h: f64 = parts[0]
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0.0);
            let m: f64 = parts[1].parse().unwrap_or(0.0);
            let sec_str = parts[2].split_whitespace().next().unwrap_or("0");
            let secs: f64 = sec_str.parse().unwrap_or(0.0);
            return h * 3600.0 + m * 60.0 + secs;
        }
    }
    // Try "[download]   0.5s of ..." format
    if let Some(pos) = stderr.find("[download]") {
        let s = &stderr[pos..];
        if let Some(s2) = s.split_whitespace().find(|w| w.ends_with("s") && w.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
            if let Ok(d) = s2.trim_end_matches('s').parse() {
                return d;
            }
        }
    }
    0.0
}

pub fn is_zero_timestamp(ts: &str) -> bool {
    let clean = ts.trim();
    if clean.is_empty() {
        return true;
    }
    if let Ok(val) = clean.parse::<f64>() {
        return val == 0.0;
    }
    let clean = clean.replace(':', "").replace('.', "").replace(',', "");
    if !clean.is_empty() && clean.chars().all(|c| c == '0') {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_ytdlp_args_tv_embedded() {
        let opts = DownloadOptions {
            url: "https://youtube.com/watch?v=test".into(),
            output_path: PathBuf::from("/tmp/test.mp4"),
            trim_start: "00:00:00".into(),
            trim_end: "00:10:00".into(),
            quality: 1080,
            client_priority: vec!["tv_embedded".into(), "web".into()],
            concurrent_fragments: 16,
            cookies_file: None,
            multi_instance: 1,
            simulated_progress: false,
        };
        let args = build_ytdlp_args(&opts);
        assert!(args.iter().any(|a| a.contains("tv_embedded")), "Should contain tv_embedded: {:?}", args);
        assert!(args.iter().any(|a| a.starts_with("*00:00:00-")), "Should have download-sections starting from 0: {:?}", args);
        assert!(args.iter().any(|a| a == "16"), "Should have 16 fragments: {:?}", args);
    }

    #[test]
    fn test_build_ytdlp_args_no_trim_when_empty() {
        let opts = DownloadOptions {
            url: "https://youtube.com/watch?v=test".into(),
            output_path: PathBuf::from("/tmp/test.mp4"),
            trim_start: "".into(),
            trim_end: "".into(),
            quality: 720,
            client_priority: vec!["tv_embedded".into()],
            concurrent_fragments: 8,
            cookies_file: None,
            multi_instance: 1,
            simulated_progress: false,
        };
        let args = build_ytdlp_args(&opts);
        assert!(!args.iter().any(|a| a.starts_with("*")), "No trim sections when empty: {:?}", args);
    }

    #[cfg(target_os = "windows")]
    mod vpn_filter_tests {
        use super::*;

        // regex_match_simple tests — VPN adapter detection logic
        const VPN_PATTERN: &str =
            "warp|vpn|tap|tun|wireguard|tailscale|zerotier|virtualbox|vmware|pseudo\
             |cf-|cloudflare|radmin|openvpn|cisco|softether|ipsec|pptp|l2tp|sstp\
             |nord|express|mullvad|surfshark|windscribe|proton|ipvanish|hidemy\
             |vypr|hotspot|opera|cyberghost|zenmate|fortinet|paloalto|sophos\
             |hyper-v|hyperv|wintun|tuntap|wire|tun$|tap$";

        #[test]
        fn test_nordlynx_adapter_detected() {
            // NordLynx WireGuard adapter — "NordLynx" contains "nord"
            assert!(regex_match_simple("nordlynx nordlynx", VPN_PATTERN));
        }

        #[test]
        fn test_nordvpn_tap_detected() {
            // NordVPN TAP adapter — "TAP-NordVPN Windows Adapter v9"
            assert!(regex_match_simple(
                "tap-nordvpn windows adapter v9 tap-nordvpn windows adapter v9",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_cloudflare_warp_detected() {
            assert!(regex_match_simple(
                "cloudflare warp cloudflare warp",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_wireguard_adapter_detected() {
            assert!(regex_match_simple(
                "wireguard tunnel wireguard tunnel",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_generic_tap_adapter_detected() {
            // Some VPNs use "TAP-Windows Adapter V9" or "TAP"
            assert!(regex_match_simple(
                "tap-windows adapter v9 tap-windows adapter v9",
                VPN_PATTERN
            ));
            // "tap" at end of input after space
            assert!(regex_match_simple(
                "local area connection tap",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_real_nic_not_filtered() {
            // Intel Wi-Fi adapter — should NOT match any VPN pattern
            assert!(!regex_match_simple(
                "wi-fi intel(r) wi-fi 6 ax201 160mhz",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_real_nic_realtek_not_filtered() {
            assert!(!regex_match_simple(
                "ethernet realtek pcie gbe family controller",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_hyper_v_detected() {
            assert!(regex_match_simple(
                "hyper-v ethernet adapter hyper-v ethernet adapter",
                VPN_PATTERN
            ));
        }

        #[test]
        fn test_get_physical_ip_returns_valid_ip() {
            let ip = get_physical_ip();
            // Should return Some IP on Windows — could be 192.168.x.x
            if let Some(ip_str) = ip {
                assert!(ip_str.parse::<std::net::Ipv4Addr>().is_ok(),
                    "get_physical_ip returned invalid IP: {}", ip_str);
                let octets: Vec<u8> = ip_str.split('.').map(|s| s.parse().unwrap()).collect();
                // Should NOT return loopback or link-local
                assert_ne!(octets[0], 127, "Should not return loopback");
                assert!(!(octets[0] == 169 && octets[1] == 254),
                    "Should not return link-local: {}", ip_str);
            }
        }

        #[test]
        fn test_vpn_tunnel_ip_is_skipped() {
            // 10.5.0.2 is a classic NordVPN/WireGuard tunnel IP — should be deprioritized
            let ip: std::net::Ipv4Addr = "10.5.0.2".parse().unwrap();
            let octets = ip.octets();
            // The IP is in 10.x.x.x range which is VPN tunnel
            assert_eq!(octets[0], 10, "NordVPN tunnel IP starts with 10");
        }
    }
}
