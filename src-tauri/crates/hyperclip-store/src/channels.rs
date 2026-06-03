use hyperclip_core::channel::StoredChannel;
use hyperclip_core::error::{CoreError, Result};
use hyperclip_core::paths;
use std::path::PathBuf;
use tokio::fs;

pub struct ChannelStore {
    channels_path: PathBuf,
}

impl ChannelStore {
    pub fn for_default_dir() -> Result<Self> {
        Ok(Self {
            channels_path: paths::channels_file()?,
        })
    }

    pub async fn list(&self) -> Result<Vec<StoredChannel>> {
        let exists = fs::try_exists(&self.channels_path).await.unwrap_or(false);
        if !exists {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.channels_path)
            .await
            .map_err(|source| CoreError::Io {
                path: self.channels_path.clone(),
                source,
            })?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed: Vec<StoredChannel> =
            serde_json::from_str(&raw).map_err(|source| CoreError::Json {
                path: self.channels_path.clone(),
                source,
            })?;
        Ok(parsed)
    }
}
