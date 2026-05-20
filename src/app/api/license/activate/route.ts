/**
 * POST /api/license/activate
 * Body: { key: string; machineId: string }
 * Returns: { success: boolean; keyId?: string; expiresAt?: string; features?: string[]; error?: string; code?: string }
 *
 * Demo key format: DEMO-{DAYS}-{RANDOM}
 * Example: DEMO-7-ABC123 → valid for 7 days from activation
 *
 * Storage: env var LICENSE_STORE = JSON string (persists across Lambda invocations in Vercel)
 */
import { NextResponse } from 'next/server'

const STORE_ENV = 'LICENSE_STORE'
const MAX_DAYS = 30

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

function generateDemoExpiry(days: number): string {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + days)
  expiry.setHours(0, 0, 0, 0)
  return expiry.toISOString()
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

    // ── Demo key activation ────────────────────────────────────────────────────
    if (keyUpper.startsWith('DEMO-')) {
      const match = keyUpper.match(/^DEMO-(\d{1,2})-([A-Z0-9]{3,6})$/)
      if (!match) {
        return NextResponse.json({ success: false, error: 'Invalid demo key format. Use: DEMO-7-XXXXXX', code: 'INVALID_KEY' }, { status: 400 })
      }

      const days = parseInt(match[1], 10)
      if (isNaN(days) || days < 1 || days > MAX_DAYS) {
        return NextResponse.json({ success: false, error: `Demo key duration must be 1-${MAX_DAYS} days`, code: 'INVALID_KEY' }, { status: 400 })
      }

      // Check if already activated by this machine
      const store = getStore()
      for (const entry of Object.values(store)) {
        if (entry.key === keyUpper && entry.machineId === machineId) {
          // Re-activation — return same keyId
          return NextResponse.json({
            success: true,
            keyId: entry.keyId,
            expiresAt: entry.expiresAt,
            features: ['pro', 'auto_render', 'multi_channel'],
            issuedAt: entry.activatedAt,
            activatedAt: entry.activatedAt,
            reactivated: true,
          })
        }
      }

      const keyId = `D-${Date.now().toString(36).toUpperCase()}-${match[2]}`
      const expiresAt = generateDemoExpiry(days)
      const now = new Date().toISOString()

      store[keyId] = { key: keyUpper, machineId, activatedAt: now, expiresAt, keyId }
      saveStore(store)

      console.log(`[Activate] Demo: ${keyId} | machine: ${machineId.slice(0, 8)}... | expires: ${expiresAt}`)

      return NextResponse.json({
        success: true,
        keyId,
        expiresAt,
        features: ['pro', 'auto_render', 'multi_channel'],
        issuedAt: now,
        activatedAt: now,
      })
    }

    return NextResponse.json({ success: false, error: 'License key không hợp lệ', code: 'NOT_FOUND' }, { status: 400 })
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request', code: 'BAD_REQUEST' }, { status: 400 })
  }
}
