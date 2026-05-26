/**
 * Channel IPC handlers.
 * Channels: CHANNEL_INFO, CHANNEL_LIST, CHANNEL_SYNC, CHANNEL_ADD,
 *           CHANNEL_UPDATE, CHANNEL_REMOVE, CHANNEL_UNSUBSCRIBE, CHANNEL_BULK_ADD
 */

import type { IpcMain } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../channels.js'
import {
  getChannels,
  addChannel,
  updateChannel,
  removeChannel,
  type StoredChannel,
} from '../../services/store.js'
import { getChannelInfo } from '../../services/youtube.js'
import { getCookieManager } from '../../services/cookie_manager.js'
import { refreshChannelCache } from '../../services/subscription_feed.js'
import { getAppStoreDir } from '../../services/paths.js'
import { unsubscribeChannel } from '../../services/youtube_auth.js'
import { getTokenManager } from '../../services/token_manager.js'
import { devLog } from '../../services/unified_log.js'

const CHANNEL_COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800']

export function registerChannelHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.CHANNEL_INFO, async (_, url: string) => {
    return getChannelInfo(url)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_LIST, async (): Promise<StoredChannel[]> => {
    return getChannels()
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_SYNC, async () => {
    const cm = getCookieManager()
    const result = await cm.syncSubscriptionList()
    refreshChannelCache()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_ADD, async (_, url: string): Promise<StoredChannel | null> => {
    const urlTrimmed = url.trim()
    if (!urlTrimmed) return null

    // ── Extract channel ID / handle from URL ─────────────────────────────────────
    let channelId: string | undefined
    let handle: string | undefined
    try {
      const normalized = urlTrimmed.startsWith('http') ? urlTrimmed : 'https://www.youtube.com/' + urlTrimmed
      const u = new URL(normalized)
      const pathname = u.pathname
      const m = pathname.match(/^\/(channel\/|@|c\/|user\/)?([\w.-]+)/)
      if (m) {
        if (pathname.startsWith('/channel/')) channelId = m[2]
        else if (pathname.startsWith('/@')) handle = '@' + m[2]
        else if (pathname.startsWith('/c/') || pathname.startsWith('/user/')) handle = m[2]
        else handle = '@' + m[2]
      }
    } catch { /* ignore URL parse errors */ }

    // ── Duplicate check ───────────────────────────────────────────────────────────
    const existing = getChannels()
    const isDupe = existing.some((ch) => {
      if (channelId && ch.channelId === channelId) return true
      if (handle && ch.handle?.toLowerCase() === handle.toLowerCase()) return true
      return false
    })
    if (isDupe) {
      console.warn(`[CHANNEL_ADD] Duplicate channel: ${channelId || handle || urlTrimmed}`)
      return null
    }

    // ── Fetch channel metadata ───────────────────────────────────────────────────
    let name: string
    let avatarUrl: string | undefined
    try {
      const info = await getChannelInfo(urlTrimmed)
      if (info && info.channelName) {
        name = info.channelName
        channelId = info.channelId || channelId
        handle = info.handle || handle
        avatarUrl = info.avatarUrl
      } else {
        throw new Error('no channel info')
      }
    } catch {
      const raw = urlTrimmed
        .replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/|@|c\/|user\/)?/, '')
        .split(/[/?]/)[0]
        .replace(/^@/, '') || 'Kênh Mới'
      name = raw.charAt(0).toUpperCase() + raw.slice(1)
      if (!handle) handle = '@' + raw.toLowerCase().replace(/\s+/g, '')
    }

    // ── Save ─────────────────────────────────────────────────────────────────────
    const newCh: StoredChannel = {
      id: `ch${Date.now()}`,
      name,
      handle: handle || `@${channelId || name}`,
      avatarColor: CHANNEL_COLORS[existing.length % CHANNEL_COLORS.length],
      channelId,
      avatarUrl,
      createdAt: new Date().toISOString(),
    }
    const saved = addChannel(newCh)
    refreshChannelCache()
    return saved
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_UPDATE, async (_, id: string, patch: Partial<StoredChannel>): Promise<StoredChannel | null> => {
    return updateChannel(id, patch)
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_REMOVE, async (_, id: string): Promise<boolean> => {
    return removeChannel(id)
  })

  // ── Unsubscribe from YouTube ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.CHANNEL_UNSUBSCRIBE, async (_, id: string): Promise<{ success: boolean; error?: string }> => {
    const channels = getChannels()
    const ch = channels.find(c => c.id === id)
    if (!ch) return { success: false, error: 'Channel not found' }
    if (!ch.channelId) return { success: false, error: 'No YouTube channel ID' }

    const tokenData = await getTokenManager().getBestAvailable(ch.channelId)
    if (!tokenData) return { success: false, error: 'No OAuth token available — please configure OAuth credentials in Settings' }

    devLog(`[CHANNEL_UNSUBSCRIBE] Unsubscribing from ${ch.name} (${ch.channelId})`)
    const result = await unsubscribeChannel(tokenData.token, ch.channelId)

    if (result.success) {
      // Also remove from local tracking
      removeChannel(id)
      refreshChannelCache()
      devLog(`[CHANNEL_UNSUBSCRIBE] Success — ${ch.name} unsubscribed and removed from tracking`)
    }
    return result
  })

  // ── Bulk add ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.CHANNEL_BULK_ADD, async (_, urls: string[]) => {
    const results: Array<{ url: string; success: boolean; error?: string }> = []

    for (const url of urls) {
      const trimmed = url.trim()
      if (!trimmed) continue
      try {
        let name: string
        let handle: string | undefined
        let channelId: string | undefined
        let avatarUrl: string | undefined
        try {
          const info = await getChannelInfo(trimmed)
          if (info) {
            name = info.channelName
            handle = info.handle || `@${info.channelId}`
            channelId = info.channelId
            avatarUrl = info.avatarUrl
          } else {
            throw new Error('no info')
          }
        } catch {
          const raw = trimmed.replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/, '').split(/[/?]/)[0] || 'Kênh Mới'
          name = raw.charAt(0).toUpperCase() + raw.slice(1)
          handle = `@${raw.toLowerCase()}`
        }

        const channels = getChannels()
        const newCh: StoredChannel = {
          id: `ch${Date.now()}`,
          name,
          handle,
          avatarColor: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
          channelId,
          avatarUrl,
          createdAt: new Date().toISOString(),
        }
        addChannel(newCh)
        results.push({ url: trimmed, success: true })
      } catch (err) {
        results.push({ url: trimmed, success: false, error: (err as Error).message })
      }
    }
    refreshChannelCache()
    return results
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_PAUSE, async (_, id: string): Promise<boolean> => {
    const { pauseChannel } = await import('../../services/store.js')
    const result = pauseChannel(id)
    refreshChannelCache()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_RESUME, async (_, id: string): Promise<boolean> => {
    const { resumeChannel } = await import('../../services/store.js')
    const result = resumeChannel(id)
    refreshChannelCache()
    return result
  })
}
