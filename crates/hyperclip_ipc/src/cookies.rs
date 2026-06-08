// crates/hyperclip_ipc/src/cookies.rs
// Chrome cookie extraction via DPAPI + SQLite — ported from electron/services/chrome_cookies.ts

use serde::{Deserialize, Serialize};

use crate::cookies_dpapi::{decrypt_chrome_v10, is_encrypted_v10};
use crate::cookies_sqlite::parse_cookies_file;
use crate::error::{HyperclipError, Result};

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
}

/// Main extraction function: parse SQLite + decrypt v10 + build result.
pub fn extract_chrome_cookies(
    profile_dir: &std::path::Path,
    profile_name: &str,
) -> Result<CookieExtractionResult> {
    let cookies_db = profile_dir.join("Network/Cookies");
    if !cookies_db.exists() {
        // Also try legacy path (older Chrome versions)
        let legacy_db = profile_dir.join("Cookies");
        if !legacy_db.exists() {
            return Err(HyperclipError::ProfileNotFound(
                cookies_db.display().to_string()
            ));
        }
        // parse with legacy path
        let raw = parse_cookies_file(&legacy_db, "youtube.com")?;
        return build_result(raw, profile_name);
    }

    let raw = parse_cookies_file(&cookies_db, "youtube.com")?;
    build_result(raw, profile_name)
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
