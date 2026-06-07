/**
 * GET /api/license/validate?keyId=xxx&machineId=xxx
 * Validates a license key against the server.
 * Returns: { valid: boolean; error?: string; code?: string; features?: string[] }
 */
import { NextResponse } from 'next/server'

const STORE_ENV = 'LICENSE_STORE'

function getStore(): Record<string, unknown> {
  try {
    const raw = process.env[STORE_ENV]
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const keyId = searchParams.get('keyId')
    const machineId = searchParams.get('machineId')

    if (!keyId || !machineId) {
      return NextResponse.json({ valid: false, error: 'Missing keyId or machineId', code: 'INVALID_PARAMS' }, { status: 400 })
    }

    const store = getStore()
    const stored = store[keyId]

    if (!stored) {
      return NextResponse.json({ valid: false, error: 'License not found', code: 'NOT_FOUND' })
    }

    const s = stored as { machineId: string; expiresAt: string }

    // Verify machineId matches
    if (s.machineId !== machineId) {
      return NextResponse.json({ valid: false, error: 'License đã được kích hoạt trên máy khác', code: 'ALREADY_USED' })
    }

    // Check expiration
    const expiresAt = new Date(s.expiresAt)
    if (expiresAt <= new Date()) {
      return NextResponse.json({ valid: false, error: 'License đã hết hạn', code: 'EXPIRED' })
    }

    // Valid
    return NextResponse.json({
      valid: true,
      features: ['pro', 'auto_render', 'multi_channel'],
      expiresAt: s.expiresAt,
    })
  } catch {
    return NextResponse.json({ valid: false, error: 'Bad request', code: 'BAD_REQUEST' }, { status: 400 })
  }
}
