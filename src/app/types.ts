export type VideoStatus = 'new' | 'rendering' | 'done';
export type CanvasBg = 'black' | 'white';
export type TitleShape = 'rounded' | 'square' | 'diamond';

// ─── License ─────────────────────────────────────────────────────────────────────
export interface LicenseRecord {
  keyId: string
  machineId: string
  features: string[]
  expiresAt: string | null
  issuedAt: string
  activatedAt: string
}

export interface LicenseStatus {
  activated: boolean
  valid: boolean
  reason?: string
  record?: LicenseRecord
  updateAvailable?: boolean
  latestVersion?: string
  updateProgress?: number
}

export interface UpdateStatus {
  available: boolean
  version?: string
  progress: number
  downloading?: boolean
  ready?: boolean
}

export interface ChannelSettings {
  trimLimit?: number | 'full'
  downloadQuality?: string
  autoRender?: boolean
  resolution?: string
  autoSplit?: boolean
  splitMinutes?: number
}

export interface Channel {
  id: string;
  name: string;
  handle: string;
  avatarColor: string;
  channelId?: string;   // YouTube channel ID (UC...)
  avatarUrl?: string;   // YouTube avatar image URL
  /** True = paused, skipped by poller */
  paused?: boolean;
  /** Per-channel settings override */
  settings?: ChannelSettings;
}

export interface SplitPart {
  index: number
  start: number
  end: number
  duration: number
}

export interface Video {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string;
  duration: string;
  downloadedAt: string;
  status: VideoStatus;
  renderProgress?: number;
  fileSize: string;
  downloadedPath?: string;
  /** Human-readable file size */
  fileSizeBytes?: number;
  /** Detected on download: true = vertical 9:16 short, false = landscape 16:9+ video */
  isShort?: boolean;
  /** Source video resolution (e.g. "1920x1080") */
  videoResolution?: string;
  /** yt-dlp quality cap used for download (e.g. "720") — max export quality */
  downloadQuality?: string;
  /** YouTube available video heights (e.g. [360, 720, 1080]) — for quality validation UI */
  availableFormats?: number[];
  /** ID of workspace this was split from */
  parentId?: string;
  /** 1-based part index within split */
  partIndex?: number;
  /** Total parts this video was split into */
  totalParts?: number;
}

export interface EditorState {
  canvasBg: CanvasBg;
  trimStart: number;
  trimEnd: number;
  // Header image (top section)
  headerImageUrl: string | null;
  /** Disk path for FFmpeg to read (null until saved from blob URL) */
  headerImageDiskPath: string | null;
  headerImageOffsetY: number; // 0-100, vertical position within header
  // Title box (bottom section)
  titleText: string;
  titleShape: TitleShape;
  titleBorderColor: string;
  titleBgColor: string;
  titleFontSize: number;     // px in preview
  // Speed
  speedMultiplier: number;    // 1.0 to 2.0, step 0.1
  // Export
  exportQuality: 1080 | 720 | 360;
  exportCodec: 'h264';
  exportFPS: 30 | 60;
  exportPreset: 'p1' | 'p2' | 'p3';
  exportTune: 'hq' | 'll' | 'film';
  enableChunked: boolean;
  /** Upscale to 720p minimum for TikTok compliance when source is below 720p */
  upscaleToTikTok: boolean;
  // Background
  backgroundType: 'blur' | 'solid' | 'image';
  /** Uploaded background image URL (blob URL — for preview only) */
  backgroundImageUrl: string | null;
  /** Disk path for FFmpeg to read (null until saved from blob URL) */
  backgroundImageDiskPath: string | null;
  /** Solid background color hex */
  backgroundColor: string;
  // Landscape video zone height (30-100% of canvas) — larger = video bigger, less thumbnail
  vidHeightPct: number;
  /** Enable bottom bar (opaque bar at canvas bottom, text inside) — SHORT mode only */
  bottomBarEnabled: boolean;
  /** Bottom bar accent color hex */
  bottomBarColor: string;
}

export interface KeyStatus {
  key: string
  projectId: string
  name: string
  usedToday: number
  quotaTotal: number
  quotaPercent: number
  errors: number
  lastUsed: number | null
  status: 'healthy' | 'warning' | 'error' | 'exhausted'
}

export interface SystemStats {
  ramUsed: number;
  ramTotal: number;
  ramFree: number;
  ramDiskUsed: number;
  ramDiskTotal: number;
  ramDiskAvailable: number;
  ramDiskIsAvailable: boolean;
  cpuUsage: number;
  cpuCores: number;
  cpuName: string;
  gpuUsage: number;
  gpuTemp: number;
  gpuName: string;
  gpuEncoder: string;
  gpuMemoryTotal: number;
  gpuMemoryFree: number;
  gpuTier: string;
  maxChunkWorkers: number;
  networkIp: string;
  isOnline: boolean;
  activeWorkers: number;
}

export interface RenderConfig {
  exportResolution: string
  fps: number
  speed: number
  codec: string
  preset?: string
  tune?: string
  backgroundType?: string
  audioCodec?: string
  audioBitrate?: string
  trimStart?: number
  trimEnd?: number
  isShort?: boolean
  vidHeightPct?: number
  gpuTier?: string
}

export interface SourceInfo {
  originalResolution?: string
  originalDuration?: number
  originalFileSize?: number
  downloadQuality?: string
}

export interface RenderedVideo {
  id: string;
  workspaceId: string;
  channelId: string;
  channelName: string;
  videoTitle: string;
  archivedPath: string;
  outputPath: string;
  quality: number;
  codec: string;
  /** Human-readable file size (e.g. "245.3 MB") */
  fileSize: string;
  /** Raw file size in bytes */
  fileSizeBytes: number;
  duration: number;
  thumbnail: string;
  /** base64 JPEG data URI of thumbnail — survives workspace deletion */
  thumbnailData?: string;
  /** Source video resolution (e.g. "1920x1080") */
  videoResolution?: string;
  renderedAt: string;
  // ─── Render metadata (for PO debug & comparison) ───
  /** Wall-clock render time in milliseconds */
  renderDurationMs?: number;
  /** Full render configuration used */
  renderConfig?: RenderConfig;
  /** Source video information for before/after comparison */
  sourceInfo?: SourceInfo;
}
