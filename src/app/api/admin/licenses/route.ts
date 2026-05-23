/**
 * GET /api/admin/licenses — List all issued licenses
 * POST /api/admin/licenses — Issue a custom demo key
 *
 * Auth: Basic Auth with ADMIN_SECRET env var
 *   Authorization: Basic base64(admin:ADMIN_SECRET)
 */
import { NextResponse } from 'next/server'

const STORE_ENV = 'LICENSE_STORE'
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'hyperclip-admin-secret-change-me'
const MAX_DAYS = 2

interface StoredLicense {
  key: string
  machineId: string
  activatedAt: string
  expiresAt: string
  keyId: string
}

function getStore(): Record<string, StoredLicense> {
  try {
    const raw = process.env[STORE_ENV]
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStore(store: Record<string, StoredLicense>): void {
  process.env[STORE_ENV] = JSON.stringify(store)
}

function checkAuth(req: Request): { authorized: boolean; error?: NextResponse } {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Basic ')) {
    return { authorized: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  try {
    const [user, pass] = atob(auth.slice(6)).split(':')
    if (user !== 'admin' || pass !== ADMIN_SECRET) {
      return { authorized: false, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
  } catch {
    return { authorized: false, error: NextResponse.json({ error: 'Bad credentials' }, { status: 401 }) }
  }
  return { authorized: true }
}

export async function GET(req: Request) {
  const auth = checkAuth(req)
  if (!auth.authorized) return auth.error!

  const store = getStore()
  const now = new Date()

  const licenses = Object.entries(store).map(([keyId, entry]) => {
    const expiresAt = new Date(entry.expiresAt)
    const isExpired = expiresAt <= now
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    return {
      keyId,
      key: entry.key,
      machineId: entry.machineId,
      machineIdShort: entry.machineId.slice(0, 8) + '••••••••',
      activatedAt: entry.activatedAt,
      expiresAt: entry.expiresAt,
      isExpired,
      daysLeft: isExpired ? 0 : daysLeft,
    }
  }).sort((a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime())

  const stats = {
    total: licenses.length,
    active: licenses.filter(l => !l.isExpired).length,
    expired: licenses.filter(l => l.isExpired).length,
  }

  return NextResponse.json({ licenses, stats })
}

export async function POST(req: Request) {
  const auth = checkAuth(req)
  if (!auth.authorized) return auth.error!

  try {
    const body = await req.json()
    const { days, customKey, machineId } = body as {
      days?: number
      customKey?: string
      machineId?: string
    }

    const useDays = days && days >= 1 && days <= MAX_DAYS ? days : MAX_DAYS

    const expiry = new Date()
    expiry.setDate(expiry.getDate() + useDays)
    expiry.setHours(0, 0, 0, 0)
    const expiresAt = expiry.toISOString()
    const now = new Date().toISOString()

    let key: string
    let keyId: string

    if (customKey && typeof customKey === 'string' && customKey.length >= 4) {
      key = customKey.toUpperCase().trim()
      keyId = `C-${Date.now().toString(36).toUpperCase()}-${key.slice(0, 6)}`
    } else {
      const suffix = Math.random().toString(36).substring(2, 8).toUpperCase()
      key = `DEMO-${useDays}-${suffix}`
      keyId = `D-${Date.now().toString(36).toUpperCase()}-${suffix}`
    }

    const store = getStore()

    if (store[keyId]) {
      return NextResponse.json({ success: false, error: 'KeyId already exists' }, { status: 409 })
    }

    const record: StoredLicense = {
      key,
      machineId: machineId || 'not-activated',
      activatedAt: machineId ? now : '',   // only set if pre-bound to a machine
      expiresAt,
      keyId,
    }

    store[keyId] = record
    saveStore(store)

    console.log(`[Admin] Created key: ${keyId} | machine: ${machineId || 'none'} | expires: ${expiresAt}`)

    return NextResponse.json({
      success: true,
      keyId,
      key,
      expiresAt,
      days: useDays,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request' }, { status: 400 })
  }
}
