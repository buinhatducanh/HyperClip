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