use hyperclip_core::error::{CoreError, Result};
use hyperclip_core::paths;
use hyperclip_core::workspace::WorkspaceData;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::fs;
use tokio::sync::RwLock;

const FILE_INDEX_TTL_MS: u64 = 60_000;

pub struct Store {
    cache: RwLock<Option<CacheEntry>>,
    workspaces_path: PathBuf,
}

struct CacheEntry {
    at: Instant,
    workspaces: Vec<WorkspaceData>,
}

impl Store {
    /// Create a store pointing at a specific workspaces.json path.
    /// Used by tests with fixtures; production code uses `for_default_dir()`.
    pub fn new(workspaces_path: PathBuf) -> Self {
        Self {
            cache: RwLock::new(None),
            workspaces_path,
        }
    }

    /// Default store using %APPDATA%/HyperClip/.hyperclip/workspaces.json.
    pub fn for_default_dir() -> Result<Self> {
        Ok(Self::new(paths::workspaces_file()?))
    }

    pub fn workspaces_path(&self) -> &Path {
        &self.workspaces_path
    }

    /// Load workspaces, using cache if still fresh.
    pub async fn list(&self) -> Result<Vec<WorkspaceData>> {
        // Try cache
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.as_ref() {
                if entry.at.elapsed().as_millis() < FILE_INDEX_TTL_MS as u128 {
                    return Ok(entry.workspaces.clone());
                }
            }
        }

        // Cache miss — read from disk
        let workspaces = self.read_from_disk().await?;
        let mut cache = self.cache.write().await;
        *cache = Some(CacheEntry {
            at: Instant::now(),
            workspaces: workspaces.clone(),
        });
        Ok(workspaces)
    }

    /// Invalidate the cache — call after any mutation.
    pub async fn invalidate(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }

    async fn read_from_disk(&self) -> Result<Vec<WorkspaceData>> {
        let exists = fs::try_exists(&self.workspaces_path).await.unwrap_or(false);
        if !exists {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.workspaces_path)
            .await
            .map_err(|source| CoreError::Io {
                path: self.workspaces_path.clone(),
                source,
            })?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed: Vec<WorkspaceData> =
            serde_json::from_str(&raw).map_err(|source| CoreError::Json {
                path: self.workspaces_path.clone(),
                source,
            })?;
        Ok(parsed)
    }

    /// Save workspaces to disk, replacing existing content.
    pub async fn save(&self, workspaces: &[WorkspaceData]) -> Result<()> {
        if let Some(parent) = self.workspaces_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|source| CoreError::Io {
                    path: parent.to_path_buf(),
                    source,
                })?;
        }
        let json = serde_json::to_string_pretty(workspaces).map_err(|source| CoreError::Json {
            path: self.workspaces_path.clone(),
            source,
        })?;
        fs::write(&self.workspaces_path, json)
            .await
            .map_err(|source| CoreError::Io {
                path: self.workspaces_path.clone(),
                source,
            })?;
        self.invalidate().await;
        Ok(())
    }
}
