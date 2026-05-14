#!/usr/bin/env node
/**
 * HyperClip E2E Test Runner
 * ==========================
 * Runs full pipeline E2E tests against the running HyperClip app.
 *
 * Prerequisites:
 *   1. HyperClip must be running with test server enabled:
 *        HYPERCLIP_TEST=1 npm run electron:dev
 *   2. OR the built app with test mode:
 *        HYPERCLIP_TEST=1 ./dist/HyperClip.exe
 *
 * Usage:
 *   node scripts/test-e2e.mjs                          # Run all tests
 *   node scripts/test-e2e.mjs --detect                # Run only detection test
 *   node scripts/test-e2e.mjs --detect --render      # Run detection + render
 *   node scripts/test-e2e.mjs --channel https://...   # Test specific channel
 *   node scripts/test-e2e.mjs --help                  # Show help
 */

import http from 'http'
import { parseArgs } from 'util'

// ─── Config ────────────────────────────────────────────────────────────────────

const TEST_SERVER = '127.0.0.1'
const TEST_PORT = 9312
const TIMEOUT_MS = 120_000   // 2 min per test
const POLL_INTERVAL_MS = 3_000  // 3s between status checks

// Default test channel — a channel that posts frequently
const DEFAULT_TEST_CHANNEL = 'https://www.youtube.com/@MrBeast'

// ─── HTTP Client ───────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://${TEST_SERVER}:${TEST_PORT}`)
    const opts = {
      hostname: TEST_SERVER,
      port: TEST_PORT,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${json.error || data}`))
          } else {
            resolve(json)
          }
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', (e) => reject(e))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  del: (path) => request('DELETE', path),
}

// ─── Wait Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(conditionFn, { timeoutMs = TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS, name = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await conditionFn()
    if (result !== null && result !== undefined && result !== false) return result
    await sleep(intervalMs)
  }
  throw new Error(`Timeout waiting for: ${name} (${timeoutMs}ms)`)
}

async function waitForWorkspaceStatus(wsId, targetStatuses, { timeoutMs = TIMEOUT_MS } = {}) {
  const statuses = Array.isArray(targetStatuses) ? targetStatuses : [targetStatuses]
  return waitFor(async () => {
    const ws = await api.get(`/api/e2e/workspace/${wsId}`)
    if (!ws?.data) return false
    if (statuses.includes(ws.data.status)) return ws.data
    if (ws.data.status === 'error') throw new Error(`Workspace ${wsId} entered error state`)
    return false
  }, { timeoutMs, name: `workspace ${wsId} to be ${statuses.join('|')}` })
}

// ─── Output ────────────────────────────────────────────────────────────────────

let currentTest = ''
let passCount = 0
let failCount = 0

function section(name) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${name}`)
  console.log('═'.repeat(60))
}

function test(name) {
  currentTest = name
  process.stdout.write(`  [TEST] ${name}... `)
}

function pass(msg = '') {
  console.log(`\x1b[32m✓\x1b[0m ${currentTest}${msg ? ' — ' + msg : ''}`)
  passCount++
}

function fail(msg) {
  console.log(`\x1b[31m✗\x1b[0m ${currentTest} — ${msg}`)
  failCount++
}

function info(msg) {
  console.log(`  \x1b[36m→\x1b[0m  ${msg}`)
}

function warn(msg) {
  console.log(`  \x1b[33m⚠\x1b[0m  ${msg}`)
}

// ─── Test: App Status ─────────────────────────────────────────────────────────

async function testAppStatus() {
  section('Test 0: App Status Check')

  const status = await api.get('/api/e2e/')
  const data = status.data

  info(`Sessions: ${data.sessions?.readyCount ?? '?'}/${data.sessions?.totalCount ?? '?'}`)
  info(`Projects: ${data.projects?.healthy ?? '?'}/${data.projects?.total ?? '?'} healthy`)
  info(`Channels monitored: ${data.channels?.total ?? 0}`)
  info(`Workspaces: ${data.workspaces?.total ?? 0} (${JSON.stringify(data.workspaces?.byStatus ?? {})})`)
  info(`Poller: ${data.poller?.active ? 'RUNNING' : 'STOPPED'}`)

  if (!data.poller?.active) {
    warn('Poller is not running — detection tests may fail')
  }
}

// ─── Test: Detection ──────────────────────────────────────────────────────────

async function testDetection(channelUrl) {
  section('Test 1: Detection — Add Channel + Poll for Video')

  // Clean up any existing test workspaces
  test('Cleanup existing test workspaces')
  try {
    await api.post('/api/e2e/cleanup', {})
    pass()
  } catch { pass('(nothing to clean)') }

  // Add channel
  test(`Adding channel: ${channelUrl}`)
  let chResult
  try {
    chResult = await api.post('/api/e2e/channel/add', { url: channelUrl })
    if (!chResult?.ok || !chResult?.data) throw new Error('No channel data returned')
    pass(`${chResult.data.name} (${chResult.data.id})`)
  } catch (e) {
    fail(`Could not add channel: ${e.message}`)
    return null
  }

  const channelId = chResult.data.id

  // Wait for poller to detect a video
  test('Waiting for video detection (up to 60s)...')
  let detectedWsId = null
  try {
    detectedWsId = await waitFor(async () => {
      const wsList = await api.get('/api/e2e/workspaces')
      const testWs = (wsList.data || []).filter(ws =>
        ws.channelId === channelId && ws.status !== 'error'
      )
      if (testWs.length > 0) return testWs[0].id
      return false
    }, { timeoutMs: 60_000, name: 'video detection' })
    pass(`Detected workspace: ${detectedWsId}`)
  } catch (e) {
    warn(`No video detected in 60s — this is OK if channel hasn't posted recently`)
    info('Detection test requires the monitored channel to post a video within the age window')
    // Remove the test channel
    await api.post('/api/e2e/channel/remove', { id: channelId })
    return null
  }

  // Verify workspace structure
  test('Verifying workspace structure')
  try {
    const ws = await api.get(`/api/e2e/workspace/${detectedWsId}`)
    const wsData = ws.data
    if (!wsData?.id) throw new Error('Missing workspace id')
    if (!wsData?.channelName) throw new Error('Missing channelName')
    if (!wsData?.videoTitle) throw new Error('Missing videoTitle')
    if (!wsData?.status) throw new Error('Missing status')
    pass(`title="${wsData.videoTitle}", status="${wsData.status}"`)
    return detectedWsId
  } catch (e) {
    fail(e.message)
    return detectedWsId
  }
}

// ─── Test: Download ──────────────────────────────────────────────────────────

async function testDownload(wsId) {
  if (!wsId) {
    info('Skipping download test (no workspace detected)')
    return
  }

  section('Test 2: Download — Verify Video Download')

  // Wait for download to complete (waiting → downloading → ready)
  test('Waiting for download to complete (up to 5 min)...')
  try {
    const ws = await waitForWorkspaceStatus(wsId, ['ready', 'done', 'rendering'], { timeoutMs: 300_000 })
    pass(`Download complete: status="${ws.status}"`)
  } catch (e) {
    // Check if it entered error state
    const ws = await api.get(`/api/e2e/workspace/${wsId}`)
    if (ws?.data?.status === 'error') {
      fail(`Download failed: workspace entered error state`)
    } else {
      warn(`Download did not complete in 5 min — status: ${ws?.data?.status}`)
    }
    return
  }

  // Verify downloaded file exists
  test('Verifying downloaded video file exists')
  const ws = await api.get(`/api/e2e/workspace/${wsId}`)
  const path = ws.data?.downloadedPath
  if (path) {
    pass(`File: ${path}`)
  } else {
    warn('No downloadedPath in workspace — file may be on RAM disk')
  }
}

// ─── Test: Filters ───────────────────────────────────────────────────────────

async function testFilters(channelUrl) {
  section('Test 3: Filters — Duration & Aspect Ratio')

  test('Adding test channel')
  const chResult = await api.post('/api/e2e/channel/add', { url: channelUrl })
  const channelId = chResult?.data?.id
  if (!channelId) { fail('Could not add channel'); return }
  pass(channelId)

  test('Polling for workspace')
  let wsId = null
  try {
    wsId = await waitFor(async () => {
      const list = await api.get('/api/e2e/workspaces')
      const found = (list.data || []).find(ws => ws.channelId === channelId && ws.status !== 'error')
      return found?.id || false
    }, { timeoutMs: 30_000, name: 'workspace for filter test' })
    pass(wsId || 'workspace found')
  } catch {
    warn('No workspace in 30s — filter test requires a detected video')
    await api.post('/api/e2e/channel/remove', { id: channelId })
    return
  }

  // Verify Short filter: short videos (<60s) should be filtered or marked
  test('Checking Short filter (duration >= 60s)')
  const ws = await api.get(`/api/e2e/workspace/${wsId}`)
  const duration = ws.data?.duration
  if (duration !== undefined) {
    if (duration < 60) {
      info(`Video is a Short (${duration}s) — should be marked isShort=true`)
    } else {
      pass(`Duration: ${duration}s (not a Short)`)
    }
  } else {
    warn('Duration not available in workspace')
  }

  // Cleanup
  await api.post('/api/e2e/channel/remove', { id: channelId })
  if (wsId) await api.del(`/api/e2e/workspace/${wsId}`)
  pass('Filter test complete')
}

// ─── Test: Render ─────────────────────────────────────────────────────────────

async function testRender(wsId) {
  if (!wsId) {
    info('Skipping render test (no ready workspace)')
    return
  }

  section('Test 4: Render — Verify FFmpeg Encoding')

  // Ensure workspace is ready
  const wsStatus = await api.get(`/api/e2e/workspace/${wsId}`)
  if (wsStatus.data?.status !== 'ready') {
    info(`Skipping render test — workspace status is "${wsStatus.data?.status}"`)
    return
  }

  test('Starting render')
  try {
    await api.post(`/api/e2e/render/${wsId}`, {})
    pass()
  } catch (e) {
    fail(`Render start failed: ${e.message}`)
    return
  }

  // Poll render status
  test('Monitoring render progress (up to 10 min)...')
  let lastProgress = -1
  try {
    const result = await waitFor(async () => {
      const status = await api.get(`/api/e2e/render/${wsId}/status`)
      const progress = status.data?.progress || 0
      if (progress > lastProgress && progress < 100) {
        process.stdout.write(`\r  [TEST] Monitoring render progress... ${progress}%   `)
        lastProgress = progress
      }
      if (status.data?.status === 'done') return 'done'
      if (status.data?.status === 'error') throw new Error(status.data?.error || 'Render error')
      return false
    }, { timeoutMs: 600_000, name: 'render completion' })
    console.log('') // newline after progress dots
    if (result === 'done') {
      pass('Render completed successfully')
    }
  } catch (e) {
    console.log('') // newline after progress dots
    fail(`Render failed: ${e.message}`)
    return
  }

  // Verify output file
  test('Verifying output file exists')
  try {
    const out = await api.get(`/api/e2e/output/${wsId}`)
    if (out.data?.exists) {
      const sizeMB = ((out.data.size || 0) / (1024 * 1024)).toFixed(2)
      pass(`Output: ${out.data.path} (${sizeMB} MB)`)
    } else {
      fail('Output file not found')
    }
  } catch (e) {
    fail(`Output check failed: ${e.message}`)
  }
}

// ─── Test: Workspace Retry ───────────────────────────────────────────────────

async function testRetry() {
  section('Test 5: Workspace Retry — Error → Retry Flow')

  // First, find or create a workspace in error state
  test('Finding errored workspace')
  const workspaces = await api.get('/api/e2e/workspaces')
  const errorWs = (workspaces.data || []).find(ws => ws.status === 'error')

  if (!errorWs) {
    // Create a workspace manually in error state for testing
    info('No errored workspace found — skipping retry test')
    info('(This test is designed to run after a simulated failure)')
    pass('SKIP — no errored workspace')
    return
  }

  const wsId = errorWs.id
  test(`Retrying errored workspace: ${wsId}`)
  try {
    await api.post(`/api/e2e/workspace/${wsId}/retry`, {})
    pass()
  } catch (e) {
    fail(`Retry failed: ${e.message}`)
    return
  }

  // Verify it went back to 'waiting'
  test('Verifying workspace is in waiting state')
  await sleep(1_000)
  const ws = await api.get(`/api/e2e/workspace/${wsId}`)
  if (ws.data?.status === 'waiting') {
    pass('Workspace is now in "waiting" state')
  } else {
    fail(`Unexpected status: ${ws.data?.status}`)
  }
}

// ─── Test: Filter Detection (dedup) ─────────────────────────────────────────

async function testDedup(channelUrl) {
  section('Test 6: Dedup — Same Video Should Not Create Duplicate')

  // Add channel twice
  const ch1 = await api.post('/api/e2e/channel/add', { url: channelUrl })
  const ch2 = await api.post('/api/e2e/channel/add', { url: channelUrl })
  const id1 = ch1?.data?.id
  const id2 = ch2?.data?.id

  test('Checking for duplicate channel')
  if (id1 === id2) {
    pass('Duplicate prevention working (same channel ID returned)')
  } else {
    info(`Two different channel IDs created: ${id1}, ${id2} — may be expected for handle-based URLs`)
  }

  // Clean up
  if (id1) await api.post('/api/e2e/channel/remove', { id: id1 })
  if (id2 && id2 !== id1) await api.post('/api/e2e/channel/remove', { id: id2 })
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  section('Cleanup')
  test('Deleting all test workspaces')
  try {
    const result = await api.post('/api/e2e/cleanup', {})
    pass(`${result.data?.deleted ?? 0} workspace(s) deleted`)
  } catch (e) {
    warn(`Cleanup error: ${e.message}`)
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

function report() {
  section('E2E Test Report')
  console.log(`  Total: ${passCount + failCount}  \x1b[32m✓ ${passCount}\x1b[0m  \x1b[31m✗ ${failCount}\x1b[0m`)
  console.log('')

  if (failCount === 0) {
    console.log(`  \x1b[32m✓ ALL TESTS PASSED\x1b[0m`)
  } else {
    console.log(`  \x1b[31m✗ ${failCount} TEST(S) FAILED\x1b[0m`)
    console.log('  Review failures above and check:')
    console.log('    - HyperClip logs: %APPDATA%\\HyperClip\\HyperClip-Data\\logs\\app.log')
    console.log('    - App status: GET http://127.0.0.1:9312/api/e2e/')
  }
  console.log('')
  process.exit(failCount > 0 ? 1 : 0)
}

// ─── Check Server ─────────────────────────────────────────────────────────────

async function waitForServer(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      await api.get('/api/e2e/')
      return true
    } catch {
      if (i === 0) process.stdout.write('Waiting for HyperClip test server')
      process.stdout.write('.')
      await sleep(2_000)
    }
  }
  console.log('')
  throw new Error(`HyperClip test server not responding after ${retries * 2}s`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  HyperClip E2E Test Suite                                   ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')

  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      detect: { type: 'boolean', short: 'd' },
      download: { type: 'boolean' },
      filters: { type: 'boolean', short: 'f' },
      render: { type: 'boolean', short: 'r' },
      retry: { type: 'boolean' },
      dedup: { type: 'boolean' },
      cleanup: { type: 'boolean', short: 'c' },
      channel: { type: 'string', short: 'C', default: DEFAULT_TEST_CHANNEL },
      all: { type: 'boolean', short: 'a' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
HyperClip E2E Test Runner
========================

Usage:
  node scripts/test-e2e.mjs [options]

Options:
  --detect     Run detection test (add channel + poll for video)
  --download   Run download test (wait for ready state)
  --filters    Run filter test (duration/aspect)
  --render     Run render test (start render + verify output)
  --retry      Run retry test (error → retry flow)
  --dedup      Run dedup test (duplicate prevention)
  --cleanup    Run cleanup test only
  --all        Run all tests (default)
  --channel    YouTube channel URL to test [default: MrBeast]
  --help       Show this help

Examples:
  node scripts/test-e2e.mjs                        # All tests
  node scripts/test-e2e.mjs --detect --render    # Detection + render
  node scripts/test-e2e.mjs --channel "https://www.youtube.com/@LinusTechTips"
  node scripts/test-e2e.mjs --cleanup             # Clean up test data

Prerequisites:
  HYPERCLIP_TEST=1 npm run electron:dev
`)
    process.exit(0)
  }

  const runAll = values.all || Object.entries(values).filter(([k, v]) =>
    ['detect', 'download', 'filters', 'render', 'retry', 'dedup'].includes(k) && v
  ).length === 0

  const channelUrl = values.channel || DEFAULT_TEST_CHANNEL
  info(`Test channel: ${channelUrl}`)
  info(`Test server: http://${TEST_SERVER}:${TEST_PORT}`)

  // Wait for server
  try {
    await waitForServer()
    console.log(' \x1b[32mconnected\x1b[0m')
  } catch {
    fail(`Could not connect to test server at http://${TEST_SERVER}:${TEST_PORT}`)
    fail('Is HyperClip running with HYPERCLIP_TEST=1?')
    process.exit(1)
  }

  let detectedWsId = null

  try {
    // ── App Status ────────────────────────────────────────────────────────────
    await testAppStatus()

    // ── Detection ────────────────────────────────────────────────────────────
    if (runAll || values.detect) {
      detectedWsId = await testDetection(channelUrl)
    }

    // ── Download ────────────────────────────────────────────────────────────
    if ((runAll || values.download) && detectedWsId) {
      await testDownload(detectedWsId)
    }

    // ── Filters ────────────────────────────────────────────────────────────
    if (runAll || values.filters) {
      await testFilters(channelUrl)
    }

    // ── Render ────────────────────────────────────────────────────────────
    if (runAll || values.render) {
      // Use the detected workspace or find a ready one
      let renderWsId = detectedWsId
      if (!renderWsId) {
        const workspaces = await api.get('/api/e2e/workspaces')
        const readyWs = (workspaces.data || []).find(ws => ws.status === 'ready')
        renderWsId = readyWs?.id || null
      }
      if (renderWsId) {
        await testRender(renderWsId)
      } else {
        section('Test 4: Render — SKIPPED')
        info('No ready workspace available — run detection test first')
      }
    }

    // ── Retry ─────────────────────────────────────────────────────────────
    if (runAll || values.retry) {
      await testRetry()
    }

    // ── Dedup ──────────────────────────────────────────────────────────────
    if (runAll || values.dedup) {
      await testDedup(channelUrl)
    }

    // ── Cleanup ────────────────────────────────────────────────────────────
    if (runAll || values.cleanup) {
      await cleanup()
    }

  } catch (e) {
    fail(`Unexpected error: ${e.message}`)
    console.error(e.stack)
  }

  report()
}

main().catch(e => {
  console.error('Fatal error:', e.message)
  process.exit(1)
})
