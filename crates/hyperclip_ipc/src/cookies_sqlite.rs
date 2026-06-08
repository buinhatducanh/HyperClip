//! Parse Chrome Cookies SQLite file.

use std::path::Path;
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

/// Parse Chrome Cookies SQLite file, filter by domain (e.g., "youtube.com").
pub fn parse_cookies_file(db_path: &Path, domain_filter: &str) -> Result<Vec<RawCookie>> {
    if !db_path.exists() {
        return Err(HyperclipError::ProfileNotFound(
            db_path.display().to_string()
        ));
    }

    let conn = rusqlite::Connection::open(db_path)
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

    Ok(cookies)
}
