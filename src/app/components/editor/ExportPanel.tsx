'use client'

// Standalone export panel — used by the inline editor controls (ControlsPanel in DetailEditor.tsx)
// Kept as a reference file. The main editor uses inline controls.

interface Props {
  quality: number
  onChange: (q: 1080 | 720 | 360) => void
  onExport: () => void
  isRendering?: boolean
  codec?: 'h264' | 'hevc'
  onCodecChange?: (c: 'h264' | 'hevc') => void
  enableChunked?: boolean
  onChunkedChange?: (v: boolean) => void
  onExportChunked?: () => void
  maxChunkWorkers?: number
}

export function ExportPanel({
  quality, onChange, onExport, isRendering,
  codec = 'hevc', onCodecChange,
  enableChunked = false, onChunkedChange,
  onExportChunked,
  maxChunkWorkers = 8,
}: Props) {
  return null // Controls are now inline in DetailEditor's ControlsPanel
}
