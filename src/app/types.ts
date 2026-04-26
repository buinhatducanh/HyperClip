export type VideoStatus = 'new' | 'rendering' | 'done';
export type CanvasBg = 'black' | 'white';

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
}

export interface EditorState {
  canvasBg: CanvasBg;
  trimStart: number;
  trimEnd: number;
  overlayText: string;
  overlayBorderColor: string;
  overlayBgColor: string;
  overlayPosition: { x: number; y: number };
  overlayWidth: number;
  overlayFontSize: number;
  videoHeight: number;
  videoYOffset: number;
  speedMultiplier: number; // 1.0 | 1.1 | 1.2 | 1.5
  uploadedImageUrl: string | null;
  exportQuality: 1080 | 720 | 360;
  exportCodec: 'h264' | 'hevc';
  exportPreset: 'p1' | 'p2' | 'p3';
  exportTune: 'hq' | 'll' | 'film';
  enableChunked: boolean;
  backgroundType: 'blur' | 'solid' | 'image';
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
  networkIp: string;
  isOnline: boolean;
  activeWorkers: number;
}
