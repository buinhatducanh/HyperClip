/**
 * GET /api/license/validate?keyId=xxx&machineId=xxx
 * Validates a license key against the server.
 * Returns: { valid: boolean; error?: string; code?: string; features?: string[] }
 */
// Vercel serverless types — available at runtime on Vercel
type VercelRequest = { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string | string[] | undefined> }
type VercelResponse = { status(code: number): VercelResponse; json(body: unknown): void; send(body?: string): void }

// In-memory store (shared with activate.ts in development)
// In production, use Vercel KV or a real database
const activatedDemoKeys = new Map<string, {
  machineId: string
  activatedAt: string
  expiresAt: string
  keyId: string
}>()

// Simple KV-like storage for demo activations (Vercel free tier)
// In production: replace with @vercel/kv or Upstash Redis
const STORE_KEY_PREFIX = 'license:'

async function kvGet(key: string): Promise<any | null> {
  // In dev: use in-memory Map
  // In prod: use Vercel KV or environment variable
  const stored = process.env[STORE_KEY_PREFIX + key]
  if (stored) {
    try { return JSON.parse(stored) } catch { return null }
  }
  return null
}

async function kvSet(key: string, value: any): Promise<void> {
  process.env[STORE_KEY_PREFIX + key] = JSON.stringify(value)
}

function getActivatedKeys(): Map<string, any> {
  // Collect all license entries from environment
  const map = new Map<string, any>()
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (envKey.startsWith(STORE_KEY_PREFIX)) {
      try {
        const key = envKey.slice(STORE_KEY_PREFIX.length)
        map.set(key, JSON.parse(envVal as string))
      } catch {}
    }
  }
  return map
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ valid: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
  }

  const { keyId, machineId } = req.query as { keyId?: string; machineId?: string }

  if (!keyId || !machineId) {
    return res.status(400).json({ valid: false, error: 'Missing keyId or machineId', code: 'INVALID_PARAMS' })
  }

  // Check in-memory store (activated demo keys from this server instance)
  const stored = await kvGet(keyId)

  if (!stored) {
    return res.status(200).json({ valid: false, error: 'License not found', code: 'NOT_FOUND' })
  }

  // Verify machineId matches
  if (stored.machineId !== machineId) {
    return res.status(200).json({ valid: false, error: 'License đã được kích hoạt trên máy khác', code: 'ALREADY_USED' })
  }

  // Check expiration
  const expiresAt = new Date(stored.expiresAt)
  if (expiresAt <= new Date()) {
    return res.status(200).json({ valid: false, error: 'License đã hết hạn', code: 'EXPIRED' })
  }

  // Valid
  return res.status(200).json({
    valid: true,
    features: ['pro', 'auto_render', 'multi_channel'],
    expiresAt: stored.expiresAt,
  })
}
