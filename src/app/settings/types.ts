// Shared types for Settings page

export interface Project {
  projectId: string
  projectName: string
  gmailAccount: string
  clientId: string
  hasToken: boolean
  tokenExpiry: number | null
  usedToday: number
  quotaTotal: number
  errors: number
  status: 'healthy' | 'warning' | 'rate_limited' | 'error' | 'exhausted' | 'unauthorized' | 'no_oauth'
  apiKey: string | null
  apiKeyName: string | null
  apiKeyUsed: number
  apiKeyStatus: string
}

export interface ApiKeyStatus {
  key: string
  projectId: string
  name: string
  usedToday: number
  quotaTotal: number
  quotaPercent: number
  errors: number
  lastUsed: number | null
  status: 'healthy' | 'warning' | 'error' | 'exhausted' | 'unauthorized'
  lastReset: number | null
  nextReset: number | null
  isActive?: boolean
}

// Sanitized session data — cookies, rawSocs, profileDir NEVER sent to renderer
export interface SessionPublic {
  profileId: string
  profileName: string
  isLoggedIn: boolean
  wasLoggedIn: boolean
  isConsented: boolean
  usedToday: number
  lastUsed: number
  error?: string
  hasCookies: boolean
  refreshFailCount: number
}

export interface SessionStatus {
  ready: boolean
  sessionCount: number
  loggedInCount: number
  consentedCount: number
  sessions: SessionPublic[]
}

export interface DiagResult {
  timestamp: string
  ffmpeg: { ok: boolean; path: string; version: string; hasNvenc: boolean; bundled: boolean; error?: string }
  ytDlp: { ok: boolean; path: string; version: string; error?: string }
  storage: { ramDiskAvailable: boolean; storeDir: string }
  overall: { ready: boolean; issues: string[] }
}

export interface OpLogEntry {
  id: string
  timestamp: number
  level: string
  category: string
  message: string
  detail?: string
}
