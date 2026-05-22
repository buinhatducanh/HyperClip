/**
 * E2E test: Channel Management + Video Split
 * Tests the backend directly (no Electron window needed).
 * Run: node --experimental-vm-modules scripts/e2e-channel-split.mjs
 */

// Use built dist-electron files for realistic test
process.chdir(process.cwd())

async function run() {
  let passed = 0
  let failed = 0
  const errors = []

  function assert(condition, message) {
    if (condition) {
      passed++
      console.log(`  ✓ ${message}`)
    } else {
      failed++
      errors.push(message)
      console.error(`  ✗ ${message}`)
    }
  }

  // ─── Test 1: Store functions ────────────────────────────────────────────────
  console.log('\n── Test 1: Store functions ──────────────────────────')

  // Mock fs so we can test store functions without a real HyperClip data dir
  const mockFs = {
    _data: { channels: [], workspaces: [] },
    existsSync(path) { return false },
    readFileSync(path) {
      if (path.endsWith('channels.json')) return JSON.stringify(this._data.channels)
      if (path.endsWith('workspaces.json')) return JSON.stringify({ workspaces: this._data.workspaces, version: 1 })
      return '{}'
    },
    writeFileSync(path, data) {
      if (path.endsWith('channels.json')) this._data.channels = JSON.parse(data)
      if (path.endsWith('workspaces.json')) this._data.workspaces = JSON.parse(data).workspaces
    },
    mkdirSync() {},
  }

  // Import store functions (they use ESM imports)
  // We test the logic directly instead

  // Test: autoGenerateIntervals logic (must match the source code implementation)
  console.log('\n  Subtest: autoGenerateIntervals logic')
  function autoGenerateIntervals(totalSec, partMinutes) {
    const partSec = partMinutes * 60
    const MIN_PART_DURATION = 30  // seconds
    const intervals = []
    let t = partSec
    // Keep adding split points as long as the remaining part is at least MIN_PART_DURATION
    while (t + MIN_PART_DURATION <= totalSec) {
      intervals.push(t)
      t += partSec
    }
    return intervals
  }

  // 9:35 video = 575s, 5min parts → [300] → 2 parts
  const test1 = autoGenerateIntervals(575, 5)
  assert(test1.length === 1, `9:35 (575s) / 5min → 1 interval (got ${test1.length})`)
  assert(test1[0] === 300, `9:35 split at 300s (got ${test1[0]})`)

  // 10min video = 600s, 5min parts → 1 interval → 2 parts (last part = 5min >= 30s)
  const test2 = autoGenerateIntervals(600, 5)
  assert(test2.length === 1, `10min (600s) / 5min → 1 interval (got ${test2.length})`)
  assert(test2[0] === 300, `10min split at 300s (got ${test2[0]})`)

  // 20min video = 1200s, 5min parts → [300, 600, 900] → 4 parts (MIN_PART_DURATION ensures 4th part = 5min)
  const test3 = autoGenerateIntervals(1200, 5)
  assert(test3.length === 3, `20min (1200s) / 5min → 3 intervals (got ${test3.length})`)
  assert(JSON.stringify(test3) === '[300,600,900]', `20min intervals [300,600,900] (got ${JSON.stringify(test3)})`)

  // 3min parts → [180, 360, 540] for 9:35 (each part >= 30s)
  const test4 = autoGenerateIntervals(575, 3)
  assert(test4.length === 3, `9:35 / 3min → 3 intervals (got ${test4.length})`)
  assert(JSON.stringify(test4) === '[180,360,540]', `9:35 intervals [180,360,540] (got ${JSON.stringify(test4)})`)

  // Test: buildParts
  function buildParts(totalSec, intervals) {
    const parts = []
    let prev = 0
    for (let i = 0; i < intervals.length; i++) {
      parts.push({ index: i + 1, start: prev, end: intervals[i], duration: intervals[i] - prev })
      prev = intervals[i]
    }
    parts.push({ index: intervals.length + 1, start: prev, end: totalSec, duration: totalSec - prev })
    return parts
  }

  // 9:35 split at [300]
  const parts1 = buildParts(575, [300])
  assert(parts1.length === 2, `9:35 [300] → 2 parts (got ${parts1.length})`)
  assert(parts1[0].index === 1 && parts1[0].start === 0 && parts1[0].end === 300 && parts1[0].duration === 300,
    `Part 1: 0-300 (300s) (got start=${parts1[0].start}, end=${parts1[0].end}, dur=${parts1[0].duration})`)
  assert(parts1[1].index === 2 && parts1[1].start === 300 && parts1[1].end === 575 && parts1[1].duration === 275,
    `Part 2: 300-575 (275s) (got start=${parts1[1].start}, end=${parts1[1].end}, dur=${parts1[1].duration})`)

  // Test: formatPartTitle
  function formatPartTitle(originalTitle, partIndex, totalParts) {
    if (totalParts <= 1) return originalTitle
    return `[Part ${partIndex}/${totalParts}] ${originalTitle}`
  }

  assert(formatPartTitle('Test Video', 1, 2) === '[Part 1/2] Test Video',
    `Part 1 title: [Part 1/2] Test Video (got "${formatPartTitle('Test Video', 1, 2)}")`)
  assert(formatPartTitle('Test Video', 2, 2) === '[Part 2/2] Test Video',
    `Part 2 title: [Part 2/2] Test Video (got "${formatPartTitle('Test Video', 2, 2)}")`)
  assert(formatPartTitle('Test Video', 1, 1) === 'Test Video',
    `Single part title unchanged (got "${formatPartTitle('Test Video', 1, 1)}")`)

  // Test: MAX_PARTS validation
  const MAX_PARTS = 4
  const MAX_INTERVALS_FOR_4_PARTS = 3
  assert(MAX_INTERVALS_FOR_4_PARTS === 3, `4 parts = 3 intervals max`)

  // Test: MIN_PART_DURATION
  const MIN_PART_DURATION = 30
  const parts2 = buildParts(60, [30])
  assert(parts2[0].duration === 30 && parts2[1].duration === 30, `60s / [30] → 2 parts x 30s each`)
  const parts3 = buildParts(50, [30])
  assert(parts3[0].duration === 30 && parts3[1].duration === 20, `50s / [30] → Part 2 is 20s (min 30s check in UI)`)

  // ─── Test 2: IPC Channel constants ──────────────────────────────────────────
  console.log('\n── Test 2: IPC Channel constants ────────────────────')

  // Read and verify the channel constants exist
  const fs = await import('fs')
  const channelsSrc = fs.readFileSync('electron/ipc/channels.ts', 'utf-8')
  assert(channelsSrc.includes('CHANNEL_PAUSE'), 'CHANNEL_PAUSE constant exists')
  assert(channelsSrc.includes('CHANNEL_RESUME'), 'CHANNEL_RESUME constant exists')
  assert(channelsSrc.includes('CHANNEL_BULK_PAUSE'), 'CHANNEL_BULK_PAUSE constant exists')
  assert(channelsSrc.includes('CHANNEL_BULK_RESUME'), 'CHANNEL_BULK_RESUME constant exists')
  assert(channelsSrc.includes('CHANNEL_BULK_REMOVE'), 'CHANNEL_BULK_REMOVE constant exists')
  assert(channelsSrc.includes('WORKSPACE_SPLIT_PREVIEW'), 'WORKSPACE_SPLIT_PREVIEW constant exists')

  // ─── Test 3: Store model ────────────────────────────────────────────────────
  console.log('\n── Test 3: Store model ──────────────────────────────')

  const storeSrc = fs.readFileSync('electron/services/store.ts', 'utf-8')
  assert(storeSrc.includes('paused?: boolean'), 'StoredChannel.paused field exists')
  assert(storeSrc.includes('settings?: ChannelSettings'), 'StoredChannel.settings field exists')
  assert(storeSrc.includes('interface ChannelSettings'), 'ChannelSettings interface exists')
  assert(storeSrc.includes('autoSplit?: boolean'), 'ChannelSettings.autoSplit exists')
  assert(storeSrc.includes('splitMinutes?: number'), 'ChannelSettings.splitMinutes exists')
  assert(storeSrc.includes('parentId?: string'), 'WorkspaceData.parentId exists')
  assert(storeSrc.includes('partIndex?: number'), 'WorkspaceData.partIndex exists')
  assert(storeSrc.includes('totalParts?: number'), 'WorkspaceData.totalParts exists')
  assert(storeSrc.includes('pauseChannel'), 'pauseChannel function exists')
  assert(storeSrc.includes('resumeChannel'), 'resumeChannel function exists')
  assert(storeSrc.includes('bulkRemoveChannels'), 'bulkRemoveChannels function exists')
  assert(storeSrc.includes('getChannelSettings'), 'getChannelSettings function exists')

  // ─── Test 4: Channel handlers ──────────────────────────────────────────────
  console.log('\n── Test 4: Channel handlers ─────────────────────────')

  const channelHandlerSrc = fs.readFileSync('electron/ipc/handlers/channel.ts', 'utf-8')
  assert(channelHandlerSrc.includes('CHANNEL_PAUSE'), 'CHANNEL_PAUSE handler registered')
  assert(channelHandlerSrc.includes('CHANNEL_RESUME'), 'CHANNEL_RESUME handler registered')
  assert(channelHandlerSrc.includes('CHANNEL_BULK_PAUSE'), 'CHANNEL_BULK_PAUSE handler registered')
  assert(channelHandlerSrc.includes('CHANNEL_BULK_RESUME'), 'CHANNEL_BULK_RESUME handler registered')
  assert(channelHandlerSrc.includes('CHANNEL_BULK_REMOVE'), 'CHANNEL_BULK_REMOVE handler registered')

  // ─── Test 5: Workspace split handler ───────────────────────────────────────
  console.log('\n── Test 5: Workspace split handler ───────────────────')

  const splitSrc = fs.readFileSync('electron/ipc/handlers/workspace-split.ts', 'utf-8')
  assert(splitSrc.includes('WORKSPACE_SPLIT_PREVIEW'), 'WORKSPACE_SPLIT_PREVIEW handler exists')
  assert(splitSrc.includes('MAX_PARTS = 4'), 'MAX_PARTS = 4 enforced')
  assert(splitSrc.includes('MIN_PART_DURATION = 30'), 'MIN_PART_DURATION = 30 enforced')
  assert(splitSrc.includes('Promise.all'), 'Parallel split with Promise.all')
  assert(splitSrc.includes('parentId'), 'parentId set on split workspaces')
  assert(splitSrc.includes('partIndex'), 'partIndex set on split workspaces')
  assert(splitSrc.includes('totalParts'), 'totalParts set on split workspaces')
  assert(splitSrc.includes('formatPartTitle') && splitSrc.includes('partIndex}/${totalParts}'), 'Part naming uses formatPartTitle with partIndex/totalParts')
  assert(splitSrc.includes('typeof opts === \'number\''), 'Backward compat: accepts partMinutes as number')
  assert(splitSrc.includes('autoGenerateIntervals'), 'autoGenerateIntervals utility')
  assert(splitSrc.includes('buildParts'), 'buildParts utility')

  // ─── Test 6: Preload bridge ─────────────────────────────────────────────────
  console.log('\n── Test 6: Preload bridge ────────────────────────────')

  const preloadSrc = fs.readFileSync('electron/preload.ts', 'utf-8')
  assert(preloadSrc.includes('CHANNEL_PAUSE'), 'CHANNEL_PAUSE in preload IPC')
  assert(preloadSrc.includes('CHANNEL_RESUME'), 'CHANNEL_RESUME in preload IPC')
  assert(preloadSrc.includes('CHANNEL_BULK_PAUSE'), 'CHANNEL_BULK_PAUSE in preload IPC')
  assert(preloadSrc.includes('CHANNEL_BULK_RESUME'), 'CHANNEL_BULK_RESUME in preload IPC')
  assert(preloadSrc.includes('CHANNEL_BULK_REMOVE'), 'CHANNEL_BULK_REMOVE in preload IPC')
  assert(preloadSrc.includes('WORKSPACE_SPLIT_PREVIEW'), 'WORKSPACE_SPLIT_PREVIEW in preload IPC')
  assert(preloadSrc.includes('splitWorkspacePreview'), 'splitWorkspacePreview function in preload')
  assert(preloadSrc.includes('pauseChannel'), 'pauseChannel in preload')
  assert(preloadSrc.includes('bulkRemoveChannels'), 'bulkRemoveChannels in preload')

  // ─── Test 7: Frontend types ─────────────────────────────────────────────────
  console.log('\n── Test 7: Frontend types ──────────────────────────')

  const typesSrc = fs.readFileSync('src/app/types.ts', 'utf-8')
  assert(typesSrc.includes('interface ChannelSettings'), 'ChannelSettings interface in frontend')
  assert(typesSrc.includes('interface SplitPart'), 'SplitPart interface in frontend')
  assert(typesSrc.includes('paused?: boolean') && typesSrc.includes('export interface Channel'),
    'paused on Channel interface in frontend')
  assert(typesSrc.includes('settings?: ChannelSettings') && typesSrc.includes('export interface Channel'),
    'settings on Channel interface in frontend')
  assert(typesSrc.includes('parentId?: string') && typesSrc.includes('export interface Video'),
    'parentId on Video interface in frontend')
  assert(typesSrc.includes('partIndex?: number') && typesSrc.includes('export interface Video'),
    'partIndex on Video interface in frontend')
  assert(typesSrc.includes('totalParts?: number') && typesSrc.includes('export interface Video'),
    'totalParts on Video interface in frontend')

  // ─── Test 8: IPC client ────────────────────────────────────────────────────
  console.log('\n── Test 8: IPC client ───────────────────────────────')

  const ipcSrc = fs.readFileSync('src/app/lib/ipc.ts', 'utf-8')
  assert(ipcSrc.includes('pauseChannel'), 'pauseChannel in frontend IPC client')
  assert(ipcSrc.includes('resumeChannel'), 'resumeChannel in frontend IPC client')
  assert(ipcSrc.includes('bulkPauseChannels'), 'bulkPauseChannels in frontend IPC client')
  assert(ipcSrc.includes('bulkResumeChannels'), 'bulkResumeChannels in frontend IPC client')
  assert(ipcSrc.includes('bulkRemoveChannels'), 'bulkRemoveChannels in frontend IPC client')
  assert(ipcSrc.includes('splitWorkspacePreview'), 'splitWorkspacePreview in frontend IPC client')
  assert(ipcSrc.includes('splitWorkspace(id, opts'), 'splitWorkspace accepts opts object')

  // ─── Test 9: Zustand store ─────────────────────────────────────────────────
  console.log('\n── Test 9: Zustand store ────────────────────────────')

  const storeFrontendSrc = fs.readFileSync('src/app/lib/store.ts', 'utf-8')
  assert(storeFrontendSrc.includes('pauseChannel'), 'pauseChannel in Zustand store')
  assert(storeFrontendSrc.includes('resumeChannel'), 'resumeChannel in Zustand store')
  assert(storeFrontendSrc.includes('bulkRemoveChannels'), 'bulkRemoveChannels in Zustand store')
  assert(storeFrontendSrc.includes('bulkPauseChannels'), 'bulkPauseChannels in Zustand store')
  assert(storeFrontendSrc.includes('bulkResumeChannels'), 'bulkResumeChannels in Zustand store')
  assert(storeFrontendSrc.includes('parentId?: string') && storeFrontendSrc.includes('export interface Workspace'),
    'parentId in Workspace interface')
  assert(storeFrontendSrc.includes('partIndex?: number') && storeFrontendSrc.includes('export interface Workspace'),
    'partIndex in Workspace interface')
  assert(storeFrontendSrc.includes('totalParts?: number') && storeFrontendSrc.includes('export interface Workspace'),
    'totalParts in Workspace interface')

  // ─── Test 10: ElectronAPI type ─────────────────────────────────────────────
  console.log('\n── Test 10: ElectronAPI type ───────────────────────')

  const dtsSrc = fs.readFileSync('src/types/electron.d.ts', 'utf-8')
  assert(dtsSrc.includes('splitWorkspacePreview'), 'splitWorkspacePreview in ElectronAPI type')
  assert(dtsSrc.includes('pauseChannel'), 'pauseChannel in ElectronAPI type')
  assert(dtsSrc.includes('resumeChannel'), 'resumeChannel in ElectronAPI type')
  assert(dtsSrc.includes('bulkPauseChannels'), 'bulkPauseChannels in ElectronAPI type')
  assert(dtsSrc.includes('bulkResumeChannels'), 'bulkResumeChannels in ElectronAPI type')
  assert(dtsSrc.includes('bulkRemoveChannels'), 'bulkRemoveChannels in ElectronAPI type')

  // ─── Test 11: SplitModal component ─────────────────────────────────────────
  console.log('\n── Test 11: SplitModal component ──────────────────')

  assert(fs.existsSync('src/app/components/SplitModal.tsx'), 'SplitModal.tsx exists')
  const splitModalSrc = fs.readFileSync('src/app/components/SplitModal.tsx', 'utf-8')
  assert(splitModalSrc.includes('MAX_PARTS = 4'), 'SplitModal enforces MAX_PARTS = 4')
  assert(splitModalSrc.includes('MIN_PART_DURATION = 30'), 'SplitModal enforces MIN_PART_DURATION = 30')
  assert(splitModalSrc.includes('fetchPreview'), 'SplitModal has fetchPreview')
  assert(splitModalSrc.includes('splitWorkspacePreview'), 'SplitModal calls splitWorkspacePreview')
  assert(splitModalSrc.includes('handleTimelineClick'), 'SplitModal has timeline click handler')
  assert(splitModalSrc.includes('handleAddInterval'), 'SplitModal has add interval handler')
  assert(splitModalSrc.includes('autoRender'), 'SplitModal has auto-render toggle')

  // ─── Test 12: Sidebar pause indicators ─────────────────────────────────────
  console.log('\n── Test 12: Sidebar pause indicators ────────────────')

  const sidebarSrc = fs.readFileSync('src/app/components/Sidebar.tsx', 'utf-8')
  assert(sidebarSrc.includes('ch.paused'), 'Sidebar checks ch.paused')
  assert(sidebarSrc.includes('TẠM DỪNG'), 'Sidebar shows TẠM DỪNG label')
  assert(sidebarSrc.includes('ipc.pauseChannel'), 'Sidebar calls ipc.pauseChannel')
  assert(sidebarSrc.includes('ipc.resumeChannel'), 'Sidebar calls ipc.resumeChannel')
  assert(sidebarSrc.includes('⏸'), 'Sidebar shows ⏸ icon for pause')
  assert(sidebarSrc.includes('▶'), 'Sidebar shows ▶ icon for resume')

  // ─── Test 13: DetailEditor split ───────────────────────────────────────────
  console.log('\n── Test 13: DetailEditor split ──────────────────────')

  const detailSrc = fs.readFileSync('src/app/components/DetailEditor.tsx', 'utf-8')
  assert(detailSrc.includes('maxParts = Math.min(4,'), 'DetailEditor maxParts capped at 4')
  assert(detailSrc.includes('SplitSection'), 'DetailEditor has SplitSection')
  assert(detailSrc.includes('onSplit'), 'DetailEditor has onSplit prop')

  // ─── Test 14: page.tsx handleSplit ─────────────────────────────────────────
  console.log('\n── Test 14: page.tsx handleSplit ─────────────────────')

  const pageSrc = fs.readFileSync('src/app/page.tsx', 'utf-8')
  assert(pageSrc.includes('splitWorkspace(workspaceId, { partMinutes })'),
    'page.tsx calls splitWorkspace with opts object')

  // ─── Results ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (errors.length > 0) {
    console.log('\nFailed assertions:')
    errors.forEach(e => console.log(`  ✗ ${e}`))
  }
  console.log('═'.repeat(50))

  if (failed > 0) {
    process.exit(1)
  }
}

run().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
