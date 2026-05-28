export type ActivityType = 'detected' | 'downloading' | 'downloaded' | 'rendering' | 'done' | 'error'

export interface ActivityEntry {
  id: string
  timestamp: number
  type: ActivityType
  /** Câu tiếng Việt tự nhiên, ví dụ: "Phát hiện video mới: TÔI GHÉT CÂY..." */
  message: string
  /** Subtle detail line — ETA, size, path */
  detail?: string
  workspaceId?: string
}
