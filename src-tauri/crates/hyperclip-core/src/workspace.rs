use serde::{Deserialize, Serialize};

/// Mirror of `WorkspaceData` from `electron/services/store.ts`.
/// IMPORTANT: JSON field names must match the existing file on disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceData {
    pub id: String,
    #[serde(rename = "channelId")]
    pub channel_id: String,
    #[serde(rename = "channelName")]
    pub channel_name: String,
    #[serde(rename = "channelColor")]
    pub channel_color: String,
    #[serde(rename = "videoId")]
    pub video_id: String,
    #[serde(rename = "videoTitle")]
    pub video_title: String,
    #[serde(rename = "videoUrl")]
    pub video_url: String,
    pub thumbnail: String,
    pub duration: f64,
    #[serde(rename = "trimLimit", with = "trim_limit_serde")]
    pub trim_limit: TrimLimit,
    pub status: WorkspaceStatus,
    #[serde(rename = "renderProgress")]
    pub render_progress: f64,
    #[serde(rename = "downloadProgress", skip_serializing_if = "Option::is_none")]
    pub download_progress: Option<f64>,
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: String,
    #[serde(rename = "downloadedPath")]
    pub downloaded_path: String,
    #[serde(rename = "blurBackgroundPath")]
    pub blur_background_path: String,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    #[serde(rename = "metadataPath")]
    pub metadata_path: String,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    #[serde(rename = "renderMetadata")]
    pub render_metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrimLimit {
    Minutes(f64),
    Full,
}

mod trim_limit_serde {
    use super::TrimLimit;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &TrimLimit, s: S) -> Result<S::Ok, S::Error> {
        match v {
            TrimLimit::Minutes(n) => n.serialize(s),
            TrimLimit::Full => "full".serialize(s),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<TrimLimit, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Helper {
            Num(f64),
            Str(String),
        }
        match Helper::deserialize(d)? {
            Helper::Num(n) => Ok(TrimLimit::Minutes(n)),
            Helper::Str(s) if s == "full" => Ok(TrimLimit::Full),
            Helper::Str(other) => Err(serde::de::Error::custom(format!(
                "expected 'full' or number, got {:?}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    Waiting,
    Downloading,
    Ready,
    Editing,
    Rendering,
    Done,
    Error,
}

impl WorkspaceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Downloading => "downloading",
            Self::Ready => "ready",
            Self::Editing => "editing",
            Self::Rendering => "rendering",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip_preserves_lowercase_strings() {
        for status in [
            WorkspaceStatus::Waiting,
            WorkspaceStatus::Downloading,
            WorkspaceStatus::Ready,
            WorkspaceStatus::Editing,
            WorkspaceStatus::Rendering,
            WorkspaceStatus::Done,
            WorkspaceStatus::Error,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: WorkspaceStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, parsed);
        }
    }

    #[test]
    fn trim_limit_full_serializes_as_string() {
        let ws = make_minimal_workspace(TrimLimit::Full);
        let json = serde_json::to_string(&ws).expect("serialize");
        assert!(json.contains("\"trimLimit\":\"full\""), "got: {}", json);
    }

    #[test]
    fn trim_limit_minutes_serializes_as_number() {
        let ws = make_minimal_workspace(TrimLimit::Minutes(5.0));
        let json = serde_json::to_string(&ws).expect("serialize");
        assert!(json.contains("\"trimLimit\":5"), "got: {}", json);
    }

    fn make_minimal_workspace(trim: TrimLimit) -> WorkspaceData {
        WorkspaceData {
            id: "x".into(),
            channel_id: "c".into(),
            channel_name: "n".into(),
            channel_color: "#fff".into(),
            video_id: "v".into(),
            video_title: "t".into(),
            video_url: "u".into(),
            thumbnail: "th".into(),
            duration: 1.0,
            trim_limit: trim,
            status: WorkspaceStatus::Waiting,
            render_progress: 0.0,
            download_progress: None,
            downloaded_at: "x".into(),
            downloaded_path: "".into(),
            blur_background_path: "".into(),
            output_path: "".into(),
            metadata_path: "".into(),
            file_size: 0,
            render_metadata: None,
        }
    }

    #[test]
    fn all_status_strings_match_electron_set() {
        assert_eq!(WorkspaceStatus::Waiting.as_str(), "waiting");
        assert_eq!(WorkspaceStatus::Error.as_str(), "error");
    }
}

