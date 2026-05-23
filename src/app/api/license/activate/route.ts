/**
 * POST /api/license/activate
 * Body: { key: string; machineId: string }
 * Returns: { success: boolean; keyId?: string; expiresAt?: string; features?: string[]; error?: string; code?: string }
 *
 * Keys MUST be pre-created via /api/admin/licenses (POST).
 * On-the-fly creation is DISABLED to prevent abuse.
 *
 * On Vercel: uses env var LICENSE_STORE (not persistent across Lambda invocations)
 * For production: use the bundled local license server instead
 */
import { NextResponse } from 'next/server'

const STORE_ENV = 'LICENSE_STORE'

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

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { key, machineId } = body as { key?: string; machineId?: string }

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing key', code: 'INVALID_KEY' }, { status: 400 })
    }
    if (!machineId || typeof machineId !== 'string' || machineId.length < 16) {
      return NextResponse.json({ success: false, error: 'Invalid machineId', code: 'INVALID_MACHINE_ID' }, { status: 400 })
    }

    const keyUpper = key.trim().toUpperCase()
    const store = getStore()

    // ── Find key in store (must be pre-created by admin) ────────────────────
    let found: StoredLicense | null = null
    let foundKeyId: string | null = null
    for (const [keyId, entry] of Object.entries(store)) {
      if (entry.key === keyUpper) {
        found = entry
        foundKeyId = keyId
        break
      }
    }

    if (!found) {
      return NextResponse.json({ success: false, error: 'License key không hợp lệ', code: 'NOT_FOUND' }, { status: 400 })
    }

    // Check: same machine re-activating → return existing record
    if (found.machineId === machineId) {
      return NextResponse.json({
        success: true,
        keyId: found.keyId,
        expiresAt: found.expiresAt,
        features: ['pro', 'auto_render', 'multi_channel'],
        issuedAt: found.activatedAt,
        activatedAt: found.activatedAt,
        reactivated: true,
      })
    }

    // Check: different machine → key already used (both 'not-activated' and '' mean unbound)
    if (found.machineId && found.machineId !== 'not-activated') {
      return NextResponse.json({ success: false, error: 'License đã được kích hoạt trên máy khác.', code: 'ALREADY_USED' }, { status: 403 })
    }

    // First-time activation
    const now = new Date().toISOString()
    found.machineId = machineId
    found.activatedAt = now
    store[foundKeyId!] = found
    saveStore(store)

    console.log(`[Activate] Demo: ${found.keyId} | machine: ${machineId.slice(0, 8)}... | expires: ${found.expiresAt}`)

    return NextResponse.json({
      success: true,
      keyId: found.keyId,
      expiresAt: found.expiresAt,
      features: ['pro', 'auto_render', 'multi_channel'],
      issuedAt: now,
      activatedAt: now,
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request', code: 'BAD_REQUEST' }, { status: 400 })
  }
}
