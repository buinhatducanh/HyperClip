// crates/hyperclip_ipc/src/cookies.rs
// Chrome cookie extraction via DPAPI + SQLite — ported from electron/services/chrome_cookies.ts

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cookies_dpapi::{decrypt_chrome_v10, decrypt_cookie_value, is_encrypted_v10};
use crate::cookies_sqlite::parse_cookies_file;
use crate::error::{HyperclipError, Result};

pub static ACTIVE_CHROME_PROFILE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// JSON format that Electron/CDP persists after successful Chrome login
/// (written to `_hyperclip_cookies.json`). Accessed without any NTFS lock
/// since Chrome only locks the SQLite file, not this JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedCookies {
    #[serde(rename = "PSID")]
    psid: Option<String>,
    #[serde(rename = "SAPISID")]
    sapisid: Option<String>,
    #[serde(rename = "PSIDCC")]
    psidcc: Option<String>,
    #[serde(rename = "PSIDTS")]
    psidts: Option<String>,
    socs: Option<String>,
    raw_cookies: Option<Vec<ExtractedCookie>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieExtractionResult {
    pub cookies: Vec<ExtractedCookie>,
    pub profile_name: String,
    pub domain: String,
    pub socs_value: Option<String>,
}

impl CookieExtractionResult {
    /// Build cookie string for Innertube/HTTP client.
    /// Format: "name1=value1; name2=value2; ..."
    /// If socs_value is provided, inject SOCS=CAI (override existing).
    pub fn build_cookie_string(&self) -> String {
        let mut parts: Vec<String> = self
            .cookies
            .iter()
            .filter(|c| {
                let skip_socs = self.socs_value.is_some() && c.name == "SOCS";
                !skip_socs && !c.value.is_empty()
            })
            .map(|c| format!("{}={}", c.name, c.value))
            .collect();

        // Force-inject SOCS=CAI if not present
        if !parts.iter().any(|p| p.starts_with("SOCS=")) {
            parts.push("SOCS=CAI".to_string());
        }

        parts.join("; ")
    }

    /// Build Netscape-format cookie file content for yt-dlp.
    /// Format: "domain\tTRUE\tpath\tsecure\texpiry\tname\tvalue"
    pub fn build_netscape_file(&self) -> String {
        let mut lines = vec!["# Netscape HTTP Cookie File".to_string()];
        let expiry = "2147483647"; // far future
        let mut has_socs = false;
        for c in &self.cookies {
            if c.value.is_empty() { continue; }
            let domain = if c.domain.starts_with('.') { c.domain.clone() } else { format!(".{}", c.domain) };
            if c.name == "SOCS" { has_socs = true; }
            lines.push(format!("{}\tTRUE\t/\tTRUE\t{}\t{}\t{}", domain, expiry, c.name, c.value));
        }
        // Force-inject SOCS=CAI
        if !has_socs {
            lines.push(format!(".youtube.com\tTRUE\t/\tTRUE\t{}\tSOCS\tCAI", expiry));
        }
        lines.push(String::new()); // trailing newline
        lines.join("\r\n")
    }
}

/// Try to read cookies from the persisted JSON file (fast path, no lock contention).
/// Electron/CDP writes `_hyperclip_cookies.json` after a successful Chrome login,
/// so this file is always available when the user has logged in via the app.
fn try_persisted_json(profile_dir: &Path) -> Option<CookieExtractionResult> {
    // Check locations where CDP/HyperClip writes the file:
    //   1. profile_dir/_hyperclip_cookies.json (HyperClip profiles 2-30)
    //   2. profile_dir/../_hyperclip_cookies.json (Default Chrome profile, parent = User Data)
    //   3. profile_dir/../../_hyperclip_cookies.json (chrome-profiles/profile-N/_hyperclip_cookies.json)
    let candidates = [
        profile_dir.join("_hyperclip_cookies.json"),
        profile_dir.join("..").join("_hyperclip_cookies.json"),
        profile_dir.join("..").join("..").join("_hyperclip_cookies.json"),
    ];

    for path in &candidates {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
        if !canonical.exists() {
            continue;
        }
        let content = match std::fs::read_to_string(&canonical) {
            Ok(c) if !c.is_empty() => c,
            _ => continue,
        };
        let persisted: PersistedCookies = match serde_json::from_str(&content) {
            Ok(p) => p,
            _ => continue,
        };

        // If raw_cookies is present, return it immediately (supports full cookie caching)
        if let Some(ref raw) = persisted.raw_cookies {
            if !raw.is_empty() {
                tracing::info!(
                    "[Cookies] Loaded {} raw cookies from persisted JSON at {:?}",
                    raw.len(),
                    canonical
                );
                return Some(CookieExtractionResult {
                    cookies: raw.clone(),
                    profile_name: "Default".to_string(),
                    domain: "youtube.com".to_string(),
                    socs_value: raw.iter().find(|c| c.name == "SOCS").map(|c| c.value.clone()),
                });
            }
        }

        let sapisid = persisted.sapisid.as_deref().unwrap_or("");
        let psid = persisted.psid.as_deref().unwrap_or("");

        // Need at least SAPISID + PSID for YouTube auth
        if sapisid.is_empty() || psid.is_empty() {
            tracing::warn!("[Cookies] Persisted JSON at {:?} missing SAPISID or PSID — skipping", canonical);
            continue;
        }

        let mut cookies = Vec::new();
        cookies.push(ExtractedCookie {
            name: "SAPISID".into(),
            value: sapisid.to_string(),
            domain: ".youtube.com".into(),
        });
        cookies.push(ExtractedCookie {
            name: "__Secure-1PSID".into(),
            value: psid.to_string(),
            domain: ".youtube.com".into(),
        });
        if let Some(ref v) = persisted.psidcc {
            if !v.is_empty() {
                cookies.push(ExtractedCookie {
                    name: "__Secure-1PSIDCC".into(),
                    value: v.clone(),
                    domain: ".youtube.com".into(),
                });
            }
        }
        if let Some(ref v) = persisted.psidts {
            if !v.is_empty() {
                cookies.push(ExtractedCookie {
                    name: "__Secure-1PSIDTS".into(),
                    value: v.clone(),
                    domain: ".youtube.com".into(),
                });
            }
        }

        let socs_value = persisted.socs.clone();

        tracing::info!(
            "[Cookies] Loaded {} cookies from persisted JSON at {:?}",
            cookies.len(),
            canonical
        );

        return Some(CookieExtractionResult {
            cookies,
            profile_name: "Default".to_string(),
            domain: "youtube.com".to_string(),
            socs_value,
        });
    }

    None
}

fn save_persisted_json(profile_dir: &Path, result: &CookieExtractionResult) -> std::io::Result<()> {
    let path = profile_dir.join("_hyperclip_cookies.json");
    
    // Find matching keys for the legacy fields in PersistedCookies
    let psid = result.cookies.iter().find(|c| c.name == "__Secure-1PSID" || c.name == "__Secure-3PSID").map(|c| c.value.clone());
    let sapisid = result.cookies.iter().find(|c| c.name == "SAPISID" || c.name == "__Secure-3PAPISID").map(|c| c.value.clone());
    let psidcc = result.cookies.iter().find(|c| c.name == "__Secure-1PSIDCC").map(|c| c.value.clone());
    let psidts = result.cookies.iter().find(|c| c.name == "__Secure-1PSIDTS").map(|c| c.value.clone());
    let socs = result.socs_value.clone();

    let persisted = PersistedCookies {
        psid,
        sapisid,
        psidcc,
        psidts,
        socs,
        raw_cookies: Some(result.cookies.clone()),
    };

    let s = serde_json::to_string_pretty(&persisted)?;
    std::fs::write(&path, s)?;
    tracing::info!("[Cookies] Saved cookies JSON to {:?}", path);
    Ok(())
}

fn extract_cookies_via_cdp(ws_url: &str) -> Result<Vec<ExtractedCookie>> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let url_str = ws_url.trim_start_matches("ws://");
    let (host, path) = match url_str.split_once('/') {
        Some((h, p)) => (h, format!("/{}", p)),
        None => (url_str, "/".to_string()),
    };

    let mut stream = TcpStream::connect_timeout(
        &host.parse().unwrap_or_else(|_| "127.0.0.1:9222".parse().unwrap()),
        std::time::Duration::from_millis(1000)
    ).map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to connect to CDP: {}", e)))?;

    stream.set_read_timeout(Some(std::time::Duration::from_millis(2000))).ok();
    stream.set_write_timeout(Some(std::time::Duration::from_millis(2000))).ok();

    let handshake_req = format!(
        "GET {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n",
        path, host
    );
    stream.write_all(handshake_req.as_bytes())
        .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to write handshake: {}", e)))?;
    stream.flush().ok();

    let mut resp_buf = Vec::new();
    let mut temp = [0u8; 1];
    while !resp_buf.windows(4).any(|w| w == b"\r\n\r\n") {
        if stream.read_exact(&mut temp).is_err() {
            break;
        }
        resp_buf.push(temp[0]);
        if resp_buf.len() > 8192 {
            return Err(HyperclipError::DatabaseCorruption("Handshake response too large".into()));
        }
    }

    let headers_str = String::from_utf8_lossy(&resp_buf);
    if !headers_str.contains(" 101 ") {
        return Err(HyperclipError::DatabaseCorruption(format!("Invalid handshake response: {}", headers_str)));
    }

    let cmd = serde_json::json!({
        "id": 1,
        "method": "Storage.getCookies"
    });
    let cmd_str = cmd.to_string();
    let payload = cmd_str.as_bytes();
    let length = payload.len();

    let mut frame = Vec::new();
    frame.push(0x81);
    if length <= 125 {
        frame.push(0x80 | (length as u8));
    } else if length <= 65535 {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(length as u16).to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(length as u64).to_be_bytes());
    }
    frame.extend_from_slice(&[0, 0, 0, 0]);
    frame.extend_from_slice(payload);

    stream.write_all(&frame)
        .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to send command: {}", e)))?;
    stream.flush().ok();

    let mut attempts = 0;
    loop {
        attempts += 1;
        if attempts > 50 {
            return Err(HyperclipError::DatabaseCorruption("Timed out waiting for Storage.getCookies response".into()));
        }

        let mut header = [0u8; 2];
        stream.read_exact(&mut header)
            .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read frame header: {}", e)))?;

        let is_masked = (header[1] & 0x80) != 0;
        let mut len = (header[1] & 0x7F) as u64;

        if len == 126 {
            let mut len_bytes = [0u8; 2];
            stream.read_exact(&mut len_bytes)
                .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read 16-bit length: {}", e)))?;
            len = u16::from_be_bytes(len_bytes) as u64;
        } else if len == 127 {
            let mut len_bytes = [0u8; 8];
            stream.read_exact(&mut len_bytes)
                .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read 64-bit length: {}", e)))?;
            len = u64::from_be_bytes(len_bytes);
        }

        let mask = if is_masked {
            let mut mask_bytes = [0u8; 4];
            stream.read_exact(&mut mask_bytes)
                .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read mask: {}", e)))?;
            Some(mask_bytes)
        } else {
            None
        };

        let mut payload_buf = vec![0u8; len as usize];
        stream.read_exact(&mut payload_buf)
            .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read payload: {}", e)))?;

        if let Some(mask_bytes) = mask {
            for (i, byte) in payload_buf.iter_mut().enumerate() {
                *byte ^= mask_bytes[i % 4];
            }
        }

        if let Ok(resp_val) = serde_json::from_slice::<serde_json::Value>(&payload_buf) {
            if resp_val["id"].as_i64() == Some(1) {
                let cookies_arr = resp_val["result"]["cookies"]
                    .as_array()
                    .ok_or_else(|| HyperclipError::DatabaseCorruption("Missing cookies array in result".into()))?;

                let mut extracted = Vec::new();
                for c in cookies_arr {
                    let name = c["name"].as_str().unwrap_or_default().to_string();
                    let value = c["value"].as_str().unwrap_or_default().to_string();
                    let domain = c["domain"].as_str().unwrap_or_default().to_string();

                    if !name.is_empty() && domain.contains("youtube.com") {
                        extracted.push(ExtractedCookie { name, value, domain });
                    }
                }
                return Ok(extracted);
            }
        }
    }
}

fn try_cdp_cookies() -> Result<Vec<ExtractedCookie>> {
    let resp = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .build()
        .get("http://127.0.0.1:9222/json/version")
        .timeout(std::time::Duration::from_millis(500))
        .call()
        .map_err(|e| HyperclipError::DatabaseCorruption(format!("CDP port check failed: {}", e)))?;

    let val: serde_json::Value = serde_json::from_reader(resp.into_reader())
        .map_err(|e| HyperclipError::DatabaseCorruption(format!("CDP json parse failed: {}", e)))?;

    let ws_url = val["webSocketDebuggerUrl"]
        .as_str()
        .ok_or_else(|| HyperclipError::DatabaseCorruption("webSocketDebuggerUrl missing".into()))?;

    extract_cookies_via_cdp(ws_url)
}

/// Read and decrypt the AES key from the Chrome `Local State` file.
/// On Windows, the key is encrypted using DPAPI and base64-encoded.
fn get_aes_key(profile_dir: &std::path::Path) -> Result<Option<Vec<u8>>> {
    #[cfg(target_os = "windows")]
    {
        // Search for Local State in parent directories first (which covers both Chrome and custom user data structures)
        let mut local_state_path = None;
        let mut current = profile_dir.to_path_buf();
        for _ in 0..3 {
            if let Some(parent) = current.parent() {
                let candidate = parent.join("Local State");
                if candidate.exists() {
                    local_state_path = Some(candidate);
                    break;
                }
                current = parent.to_path_buf();
            } else {
                break;
            }
        }

        // Fallback to standard Chrome Local State path
        let local_state_path = match local_state_path {
            Some(p) => p,
            None => {
                let fallback = get_chrome_user_data_dir().join("Local State");
                if fallback.exists() {
                    fallback
                } else {
                    tracing::warn!("[Cookies] Local State not found near profile dir {:?} or at fallback {:?}", profile_dir, fallback);
                    return Ok(None);
                }
            }
        };

        tracing::info!("[Cookies] Loading master key from Local State at {:?}", local_state_path);
        let content = std::fs::read_to_string(&local_state_path)
            .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to read Local State: {}", e)))?;

        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to parse Local State JSON: {}", e)))?;

        let encrypted_key_b64 = match json.pointer("/os_crypt/encrypted_key").and_then(|v| v.as_str()) {
            Some(k) => k,
            None => {
                tracing::warn!("[Cookies] os_crypt.encrypted_key not found in Local State");
                return Ok(None);
            }
        };

        use base64::{Engine as _, engine::general_purpose};
        let encrypted_key = general_purpose::STANDARD.decode(encrypted_key_b64)
            .map_err(|e| HyperclipError::DatabaseCorruption(format!("Failed to decode base64 key: {}", e)))?;

        if encrypted_key.len() < 5 || &encrypted_key[0..5] != b"DPAPI" {
            return Err(HyperclipError::DatabaseCorruption("Invalid encrypted key prefix in Local State".into()));
        }

        let encrypted_blob = &encrypted_key[5..];
        let decrypted_key = decrypt_chrome_v10(encrypted_blob)?;
        Ok(Some(decrypted_key))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

fn is_cookies_file_locked(profile_dir: &Path) -> bool {
    let new_path = profile_dir.join("Network").join("Cookies");
    let legacy_path = profile_dir.join("Cookies");
    let path = if new_path.exists() {
        new_path
    } else if legacy_path.exists() {
        legacy_path
    } else {
        return false;
    };

    #[cfg(target_os = "windows")]
    {
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .is_err()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Main extraction function: try fast path JSON first, then SQLite + DPAPI/AES-GCM.
pub fn extract_chrome_cookies(
    profile_dir: &std::path::Path,
    profile_name: &str,
) -> Result<CookieExtractionResult> {
    // 1. Fast path: read persisted JSON (no NTFS lock contention)
    if let Some(result) = try_persisted_json(profile_dir) {
        return Ok(result);
    }

    // 2. Try to query via CDP WebSocket if Chrome is active and matches this profile
    let should_try_cdp = {
        let active_matches = if let Ok(lock) = ACTIVE_CHROME_PROFILE.lock() {
            lock.as_deref() == Some(profile_name)
        } else {
            false
        };
        active_matches || is_cookies_file_locked(profile_dir)
    };

    if should_try_cdp {
        match try_cdp_cookies() {
            Ok(cookies) => {
                if !cookies.is_empty() {
                    let socs_value = cookies
                        .iter()
                        .find(|c| c.name == "SOCS")
                        .map(|c| c.value.clone());

                    let result = CookieExtractionResult {
                        cookies: cookies.clone(),
                        profile_name: profile_name.to_string(),
                        domain: "youtube.com".to_string(),
                        socs_value,
                    };

                    // Save to persisted JSON
                    save_persisted_json(profile_dir, &result).ok();

                    tracing::info!("[Cookies] Successfully extracted {} cookies via CDP and saved to JSON", cookies.len());
                    return Ok(result);
                }
            }
            Err(e) => {
                tracing::info!("[Cookies] CDP cookie extraction not available for profile {}: {:?}", profile_name, e);
            }
        }
    }

    // 3. Fallback to SQLite
    tracing::info!("[Cookies] Falling back to SQLite cookie extraction");
    let master_key = get_aes_key(profile_dir)?;

    let new_path = profile_dir.join("Network").join("Cookies");
    let legacy_path = profile_dir.join("Cookies");

    let res = if new_path.exists() {
        let raw = parse_cookies_file(&new_path, "youtube.com")?;
        build_result(raw, profile_name, master_key.as_deref(), profile_dir)
    } else if legacy_path.exists() {
        let raw = parse_cookies_file(&legacy_path, "youtube.com")?;
        build_result(raw, profile_name, master_key.as_deref(), profile_dir)
    } else {
        Err(HyperclipError::ProfileNotFound(
            format!("{:?} or {:?}", new_path, legacy_path)
        ))
    };

    res
}

fn build_result(
    raw_cookies: Vec<crate::cookies_sqlite::RawCookie>,
    profile_name: &str,
    master_key: Option<&[u8]>,
    profile_dir: &Path,
) -> Result<CookieExtractionResult> {
    let mut cookies = Vec::new();

    tracing::info!("[Cookies] build_result called for profile {}. Found {} raw cookies in SQLite", profile_name, raw_cookies.len());

    for (idx, cookie) in raw_cookies.iter().enumerate() {
        tracing::info!("[Cookies Debug] Cookie #{}: name='{}', domain='{}', val_len={}, enc_len={}",
            idx, cookie.name, cookie.domain,
            cookie.value.as_ref().map(|v| v.len()).unwrap_or(0),
            cookie.encrypted_value.as_ref().map(|v| v.len()).unwrap_or(0)
        );
    }

    for cookie in raw_cookies {
        let value = if let Some(encrypted) = &cookie.encrypted_value {
            if is_encrypted_v10(encrypted) {
                match decrypt_cookie_value(encrypted, master_key) {
                    Ok(decrypted) => String::from_utf8(decrypted).unwrap_or_default(),
                    Err(e) => {
                        tracing::warn!(
                            "[Cookies] Decryption failed for cookie '{}' in profile {}: {:?}",
                            cookie.name,
                            profile_name,
                            e
                        );
                        continue;
                    }
                }
            } else {
                cookie.value.unwrap_or_default()
            }
        } else {
            cookie.value.unwrap_or_default()
        };

        if !value.is_empty() {
            cookies.push(ExtractedCookie {
                name: cookie.name,
                value,
                domain: cookie.domain,
            });
        }
    }

    tracing::info!("[Cookies] Decrypted {} cookies for profile {}. Names: {:?}", 
        cookies.len(), profile_name, cookies.iter().map(|c| &c.name).collect::<Vec<_>>());

    let socs_value = cookies
        .iter()
        .find(|c| c.name == "SOCS")
        .map(|c| c.value.clone());

    let result = CookieExtractionResult {
        cookies,
        profile_name: profile_name.to_string(),
        domain: "youtube.com".to_string(),
        socs_value,
    };

    // Save to persisted JSON
    if !result.cookies.is_empty() {
        save_persisted_json(profile_dir, &result).ok();
    }

    Ok(result)
}

/// Get Chrome user data directory on Windows
pub fn get_chrome_user_data_dir() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            return std::path::PathBuf::from(local_app_data)
                .join("Google")
                .join("Chrome")
                .join("User Data");
        }
    }
    std::path::PathBuf::from(".")
}

/// Get default Chrome profile directory
pub fn get_default_profile_dir() -> std::path::PathBuf {
    get_chrome_user_data_dir().join("Default")
}
