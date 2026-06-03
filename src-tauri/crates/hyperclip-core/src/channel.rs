use serde::{Deserialize, Serialize};

/// Mirror of `StoredChannel` from `electron/services/store.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredChannel {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub avatarColor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channelId: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatarUrl: Option<String>,
    pub createdAt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<ChannelSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ChannelTrimLimit {
    Minutes(f64),
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChannelSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trimLimit: Option<ChannelTrimLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloadQuality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoRender: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autoSplit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub splitMinutes: Option<f64>,
}
