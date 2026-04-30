export type VideoStatus = 'new' | 'rendering' | 'done';
export type CanvasBg = 'black' | 'white';
export type TitleShape = 'rounded' | 'square' | 'diamond';

export interface Channel {
  id: string;
  name: string;
  handle: string;
  avatarColor: string;
  channelId?: string;   // YouTube channel ID (UC...)
  avatarUrl?: string;   // YouTube avatar image URL
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
  exportCodec: 'h264' | 'hevc';
  exportPreset: 'p1' | 'p2' | 'p3';
  exportTune: 'hq' | 'll' | 'film';
  enableChunked: boolean;
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
  gpuTier?: string;
  maxChunkWorkers?: number;
  networkIp: string;
  isOnline: boolean;
  activeWorkers: number;
}
