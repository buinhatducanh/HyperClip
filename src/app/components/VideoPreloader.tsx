'use client'

import { useEffect, useRef } from 'react'
import { ipc } from '../lib/ipc'

interface Props {
  currentVideoId: string | null
}

// Hidden video preloader — mounts adjacent workspace videos into memory
// so they're ready when the user navigates. No UI rendering.
export function VideoPreloader({ currentVideoId }: Props) {
  const preloadRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  useEffect(() => {
    if (!currentVideoId) return

    // Get workspace list from store to find adjacent IDs
    ipc.getWorkspaces().then(workspaces => {
      if (!Array.isArray(workspaces)) return
      const ids = workspaces.map((w: { id: string }) => w.id)
      const idx = ids.indexOf(currentVideoId)
      if (idx < 0) return

      const adjacent = [
        ids[idx - 1],
        ids[idx + 1],
      ].filter(Boolean)

      adjacent.forEach(id => {
        if (preloadRefs.current.has(id)) return // already preloading

        ipc.getVideoFile(id).then(result => {
          if (!result?.url) return
          const v = document.createElement('video')
          v.src = result.url
          v.preload = 'auto'
          v.muted = true
          v.playsInline = true
          v.volume = 0
          preloadRefs.current.set(id, v)
        })
      })
    })
  }, [currentVideoId])

  // Cleanup: revoke preloadRefs entries for IDs far from current
  useEffect(() => {
    const all = Array.from(preloadRefs.current.keys())
    all.forEach(id => {
      const v = preloadRefs.current.get(id)
      if (v) {
        v.src = ''
        v.load()
        preloadRefs.current.delete(id)
      }
    })
  }, [currentVideoId])

  return null // purely functional, no UI
}
