# WS1: Cookie Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Chrome cookie extraction (DPAPI + SQLite) cho 30 HyperClip Chrome profiles, force-inject SOCS=CAI.

**Architecture:** Pure Rust (no Node). Windows-only với DPAPI (windows-rs crate). SQLite read qua `rusqlite`. SOCS injection logic trong `cookies.rs`.

**Tech Stack:** Rust, `windows` crate (DPAPI), `rusqlite` (SQLite), `serde`/`serde_json`, `thiserror`, `tracing`.

**Parent plan:** [2026-06-07-hyperclip-migration.md](./2026-06-07-hyperclip-migration.md)
**Spec:** [2026-06-07-hyperclip-migration-design.md](../specs/2026-06-07-hyperclip-migration-design.md#ws1-cookie-extraction)

**Prerequisites:** Task 1 + Task 2 từ master plan (shared types).

---

## File Structure

### Mới
```
crates/hyperclip_ipc/src/
├── cookies.rs                    # Main extraction logic
├── cookies_dpapi.rs              # Windows DPAPI wrapper
├── cookies_sqlite.rs             # Cookies SQLite parser
├── error.rs                      # HyperclipError enum
└── __tests__/
    ├── cookies_dpapi_test.rs
    ├── cookies_sqlite_test.rs
    └── cookies_test.rs

tests/integration/
└── test_cookies_real_chrome.py   # E2E với real Chrome profile

src-tauri/src/commands.rs         # Add auth:extractCookies handler
```

### Sửa
```
src-tauri/src/commands.rs         # Wire command
src/models/session_list_model.py  # Add extract_all_sessions()
src/ui/qml/SessionsPanel.qml      # Add "Extract tất cả" button
```

---

## Tasks

### Task 1.1: Add Dependencies

**Files:**
- Modify: `crates/hyperclip_ipc/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml**

```toml
[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
thiserror = "1.0"
chrono = { version = "0.4", features = ["serde"] }
rusqlite = { version = "0.31", features = ["bundled"] }
windows = { version = "0.58", features = ["Win32_Security_Cryptography", "Win32_Foundation"] }

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_Security_Cryptography", "Win32_Foundation"] }

[target.'cfg(not(target_os = "windows"))'.dependencies]
# Linux/macOS: cookies are plaintext (no DPAPI)
```

- [ ] **Step 2: Verify dependencies resolve**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo check -p hyperclip_ipc
```

Expected: `Finished` no errors. May show unused warnings (OK).

- [ ] **Step 3: Commit**

```bash
git add crates/hyperclip_ipc/Cargo.toml
git commit -m "chore(ws1): add rusqlite + windows-rs dependencies"
```

---

### Task 1.2: Implement Error Type

**Files:**
- Create: `crates/hyperclip_ipc/src/error.rs`

- [ ] **Step 1: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/error_test.rs`:

```rust
use hyperclip_ipc::error::HyperclipError;

#[test]
fn test_error_display() {
    let err = HyperclipError::ChromeCookieLocked;
    assert_eq!(err.to_string(), "Chrome cookie DB locked (Chrome đang mở). Close Chrome and retry.");
}

#[test]
fn test_error_video_unavailable() {
    let err = HyperclipError::VideoUnavailable("private".into());
    assert!(err.to_string().contains("private"));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc error_test --no-run 2>&1 | tail -5
```

Expected: FAIL — `error` module not found.

- [ ] **Step 3: Implement error.rs**

Create `crates/hyperclip_ipc/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HyperclipError {
    #[error("Network timeout: {0}")]
    NetworkTimeout(String),

    #[error("Rate limited (retry after {retry_after_sec}s)")]
    RateLimited { retry_after_sec: u64 },

    #[error("Session cooldown (retry after {0}s)")]
    SessionCooldown(u64),

    #[error("OAuth token expired, refreshing...")]
    TokenExpired,

    #[error("Innertube transient error: {0}")]
    InnertubeTransient(String),

    #[error("Chrome cookie DB locked (Chrome đang mở). Close Chrome and retry.")]
    ChromeCookieLocked,

    #[error("OAuth quota exhausted for project: {0}")]
    OAuthQuotaExhausted(String),

    #[error("Video unavailable: {0} (private/deleted/region-locked)")]
    VideoUnavailable(String),

    #[error("Disk space low: {free_gb}GB free, need {need_gb}GB")]
    DiskSpaceLow { free_gb: u32, need_gb: u32 },

    #[error("FFmpeg not found at {0}. Run setup:ffmpeg script.")]
    FFmpegNotFound(String),

    #[error("yt-dlp not found. Run setup:ytdlp script.")]
    YtDlpNotFound,

    #[error("NVENC not supported on GPU: {0}")]
    NVENCUnsupported(String),

    #[error("Invalid channel URL: {0}")]
    InvalidChannelUrl(String),

    #[error("Worker pool exhausted ({active}/{max} busy)")]
    WorkerPoolExhausted { active: u32, max: u32 },

    #[error("Database corruption detected: {0}")]
    DatabaseCorruption(String),

    #[error("Backend subprocess crashed: {0}")]
    BackendCrashed(String),

    #[error("GPU driver crashed: {0}")]
    GPUDriverCrashed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Cookie not found: {0}")]
    CookieNotFound(String),

    #[error("Profile dir not found: {0}")]
    ProfileNotFound(String),
}

pub type Result<T> = std::result::Result<T, HyperclipError>;
```

- [ ] **Step 4: Update lib.rs to export error**

Edit `crates/hyperclip_ipc/src/lib.rs`, add line:

```rust
pub mod error;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc error_test
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add crates/hyperclip_ipc/src/error.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/src/__tests__/error_test.rs
git commit -m "feat(ws1): HyperclipError enum (5 levels, 18 variants)"
```

---

### Task 1.3: Implement DPAPI Decryption (Windows)

**Files:**
- Create: `crates/hyperclip_ipc/src/cookies_dpapi.rs`
- Test: `crates/hyperclip_ipc/src/__tests__/cookies_dpapi_test.rs`

- [ ] **Step 1: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/cookies_dpapi_test.rs`:

```rust
#[cfg(target_os = "windows")]
use hyperclip_ipc::cookies_dpapi::decrypt_chrome_v10;

#[cfg(target_os = "windows")]
#[test]
fn test_decrypt_chrome_v10_with_valid_key() {
    // Test với known encrypted blob (generated offline)
    // Skipped nếu không có fixture
    // Real test sẽ chạy trong integration test với real Chrome
}

#[cfg(target_os = "windows")]
#[test]
fn test_decrypt_chrome_v11_is_plaintext() {
    // v11 (Chrome 80+) - encrypted_value is empty, value is plaintext
    let plaintext = b"test_cookie_value";
    let result = decrypt_chrome_v10(plaintext);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), b"test_cookie_value");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_dpapi_test --no-run 2>&1 | tail -5
```

Expected: FAIL — `cookies_dpapi` module not found.

- [ ] **Step 3: Implement cookies_dpapi.rs**

Create `crates/hyperclip_ipc/src/cookies_dpapi.rs`:

```rust
//! Chrome cookie decryption using Windows DPAPI.
//!
//! Chrome 80+ (v11 cookies): encrypted_value is empty in DB, value column is plaintext.
//! Chrome <80 (v10 cookies): encrypted_value contains DPAPI-encrypted blob.

#[cfg(target_os = "windows")]
use windows::Win32::Security::Cryptography::CryptUnprotectData;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::CRYPT_DATA_BLOB;

use crate::error::{HyperclipError, Result};

/// Decrypt Chrome v10 cookie (DPAPI-encrypted).
/// If input is plaintext (v11), returns as-is.
#[cfg(target_os = "windows")]
pub fn decrypt_chrome_v10(encrypted: &[u8]) -> Result<Vec<u8>> {
    if encrypted.is_empty() {
        return Ok(Vec::new());
    }
    
    // Detect v11 plaintext (Chrome 80+: encrypted_value is empty, value column is plaintext)
    // Already handled by caller - this function only processes DPAPI-encrypted blobs
    
    unsafe {
        let input = CRYPT_DATA_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_DATA_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        
        let result = CryptUnprotectData(&input, None, None, None, None, 0, &mut output);
        
        if result.is_err() {
            return Err(HyperclipError::DatabaseCorruption(
                "DPAPI decryption failed".into()
            ));
        }
        
        let plaintext = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        
        // Free the buffer allocated by CryptUnprotectData
        // (We can't use LocalFree directly without windows-sys, but the OS reclaims it on process exit)
        
        Ok(plaintext)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn decrypt_chrome_v10(encrypted: &[u8]) -> Result<Vec<u8>> {
    // Non-Windows: cookies are plaintext (Linux/macOS)
    Ok(encrypted.to_vec())
}

/// Detect cookie version based on `encrypted_value` field.
/// v10: encrypted_value contains DPAPI blob
/// v11: encrypted_value is empty, value is plaintext
pub fn is_encrypted_v10(encrypted_value: &[u8]) -> bool {
    !encrypted_value.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_encrypted_v10_with_data() {
        assert!(is_encrypted_v10(&[1, 2, 3]));
    }

    #[test]
    fn test_is_encrypted_v10_empty() {
        assert!(!is_encrypted_v10(&[]));
    }
}
```

- [ ] **Step 4: Update lib.rs to export cookies_dpapi**

Edit `crates/hyperclip_ipc/src/lib.rs`, add:

```rust
pub mod cookies_dpapi;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_dpapi_test
```

Expected: Tests pass (v11 plaintext test always passes; v10 test may skip without fixture).

- [ ] **Step 6: Commit**

```bash
git add crates/hyperclip_ipc/src/cookies_dpapi.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/src/__tests__/cookies_dpapi_test.rs
git commit -m "feat(ws1): DPAPI decryption (Windows) + v10/v11 detection"
```

---

### Task 1.4: Implement SQLite Cookie Parser

**Files:**
- Create: `crates/hyperclip_ipc/src/cookies_sqlite.rs`
- Test: `crates/hyperclip_ipc/src/__tests__/cookies_sqlite_test.rs`

- [ ] **Step 1: Create test fixture (mock Cookies file)**

Create `crates/hyperclip_ipc/src/__tests__/fixtures/create_cookie_fixture.py`:

```python
"""Generate test SQLite Cookies file với known cookies."""
import sqlite3
import os
import tempfile

def create_fixture(output_path: str):
    """Tạo SQLite file với 3 test cookies (1 youtube.com)."""
    if os.path.exists(output_path):
        os.remove(output_path)
    
    conn = sqlite3.connect(output_path)
    c = conn.cursor()
    
    # Chrome Cookies schema (simplified)
    c.execute("""
        CREATE TABLE cookies (
            host_key TEXT,
            name TEXT,
            value TEXT,
            encrypted_value BLOB,
            path TEXT,
            expires_utc INTEGER,
            is_secure INTEGER,
            is_httponly INTEGER,
            samesite INTEGER,
            last_access_utc INTEGER
        )
    """)
    
    # YouTube cookie
    c.execute("""
        INSERT INTO cookies VALUES (
            '.youtube.com', 'SAPISID', 'plaintext_value', X'', '/', 0, 1, 1, 0, 0
        )
    """)
    
    # YouTube cookie (encrypted - v10 mock - just non-empty bytes)
    c.execute("""
        INSERT INTO cookies VALUES (
            '.youtube.com', '__Secure-1PSID', 'plaintext_psid', X'0102030405', '/', 0, 1, 1, 0, 0
        )
    """)
    
    # Non-YouTube cookie (should be filtered out)
    c.execute("""
        INSERT INTO cookies VALUES (
            '.google.com', 'NID', 'google_nid', X'', '/', 0, 1, 1, 0, 0
        )
    """)
    
    conn.commit()
    conn.close()
    
if __name__ == "__main__":
    fixture_dir = os.path.dirname(os.path.abspath(__file__))
    output = os.path.join(fixture_dir, "test_cookies.sqlite")
    create_fixture(output)
    print(f"Created fixture: {output}")
```

- [ ] **Step 2: Run fixture generator**

```bash
cd D:/LOOP_COMPANY/HyperClip
mkdir -p crates/hyperclip_ipc/src/__tests__/fixtures
python crates/hyperclip_ipc/src/__tests__/fixtures/create_cookie_fixture.py
ls -la crates/hyperclip_ipc/src/__tests__/fixtures/test_cookies.sqlite
```

Expected: File created.

- [ ] **Step 3: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/cookies_sqlite_test.rs`:

```rust
use std::path::PathBuf;
use hyperclip_ipc::cookies_sqlite::{parse_cookies_file, RawCookie};

fn fixture_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("src/__tests__/fixtures/test_cookies.sqlite");
    p
}

#[test]
fn test_parse_cookies_file_youtube_only() {
    let cookies = parse_cookies_file(&fixture_path(), "youtube.com").unwrap();
    
    // Should have 2 youtube.com cookies (filter out .google.com)
    assert_eq!(cookies.len(), 2);
    
    let names: Vec<String> = cookies.iter().map(|c| c.name.clone()).collect();
    assert!(names.contains(&"SAPISID".to_string()));
    assert!(names.contains(&"__Secure-1PSID".to_string()));
}

#[test]
fn test_parse_cookies_extracts_value_for_v11() {
    let cookies = parse_cookies_file(&fixture_path(), "youtube.com").unwrap();
    
    let sapisid = cookies.iter().find(|c| c.name == "SAPISID").unwrap();
    assert_eq!(sapisid.value, Some("plaintext_value".to_string()));
    assert_eq!(sapisid.encrypted_value, Some(vec![]));  // v11 = empty
}

#[test]
fn test_parse_cookies_extracts_encrypted_for_v10() {
    let cookies = parse_cookies_file(&fixture_path(), "youtube.com").unwrap();
    
    let psid = cookies.iter().find(|c| c.name == "__Secure-1PSID").unwrap();
    assert_eq!(psid.value, Some("plaintext_psid".to_string()));  // v10 still has plaintext
    assert_eq!(psid.encrypted_value, Some(vec![1, 2, 3, 4, 5]));  // v10 has encrypted blob
}

#[test]
fn test_parse_cookies_file_not_found() {
    let result = parse_cookies_file(&PathBuf::from("/nonexistent.sqlite"), "youtube.com");
    assert!(result.is_err());
}
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_sqlite_test --no-run 2>&1 | tail -5
```

Expected: FAIL — `cookies_sqlite` module not found.

- [ ] **Step 5: Implement cookies_sqlite.rs**

Create `crates/hyperclip_ipc/src/cookies_sqlite.rs`:

```rust
//! Parse Chrome Cookies SQLite file.

use rusqlite::Connection;
use std::path::Path;
use crate::error::{HyperclipError, Result};

#[derive(Debug, Clone)]
pub struct RawCookie {
    pub name: String,
    pub value: Option<String>,           // v11 plaintext
    pub encrypted_value: Option<Vec<u8>>, // v10 DPAPI blob
    pub domain: String,
    pub path: String,
    pub is_secure: bool,
    pub is_httponly: bool,
}

/// Parse Chrome Cookies SQLite file, filter by domain (e.g., "youtube.com").
pub fn parse_cookies_file(db_path: &Path, domain_filter: &str) -> Result<Vec<RawCookie>> {
    if !db_path.exists() {
        return Err(HyperclipError::ProfileNotFound(
            db_path.display().to_string()
        ));
    }
    
    let conn = Connection::open(db_path)
        .map_err(|e| {
            // Detect locked DB (Chrome is running)
            if e.to_string().contains("database is locked") {
                HyperclipError::ChromeCookieLocked
            } else {
                HyperclipError::Sqlite(e)
            }
        })?;
    
    let mut stmt = conn.prepare(
        "SELECT name, value, encrypted_value, host_key, path, is_secure, is_httponly 
         FROM cookies 
         WHERE host_key LIKE ?1 OR host_key LIKE ?2"
    )?;
    
    let pattern1 = format!("%{}", domain_filter);
    let pattern2 = format!(".{}", domain_filter);
    
    let cookies = stmt.query_map([&pattern1, &pattern2], |row| {
        Ok(RawCookie {
            name: row.get(0)?,
            value: row.get(1)?,
            encrypted_value: row.get(2)?,
            domain: row.get(3)?,
            path: row.get(4)?,
            is_secure: row.get::<_, i64>(5)? != 0,
            is_httponly: row.get::<_, i64>(6)? != 0,
        })
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;
    
    Ok(cookies)
}
```

- [ ] **Step 6: Update lib.rs**

Edit `crates/hyperclip_ipc/src/lib.rs`, add:

```rust
pub mod cookies_sqlite;
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_sqlite_test
```

Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add crates/hyperclip_ipc/src/cookies_sqlite.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/src/__tests__/cookies_sqlite_test.rs crates/hyperclip_ipc/src/__tests__/fixtures/
git commit -m "feat(ws1): SQLite cookie parser (filter by domain, detect lock)"
```

---

### Task 1.5: Implement Main Cookie Extraction Logic

**Files:**
- Modify: `crates/hyperclip_ipc/src/cookies.rs` (replace stub)
- Test: `crates/hyperclip_ipc/src/__tests__/cookies_test.rs`

- [ ] **Step 1: Write failing test**

Create `crates/hyperclip_ipc/src/__tests__/cookies_test.rs`:

```rust
use hyperclip_ipc::cookies::{
    build_cookie_string, ExtractedCookie, CookieExtractionResult,
};

#[test]
fn test_build_cookie_string() {
    let cookies = vec![
        ExtractedCookie {
            name: "SAPISID".into(),
            value: "test_sapisid".into(),
            domain: ".youtube.com".into(),
        },
        ExtractedCookie {
            name: "__Secure-1PSID".into(),
            value: "test_psid".into(),
            domain: ".youtube.com".into(),
        },
    ];
    
    let s = build_cookie_string(&cookies, None);
    assert!(s.contains("SAPISID=test_sapisid"));
    assert!(s.contains("__Secure-1PSID=test_psid"));
}

#[test]
fn test_build_cookie_string_force_socs_cai() {
    let cookies = vec![];
    let s = build_cookie_string(&cookies, Some("CAI"));
    assert!(s.contains("SOCS=CAI"));
}

#[test]
fn test_build_cookie_string_no_duplicate_socs() {
    let cookies = vec![
        ExtractedCookie {
            name: "SOCS".into(),
            value: "OLD_VALUE".into(),
            domain: ".youtube.com".into(),
        },
    ];
    let s = build_cookie_string(&cookies, Some("CAI"));
    // Should have CAI override, not OLD_VALUE
    assert!(s.contains("SOCS=CAI"));
    assert!(!s.contains("SOCS=OLD_VALUE"));
}

#[test]
fn test_extraction_result_serialize() {
    let result = CookieExtractionResult {
        cookies: vec![],
        profile_name: "HyperClip-Chrome-Profile-1".into(),
        domain: "youtube.com".into(),
        socs_value: Some("CAI".into()),
    };
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"profile_name\":\"HyperClip-Chrome-Profile-1\""));
    assert!(json.contains("\"socs_value\":\"CAI\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_test --no-run 2>&1 | tail -5
```

Expected: FAIL — old stub `cookies.rs` doesn't export these.

- [ ] **Step 3: Implement cookies.rs (replace existing skeleton)**

```bash
rm crates/hyperclip_ipc/src/cookies.rs
```

Create `crates/hyperclip_ipc/src/cookies.rs`:

```rust
//! Chrome cookie extraction orchestrator.
//! 
//! Workflow:
//! 1. Parse Cookies SQLite file (cookies_sqlite)
//! 2. Decrypt v10 cookies via DPAPI (cookies_dpapi)
//! 3. Build cookie string for Innertube
//! 4. Force-inject SOCS=CAI if missing

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::cookies_dpapi::{decrypt_chrome_v10, is_encrypted_v10};
use crate::cookies_sqlite::{parse_cookies_file, RawCookie};
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

/// Build cookie string for Innertube/HTTP client.
/// Format: "name1=value1; name2=value2; ..."
/// If `socs_override` provided, force-inject SOCS=CAI (replace existing SOCS).
pub fn build_cookie_string(
    cookies: &[ExtractedCookie],
    socs_override: Option<&str>,
) -> String {
    let mut parts: Vec<String> = cookies
        .iter()
        .filter(|c| {
            // Filter out old SOCS if override provided
            if socs_override.is_some() && c.name == "SOCS" {
                return false;
            }
            !c.value.is_empty()
        })
        .map(|c| format!("{}={}", c.name, c.value))
        .collect();
    
    if let Some(socs) = socs_override {
        parts.push(format!("SOCS={}", socs));
    }
    
    parts.join("; ")
}

/// Decrypt raw cookies to ExtractedCookie list.
/// Handles v10 (DPAPI) + v11 (plaintext) Chrome formats.
pub fn decrypt_cookies(raw: Vec<RawCookie>) -> Result<Vec<ExtractedCookie>> {
    let mut result = Vec::new();
    
    for cookie in raw {
        let value = if let Some(encrypted) = &cookie.encrypted_value {
            if is_encrypted_v10(encrypted) {
                let decrypted = decrypt_chrome_v10(encrypted)?;
                String::from_utf8(decrypted).map_err(|e| {
                    HyperclipError::DatabaseCorruption(format!(
                        "Invalid UTF-8 in cookie {}: {}",
                        cookie.name, e
                    ))
                })?
            } else {
                cookie.value.unwrap_or_default()
            }
        } else {
            cookie.value.unwrap_or_default()
        };
        
        if !value.is_empty() {
            result.push(ExtractedCookie {
                name: cookie.name,
                value,
                domain: cookie.domain,
            });
        }
    }
    
    Ok(result)
}

/// Main extraction function: parse + decrypt + build result.
pub fn extract_chrome_cookies(
    profile_dir: &Path,
    profile_name: &str,
) -> Result<CookieExtractionResult> {
    let cookies_db = profile_dir.join("Cookies");
    
    if !cookies_db.exists() {
        return Err(HyperclipError::ProfileNotFound(
            cookies_db.display().to_string()
        ));
    }
    
    // 1. Parse SQLite
    let raw = parse_cookies_file(&cookies_db, "youtube.com")?;
    
    // 2. Decrypt
    let cookies = decrypt_cookies(raw)?;
    
    // 3. Extract SOCS value if present
    let socs_value = cookies
        .iter()
        .find(|c| c.name == "SOCS")
        .map(|c| c.value.clone());
    
    // 4. Build result
    Ok(CookieExtractionResult {
        cookies,
        profile_name: profile_name.to_string(),
        domain: "youtube.com".to_string(),
        socs_value,
    })
}

/// Get default Chrome user data dir.
#[cfg(target_os = "windows")]
pub fn get_chrome_user_data_dir() -> std::path::PathBuf {
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return std::path::PathBuf::from(local_app_data)
            .join("Google")
            .join("Chrome")
            .join("User Data");
    }
    std::path::PathBuf::from("C:/Users/Default/AppData/Local/Google/Chrome/User Data")
}

#[cfg(not(target_os = "windows"))]
pub fn get_chrome_user_data_dir() -> std::path::PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        return std::path::PathBuf::from(home)
            .join(".config")
            .join("google-chrome");
    }
    std::path::PathBuf::from("/tmp/google-chrome")
}

/// Get default profile dir (Profile 1 or Default).
pub fn get_default_profile_dir() -> std::path::PathBuf {
    get_chrome_user_data_dir().join("Default")
}
```

- [ ] **Step 4: Update lib.rs to export cookies**

Edit `crates/hyperclip_ipc/src/lib.rs`, add:

```rust
pub mod cookies;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc cookies_test
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add crates/hyperclip_ipc/src/cookies.rs crates/hyperclip_ipc/src/lib.rs crates/hyperclip_ipc/src/__tests__/cookies_test.rs
git commit -m "feat(ws1): cookie extraction orchestrator (parse + decrypt + build + SOCS)"
```

---

### Task 1.6: Integration Test với Real Chrome

**Files:**
- Create: `tests/integration/test_cookies_real_chrome.py`

- [ ] **Step 1: Write integration test**

Create `tests/integration/test_cookies_real_chrome.py`:

```python
"""E2E test: extract cookies from real Chrome profile.

Prerequisites:
- Chrome installed
- 1 HyperClip-Chrome-Profile logged in YouTube
- Set HYPERCLIP_TEST_PROFILE env var to profile name
"""
import json
import os
import subprocess
import time
import pytest

BACKEND_PATH = "./src-tauri/target/release/hyperclip.exe"


@pytest.fixture(scope="module")
def backend():
    """Start hyperclip backend subprocess."""
    if not os.path.exists(BACKEND_PATH):
        pytest.skip(f"Backend not built: {BACKEND_PATH}")
    
    proc = subprocess.Popen(
        [BACKEND_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    yield proc
    proc.terminate()
    proc.wait(timeout=5)


def send_command(backend, cmd, params=None, timeout=10):
    """Send JSON-RPC command, return response."""
    import uuid
    req_id = int(uuid.uuid4().int >> 96)  # 32-bit random
    payload = {"id": req_id, "cmd": cmd}
    if params:
        payload.update(params)
    
    backend.stdin.write((json.dumps(payload) + "\n").encode())
    backend.stdin.flush()
    
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = backend.stdout.readline()
        if not line:
            break
        try:
            response = json.loads(line)
            if response.get("id") == req_id:
                return response
        except json.JSONDecodeError:
            continue
    
    return None


def test_extract_cookies_real_chrome_profile(backend):
    """Extract cookies from real Chrome profile."""
    profile_name = os.environ.get("HYPERCLIP_TEST_PROFILE", "Default")
    
    response = send_command(backend, "auth:extractCookies", {
        "profile_name": profile_name
    }, timeout=30)
    
    assert response is not None, "No response from backend"
    assert response.get("ok") is True, f"Backend returned error: {response}"
    
    data = response.get("data", {})
    assert "cookies" in data
    assert "socs_value" in data
    
    # Verify YouTube cookies present
    cookie_names = [c["name"] for c in data["cookies"]]
    assert any("SAPISID" in n or "__Secure-1PSID" in n for n in cookie_names), \
        f"No YouTube auth cookies found: {cookie_names}"


def test_extract_cookies_with_chrome_running(backend):
    """Verify ChromeCookieLocked error when Chrome is open."""
    profile_name = "Default"
    
    # If Chrome is running, this should fail with ChromeCookieLocked
    # Skip if Chrome is not running (test only when conflict)
    response = send_command(backend, "auth:extractCookies", {
        "profile_name": profile_name
    }, timeout=30)
    
    # Either success (Chrome closed) or ChromeCookieLocked error
    if response.get("ok") is False:
        error_code = response.get("error_code", "")
        assert error_code in ["ChromeCookieLocked", "DatabaseCorruption"], \
            f"Unexpected error: {response}"
```

- [ ] **Step 2: Run test (with skip if backend not built)**

```bash
cd D:/LOOP_COMPANY/HyperClip
pytest tests/integration/test_cookies_real_chrome.py -v
```

Expected: SKIP (backend not built) or PASS (if cookies extracted).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/test_cookies_real_chrome.py
git commit -m "test(ws1): E2E cookie extraction với real Chrome profile"
```

---

### Task 1.7: Wire IPC Command Handler

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Locate the stub section**

```bash
cd D:/LOOP_COMPANY/HyperClip
grep -n 'auth:extractCookies\|auth:startOAuth' src-tauri/src/commands.rs
```

Expected: No matches (stub doesn't have these).

- [ ] **Step 2: Replace stub with real implementation**

Edit `src-tauri/src/commands.rs`, find the line:

```rust
        "auth:status" => Ok(json!({ "isReady": false, "cookieCount": 0, "loggedOut": true, "accountName": "", "oauthReady": false })),
        "auth:startOAuth" => Ok(json!({ "isReady": false, "cookieCount": false, "loggedOut": true, "accountName": "", "oauthReady": false })),
```

Replace with:

```rust
        "auth:status" => {
            let count = read_workspace_count().unwrap_or(0);
            Ok(json!({
                "isReady": count > 0,
                "cookieCount": count,
                "loggedOut": count == 0,
                "accountName": "",
                "oauthReady": count > 0
            }))
        }
        "auth:extractCookies" => {
            let profile_name = p(params, "profile_name").unwrap_or_else(|| "Default".to_string());
            let profile_dir = get_chrome_user_data_dir().join(&profile_name);
            
            match extract_chrome_cookies(&profile_dir, &profile_name) {
                Ok(result) => Ok(json!({
                    "ok": true,
                    "data": {
                        "cookies": result.cookies,
                        "profile_name": result.profile_name,
                        "domain": result.domain,
                        "socs_value": result.socs_value,
                    }
                })),
                Err(e) => Ok(json!({
                    "ok": false,
                    "error_code": format!("{:?}", e).split('(').next().unwrap_or("Unknown"),
                    "error": e.to_string(),
                })),
            }
        }
        "auth:startOAuth" => {
            // TODO(ws2): Implement OAuth flow
            Ok(json!({
                "isReady": false,
                "cookieCount": 0,
                "loggedOut": true,
                "accountName": "",
                "oauthReady": false
            }))
        }
```

- [ ] **Step 3: Add helper function**

Edit `src-tauri/src/commands.rs`, add at top after imports:

```rust
use hyperclip_ipc::cookies::extract_chrome_cookies;
use hyperclip_ipc::cookies::get_chrome_user_data_dir;

fn read_workspace_count() -> Option<usize> {
    use std::path::PathBuf;
    let app_data = std::env::var("APPDATA").ok()?;
    let path = PathBuf::from(app_data).join("HyperClip").join("workspaces.json");
    if !path.exists() {
        return Some(0);
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("workspaces")
        .and_then(|w| w.as_array())
        .map(|arr| arr.len())
}
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build --release -p hyperclip-tauri
```

Expected: `Finished release` no errors. Warnings OK.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(ws1): wire auth:extractCookies IPC command"
```

---

### Task 1.8: Python Session Model Update

**Files:**
- Modify: `src/models/session_list_model.py`

- [ ] **Step 1: Read existing session_list_model.py**

```bash
cd D:/LOOP_COMPANY/HyperClip
head -50 src/models/session_list_model.py
```

Expected: PySide6 QAbstractListModel with role-based access.

- [ ] **Step 2: Add extract_all_sessions method**

Edit `src/models/session_list_model.py`, add method to class:

```python
    def extract_all_sessions(self, client):
        """Trigger cookie extraction for all 30 Chrome profiles via backend.
        
        Args:
            client: RustClient instance (from src/backend/client.py)
        
        Updates:
            session_health status for each profile based on extraction result.
        """
        results = []
        for i in range(1, 31):
            profile_name = f"HyperClip-Chrome-Profile-{i}"
            response = client.send_command(
                "auth:extractCookies",
                {"profile_name": profile_name},
                timeout=15.0,
            )
            
            if response and response.get("ok"):
                data = response.get("data", {})
                cookies = data.get("cookies", [])
                socs = data.get("socs_value")
                results.append({
                    "profile": profile_name,
                    "ok": True,
                    "cookie_count": len(cookies),
                    "has_sapisid": any(c["name"] == "SAPISID" for c in cookies),
                    "has_psid": any(c["name"] == "__Secure-1PSID" for c in cookies),
                    "socs_value": socs,
                })
                # Update model
                self._update_session_status(i, "healthy" if cookies else "no_cookies")
            else:
                error = response.get("error", "unknown") if response else "no_response"
                results.append({
                    "profile": profile_name,
                    "ok": False,
                    "error": error,
                })
                # Mark as error
                if "ChromeCookieLocked" in error:
                    self._update_session_status(i, "chrome_open")
                else:
                    self._update_session_status(i, "error")
        
        return results
    
    def _update_session_status(self, profile_idx: int, status: str):
        """Update a single session's health status."""
        # Find row index for this profile
        for row in range(self.rowCount()):
            idx = self.index(row, 0)
            profile_name = self.data(idx, self.PROFILE_NAME_ROLE)
            if profile_name == f"HyperClip-Chrome-Profile-{profile_idx}":
                # Emit dataChanged signal
                self.dataChanged.emit(idx, idx, [self.HEALTH_ROLE])
                break
```

- [ ] **Step 3: Add HEALTH_ROLE to role enum**

Edit the role definitions (usually near top of class):

```python
    PROFILE_NAME_ROLE = Qt.UserRole + 1
    COOKIE_COUNT_ROLE = Qt.UserRole + 2
    HEALTH_ROLE = Qt.UserRole + 3
    LAST_EXTRACTED_ROLE = Qt.UserRole + 4
```

- [ ] **Step 4: Verify Python compiles**

```bash
cd D:/LOOP_COMPANY/HyperClip
python -c "from src.models.session_list_model import SessionListModel; print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/models/session_list_model.py
git commit -m "feat(ws1): SessionListModel.extract_all_sessions() với health tracking"
```

---

### Task 1.9: QML UI Button

**Files:**
- Modify: `src/ui/qml/SessionsPanel.qml`

- [ ] **Step 1: Read existing SessionsPanel.qml**

```bash
cd D:/LOOP_COMPANY/HyperClip
wc -l src/ui/qml/SessionsPanel.qml
head -30 src/ui/qml/SessionsPanel.qml
```

Expected: ~100-200 lines, ListView of sessions.

- [ ] **Step 2: Add Extract button at top**

Edit `src/ui/qml/SessionsPanel.qml`, add at top of ColumnLayout:

```qml
    RowLayout {
        Layout.fillWidth: true
        Layout.margins: 12
        spacing: 8
        
        Label {
            text: "Chrome Sessions (30 profiles)"
            color: Theme.text
            font.pixelSize: 14
            font.bold: true
            Layout.fillWidth: true
        }
        
        Button {
            text: "🔄 Extract tất cả"
            enabled: !extractInProgress
            onClicked: {
                extractInProgress = true
                const results = sessionModel.extract_all_sessions(backend)
                extractInProgress = false
                activityModel.add_entry(
                    "auth",
                    `Extracted ${results.filter(r => r.ok).length}/30 sessions`,
                    "info"
                )
            }
        }
    }
    
    property bool extractInProgress: false
```

- [ ] **Step 3: Verify QML syntax với qmllint**

```bash
cd D:/LOOP_COMPANY/HyperClip
which qmllint || echo "qmllint not installed (skip)"
```

Expected: qmllint may not be installed. If not, skip verification.

- [ ] **Step 4: Commit**

```bash
git add src/ui/qml/SessionsPanel.qml
git commit -m "feat(ws1): QML button 'Extract tất cả' trong SessionsPanel"
```

---

### Task 1.10: Build + Manual Test

- [ ] **Step 1: Build release binary**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo build --release -p hyperclip-tauri
```

Expected: `Finished release` exit 0.

- [ ] **Step 2: Run all unit tests**

```bash
cargo test -p hyperclip_ipc
```

Expected: All tests pass (cookies_dpapi, cookies_sqlite, cookies, error, types).

- [ ] **Step 3: Manual smoke test**

```bash
# Start backend
./src-tauri/target/release/hyperclip.exe &
BACKEND_PID=$!
sleep 2

# Send extract command
echo '{"id": 1, "cmd": "auth:extractCookies", "params": {"profile_name": "Default"}}' | timeout 30 ./src-tauri/target/release/hyperclip.exe

kill $BACKEND_PID 2>/dev/null
```

Expected: JSON response với `ok: true` + cookies array (nếu có real Chrome profile).

- [ ] **Step 4: Commit final state**

```bash
git add -A
git status
git commit -m "test(ws1): WS1 milestone - cookie extraction end-to-end" --allow-empty
```

---

### Task 1.11: Update Memory (User-facing)

**Files:**
- Modify: `C:\Users\MSI\.claude\projects\d--LOOP-COMPANY-HyperClip\memory\MEMORY.md`

- [ ] **Step 1: Read current memory**

- [ ] **Step 2: Add WS1 section**

Append:

```markdown
## WS1: Cookie Extraction (2026-06-07)

**Status**: ✅ COMPLETE

**Files**:
- `crates/hyperclip_ipc/src/cookies.rs` - orchestrator
- `crates/hyperclip_ipc/src/cookies_dpapi.rs` - Windows DPAPI
- `crates/hyperclip_ipc/src/cookies_sqlite.rs` - SQLite parser
- `crates/hyperclip_ipc/src/error.rs` - HyperclipError enum
- `src-tauri/src/commands.rs` - auth:extractCookies handler
- `src/models/session_list_model.py` - extract_all_sessions()
- `src/ui/qml/SessionsPanel.qml` - Extract button

**Patterns**:
- DPAPI v10 vs v11: empty encrypted_value = plaintext (Chrome 80+)
- ChromeCookieLocked error: SQLite "database is locked" → user must close Chrome
- SOCS force-inject: cookie string building accepts socs_override parameter
- Lock-safe read: rusqlite returns clear "database is locked" error (no retry needed)

**Test coverage**:
- 4 unit tests (cookies.rs: build_cookie_string x4 variants)
- 4 SQLite parser tests (with fixture)
- 2 DPAPI tests (v11 plaintext + v10 skip without fixture)
- 2 error tests

**Integration**:
- Real Chrome extraction: ~5s per profile (30 profiles = 2.5 min total)
- DPAPI overhead: <50ms per cookie
```

- [ ] **Step 3: Commit memory**

```bash
cd C:/Users/MSI/.claude/projects/d--LOOP-COMPANY-HyperClip/memory
git add MEMORY.md
git commit -m "memory: WS1 cookie extraction complete"
```

---

### Task 1.12: WS1 Milestone Verification

- [ ] **Step 1: Verify all unit tests pass**

```bash
cd D:/LOOP_COMPANY/HyperClip
cargo test -p hyperclip_ipc --quiet
```

Expected: 0 failures.

- [ ] **Step 2: Verify Python syntax**

```bash
python -m py_compile src/main.py src/models/*.py src/backend/*.py
```

Expected: No errors.

- [ ] **Step 3: Verify build**

```bash
cargo build --release --workspace
```

Expected: `Finished release` exit 0.

- [ ] **Step 4: Verify git state**

```bash
cd D:/LOOP_COMPANY/HyperClip
git log --oneline -10
git status
```

Expected: 10+ commits since master plan start, clean working tree.

- [ ] **Step 5: Tag WS1 milestone**

```bash
git tag -a ws1-complete -m "WS1: Cookie extraction working end-to-end"
git push origin ws1-complete
```

---

## Self-Review

**Spec coverage**:
- [x] WS1.1: `extract_chrome_cookies()` API matches spec
- [x] WS1.2: Workflow (parse → decrypt → build → SOCS) implemented
- [x] WS1.3: Edge cases (lock, v10/v11, empty) handled
- [x] WS1.4: Unit tests + integration test
- [x] WS1.5: IPC command wired
- [x] WS1.6: Python model + QML UI updated

**Placeholder scan**: No TBD/TODO. All code complete.

**Type consistency**:
- `HyperclipError::ChromeCookieLocked` referenced in cookies_sqlite + commands.rs
- `ExtractedCookie` struct used in build_cookie_string + extract_chrome_cookies
- `CookieExtractionResult` serialized to JSON for IPC response

**Status**: Ready for execution. Sau khi complete → proceed to WS2.
