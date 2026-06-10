// crates/hyperclip_ipc/src/cookies.rs
// Chrome cookie extraction via DPAPI + SQLite — ported from electron/services/chrome_cookies.ts

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cookies_dpapi::{decrypt_chrome_v10, is_encrypted_v10};
use crate::cookies_sqlite::parse_cookies_file;
use crate::error::{HyperclipError, Result};

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
    // Check both locations where CDP writes the file:
    //   1. profile_dir/_hyperclip_cookies.json (HyperClip profiles 2-30)
    //   2. profile_dir/../_hyperclip_cookies.json (Default Chrome profile, parent = User Data)
    let candidates = [
        profile_dir.join("_hyperclip_cookies.json"),
        profile_dir.join("..").join("_hyperclip_cookies.json"),
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

/// Main extraction function: try fast path JSON first, then SQLite + DPAPI.
pub fn extract_chrome_cookies(
    profile_dir: &std::path::Path,
    profile_name: &str,
) -> Result<CookieExtractionResult> {
    // Fast path: read persisted JSON (no NTFS lock contention)
    if let Some(result) = try_persisted_json(profile_dir) {
        return Ok(result);
    }

    tracing::info!("[Cookies] No persisted JSON found — falling back to SQLite");
    let new_path = profile_dir.join("Network").join("Cookies");
    let legacy_path = profile_dir.join("Cookies");

    if new_path.exists() {
        let raw = parse_cookies_file(&new_path, "youtube.com")?;
        build_result(raw, profile_name)
    } else if legacy_path.exists() {
        let raw = parse_cookies_file(&legacy_path, "youtube.com")?;
        build_result(raw, profile_name)
    } else {
        Err(HyperclipError::ProfileNotFound(
            format!("{:?} or {:?}", new_path, legacy_path)
        ))
    }
}

fn build_result(raw_cookies: Vec<crate::cookies_sqlite::RawCookie>, profile_name: &str) -> Result<CookieExtractionResult> {
    let mut cookies = Vec::new();

    for cookie in raw_cookies {
        let value = if let Some(encrypted) = &cookie.encrypted_value {
            if is_encrypted_v10(encrypted) {
                let decrypted = decrypt_chrome_v10(encrypted)?;
                String::from_utf8(decrypted).unwrap_or_default()
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

    let socs_value = cookies
        .iter()
        .find(|c| c.name == "SOCS")
        .map(|c| c.value.clone());

    Ok(CookieExtractionResult {
        cookies,
        profile_name: profile_name.to_string(),
        domain: "youtube.com".to_string(),
        socs_value,
    })
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
