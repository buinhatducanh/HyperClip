//! Parse Chrome Cookies SQLite file.

use std::path::Path;
use std::time::Duration;
use crate::error::{HyperclipError, Result};

#[derive(Debug, Clone)]
pub struct RawCookie {
    pub name: String,
    pub value: Option<String>,
    pub encrypted_value: Option<Vec<u8>>,
    pub domain: String,
    pub path: String,
    pub is_secure: bool,
    pub is_httponly: bool,
}

/// Copy a file using PowerShell/.NET — the most reliable approach on Windows
/// for reading files locked by Chrome's SQLite. .NET's `File.ReadAllBytes`
/// internally uses `CreateFileW` with sharing modes that Windows 11 honors
/// even when Chrome holds an exclusive WAL checkpoint lock.
///
/// Fallback: try Rust native first (faster, no subprocess overhead), then
/// PowerShell if native fails.
#[cfg(windows)]
fn copy_with_shared_access(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::process::CommandExt;

    // Strategy 1: Rust native with maximum sharing
    let native_ok = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0x7) // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
            .open(src)?;
        let bytes_copied = std::io::copy(&mut file, &mut std::fs::File::create(dst)?)?;
        if bytes_copied == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::Other, "Copied 0 bytes from Chrome Cookies database"));
        }
        Ok(())
    })();

    if native_ok.is_ok() {
        return native_ok;
    }

    // Strategy 2: PowerShell/.NET — handles locked files differently
    let src_abs = std::fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    let dst_abs = std::fs::canonicalize(dst).unwrap_or_else(|_| dst.to_path_buf());
    let src_s = src_abs.to_string_lossy().replace('\'', "''");
    let dst_s = dst_abs.to_string_lossy().replace('\'', "''");

    // .NET FileStream with FileShare.ReadWrite → CopyTo → Close
    let script = format!(
        "$ErrorActionPreference = 'Stop';\
         $fs = [System.IO.FileStream]::new('{}', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite);\
         $out = [System.IO.FileStream]::new('{}', [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None);\
         $fs.CopyTo($out);\
         $fs.Close();\
         $out.Close()",
        src_s, dst_s
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()?;

    let copy_success = output.status.success()
        && dst.exists()
        && std::fs::metadata(dst).map(|m| m.len() > 0).unwrap_or(false);

    if copy_success {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let err_msg = format!(
            "Failed to read Chrome Cookies (Chrome may be open). Tried native open and PowerShell/.NET fallback. Error: {}",
            stderr.trim()
        );
        Err(std::io::Error::new(std::io::ErrorKind::Other, err_msg))
    }
}

#[cfg(not(windows))]
fn copy_with_shared_access(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::copy(src, dst).map(|_| ())
}

/// Parse Chrome Cookies SQLite file, filter by domain (e.g., "youtube.com").
/// Handles Chrome exclusive lock on Windows by copying to temp first.
pub fn parse_cookies_file(db_path: &Path, domain_filter: &str) -> Result<Vec<RawCookie>> {
    if !db_path.exists() {
        return Err(HyperclipError::ProfileNotFound(
            db_path.display().to_string()
        ));
    }

    // Chrome holds an exclusive lock on its Cookies file. On Windows,
    // rusqlite::Connection::open fails with "unable to open database file", and
    // even std::fs::copy fails because Windows doesn't allow copying a file that
    // is exclusively locked. Workaround: use share_mode to bypass the lock AND
    // retry with exponential backoff (Chrome's WAL checkpoint releases within ms).
    let temp_copy = {
        let ext = db_path.extension().unwrap_or_default();
        let stem = db_path.file_stem().unwrap_or_default();
        let mut tmp = std::env::temp_dir();
        
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        db_path.hash(&mut hasher);
        let path_hash = hasher.finish();

        tmp.push(format!("{}-{:x}-copy.{}", stem.to_string_lossy(), path_hash, ext.to_string_lossy()));
        let _ = std::fs::remove_file(&tmp);

        let max_retries = 4;
        let base_delay_ms = 100; // 100ms, 200ms, 400ms = 700ms total
        let mut last_err = None;
        for attempt in 1..=max_retries {
            match copy_with_shared_access(db_path, &tmp) {
                Ok(()) => {
                    if attempt > 1 {
                        tracing::info!("[CookiesSQLite] Copy succeeded on attempt {}/{}", attempt, max_retries);
                    }
                    break;
                }
                Err(e) => {
                    tracing::warn!("[CookiesSQLite] Copy attempt {}/{} failed: {}", attempt, max_retries, e);
                    last_err = Some(e);
                    if attempt < max_retries {
                        let delay = base_delay_ms * (1u64 << (attempt - 1)); // exponential
                        std::thread::sleep(Duration::from_millis(delay));
                    }
                }
            }
        }
        if let Some(e) = last_err {
            return Err(HyperclipError::Io(e));
        }
        tmp
    };

    let result = (|| -> Result<Vec<RawCookie>> {
        let conn = rusqlite::Connection::open(&temp_copy)
            .map_err(|e| {
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
        ).map_err(HyperclipError::Sqlite)?;

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
        }).map_err(HyperclipError::Sqlite)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| HyperclipError::Sqlite(e))?;

        // Drop conn + stmt before temp_copy is removed
        drop(stmt);
        drop(conn);

        Ok(cookies)
    })();

    // Clean up temp copy regardless of success/failure
    let _ = std::fs::remove_file(&temp_copy);

    result
}
