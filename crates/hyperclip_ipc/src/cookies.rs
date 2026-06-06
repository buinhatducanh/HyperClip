// crates/hyperclip_ipc/src/cookies.rs
// Chrome cookie extraction via DPAPI + SQLite — ported from electron/services/chrome_cookies.ts

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeCookies {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub expires: i64,
}

#[derive(Debug, Clone)]
pub struct CookieExtractionResult {
    pub cookies: Vec<YouTubeCookies>,
    pub socs_forced: bool,
    pub session_id: String,
}

impl CookieExtractionResult {
    /// Build cookie string for HTTP requests
    /// Includes SOCS=CAI force-inject — EXACT from chrome_cookies.ts
    pub fn build_cookie_string(&self) -> String {
        let mut parts: Vec<String> = self
            .cookies
            .iter()
            .filter(|c| {
                c.name == "SOCS"
                    || c.name == "SAPISID"
                    || c.name.starts_with("__Secure-1PSID")
                    || c.name.starts_with("__Secure-3PSID")
            })
            .map(|c| format!("{}={}", c.name, c.value))
            .collect();

        if !parts.iter().any(|p| p.starts_with("SOCS=")) {
            parts.push("SOCS=CAI".to_string());
            return format!("{}; SOCS=CAI", parts.join("; "));
        }

        parts.join("; ")
    }
}

/// Chrome cookie extraction on Windows using DPAPI + SQLite
#[cfg(windows)]
pub fn extract_chrome_cookies(profile_dir: &std::path::Path) -> Result<CookieExtractionResult, String> {
    use std::process::Command;

    let db_path = profile_dir.join("Network/Cookies");
    if !db_path.exists() {
        return Err(format!("Cookie DB not found: {:?}", db_path));
    }

    // TODO: Full DPAPI + SQLite extraction
    // Chrome v80+ uses AES-256-GCM encryption:
    // 1. Read encrypted_key from Local State → DPAPI-unprotect → AES key
    // 2. Open Cookies SQLite DB → query encrypted values
    // 3. AES-256-GCM decrypt each cookie value
    // 4. Force SOCS=CAI if missing

    Ok(CookieExtractionResult {
        cookies: vec![],
        socs_forced: true,
        session_id: String::new(),
    })
}

#[cfg(not(windows))]
pub fn extract_chrome_cookies(_profile_dir: &std::path::Path) -> Result<CookieExtractionResult, String> {
    Ok(CookieExtractionResult {
        cookies: vec![],
        socs_forced: false,
        session_id: String::new(),
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
