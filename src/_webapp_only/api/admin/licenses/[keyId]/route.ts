/**
 * GET  /api/admin/licenses/[keyId] — Get single license detail
 * DELETE /api/admin/licenses/[keyId] — Revoke a license
 */
import { NextResponse } from 'next/server'

const STORE_ENV = 'LICENSE_STORE'
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'hyperclip-admin-secret-change-me'

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

export async function GET(req: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const auth = checkAuth(req)
  if (!auth.authorized) return auth.error!

  const { keyId } = await params
  const store = getStore()
  const entry = store[keyId]

  if (!entry) {
    return NextResponse.json({ error: 'License not found' }, { status: 404 })
  }

  const now = new Date()
  const expiresAt = new Date(entry.expiresAt)

  return NextResponse.json({
    keyId,
    key: entry.key,
    machineId: entry.machineId,
    machineIdShort: entry.machineId.slice(0, 8) + '••••••••',
    activatedAt: entry.activatedAt,
    expiresAt: entry.expiresAt,
    isExpired: expiresAt <= now,
    daysLeft: Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const auth = checkAuth(req)
  if (!auth.authorized) return auth.error!

  const { keyId } = await params
  const store = getStore()

  if (!store[keyId]) {
    return NextResponse.json({ success: false, error: 'License not found' }, { status: 404 })
  }

  const entry = store[keyId]
  delete store[keyId]
  saveStore(store)

  console.log(`[Admin] Revoked key: ${keyId} (was: ${entry.key})`)

  return NextResponse.json({ success: true, revoked: keyId })
}
