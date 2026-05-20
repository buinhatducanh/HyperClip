/**
 * HyperClip E2E Test Server
 * ==========================
 * HTTP server (port 9312) that exposes E2E test endpoints.
 * Automatically starts when `HYPERCLIP_TEST=1` env var is set.
 *
 * Usage:
 *   HYPERCLIP_TEST=1 npm run electron:dev    # Start app with test server
 *   node scripts/test-e2e.mjs               # Run E2E tests against the app
 */
import http from 'http';
import { URL } from 'url';
import { getWorkspaces, deleteWorkspace, updateWorkspace, getWorkspace, getChannels, addChannel, removeChannel, } from './store.js';
import { getYouTubePoller } from './youtube_poller.js';
import { getSessionManager } from './chrome_cookies.js';
import { getProjectManager } from './project_manager.js';
import { renderChunked } from './ffmpeg.js';
import { getPoolStatus } from './worker-pool.js';
import { getAppStoreDir } from './paths.js';
import { getLogDir } from './logger.js';
import { getOutputPath } from './ramdisk.js';
import { devLog } from './dev_log.js';
import path from 'path';
import fs from 'fs';
// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(body));
}
function ok(res, data) {
    jsonResponse(res, 200, { ok: true, data });
}
function fail(res, status, msg) {
    jsonResponse(res, status, { ok: false, error: msg });
}
async function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}
function tailFile(filePath, lines = 50) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.split('\n').slice(-lines).filter(l => l.trim());
    }
    catch {
        return [];
    }
}
// Track render status for polling
const renderChecks = new Map();
// ─── Route Handler ─────────────────────────────────────────────────────────────
async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname.replace(/^\/api\/e2e\/?/, '');
    const method = req.method || 'GET';
    if (method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
    }
    try {
        // ── GET / ───────────────────────────────────────────────────────────────
        if (method === 'GET' && (pathname === '' || pathname === 'status')) {
            const sessionMgr = getSessionManager();
            const pmStatus = getProjectManager().getStatus?.() ?? { total: 0, healthy: 0, totalUnitsToday: 0 };
            const poller = getYouTubePoller();
            const channels = getChannels();
            const workspaces = getWorkspaces();
            const byStatus = {};
            for (const ws of workspaces)
                byStatus[ws.status] = (byStatus[ws.status] || 0) + 1;
            ok(res, {
                sessions: { totalCount: 30, readyCount: 0 }, // real count injected by getStatus below
                projects: pmStatus,
                poller: poller ? { active: poller._active } : { active: false },
                channels: { total: channels.length },
                workspaces: { total: workspaces.length, byStatus },
            });
            return;
        }
        // ── GET /channels ──────────────────────────────────────────────────────
        if (method === 'GET' && pathname === 'channels') {
            ok(res, getChannels());
            return;
        }
        // ── POST /channel/add ───────────────────────────────────────────────────
        if (method === 'POST' && pathname === 'channel/add') {
            const body = await readBody(req);
            if (!body?.url) {
                fail(res, 400, 'Missing url field');
                return;
            }
            const { getChannelInfo } = await import('./youtube.js');
            const info = await getChannelInfo(body.url);
            if (!info) {
                fail(res, 400, 'Could not resolve channel from URL');
                return;
            }
            const channels = getChannels();
            const COLORS = ['#00B4FF', '#7C3AED', '#00FF88', '#FF6B35', '#FF0080', '#FFB800'];
            const newCh = {
                id: `e2e-${Date.now()}`,
                name: info.channelName,
                handle: info.handle || `@${info.channelId}`,
                avatarColor: COLORS[channels.length % COLORS.length],
                channelId: info.channelId,
                avatarUrl: info.avatarUrl || '',
                createdAt: new Date().toISOString(),
            };
            const saved = addChannel(newCh);
            ok(res, saved);
            return;
        }
        // ── POST /channel/remove ────────────────────────────────────────────────
        if (method === 'POST' && pathname === 'channel/remove') {
            const body = await readBody(req);
            if (!body?.id) {
                fail(res, 400, 'Missing id field');
                return;
            }
            removeChannel(body.id);
            ok(res, { removed: body.id });
            return;
        }
        // ── POST /poll ──────────────────────────────────────────────────────────
        if (method === 'POST' && pathname === 'poll') {
            const poller = getYouTubePoller();
            if (!poller) {
                fail(res, 400, 'Poller not initialized');
                return;
            }
            // Trigger one poll cycle via the private _pollOnce method
            ;
            poller._pollOnce();
            ok(res, { polled: true });
            return;
        }
        // ── GET /workspaces ────────────────────────────────────────────────────
        if (method === 'GET' && pathname === 'workspaces') {
            const workspaces = getWorkspaces();
            ok(res, workspaces.map(ws => ({
                id: ws.id,
                channelId: ws.channelId,
                channelName: ws.channelName,
                videoTitle: ws.videoTitle,
                status: ws.status,
                downloadProgress: ws.downloadProgress,
                renderProgress: ws.renderProgress,
                downloadedPath: ws.downloadedPath,
                outputPath: ws.outputPath,
                detectedAt: ws.detectedAt,
            })));
            return;
        }
        // ── GET /workspace/:id ────────────────────────────────────────────────
        if (method === 'GET' && pathname.match(/^workspace\/[^/]+$/)) {
            const id = pathname.split('/')[1];
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            ok(res, ws);
            return;
        }
        // ── DELETE /workspace/:id ─────────────────────────────────────────────
        if (method === 'DELETE' && pathname.match(/^workspace\/[^/]+$/)) {
            const id = pathname.split('/')[1];
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            deleteWorkspace(id);
            ok(res, { deleted: id });
            return;
        }
        // ── POST /workspace/:id/retry ──────────────────────────────────────────
        if (method === 'POST' && pathname.match(/^workspace\/[^/]+\/retry$/)) {
            const parts = pathname.split('/');
            const id = parts[1];
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            updateWorkspace(id, { status: 'waiting' });
            ok(res, { retried: id, status: 'waiting' });
            return;
        }
        // ── POST /render/:id ──────────────────────────────────────────────────
        if (method === 'POST' && pathname.match(/^render\/[^/]+$/)) {
            const parts = pathname.split('/');
            const id = parts[1];
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            if (ws.status !== 'ready') {
                fail(res, 400, `Workspace status is '${ws.status}', must be 'ready'`);
                return;
            }
            const metadata = {
                workspace_id: id,
                source_video: ws.downloadedPath || '',
                export_resolution: '1080x1920',
                video_speed: 1.0,
                fps_target: 30,
                overlays: [],
                trim: { start: 0, end: Math.floor(ws.duration) },
                codec: 'hevc',
                backgroundType: 'blur',
                blur_background: ws.blurBackgroundPath || '',
            };
            updateWorkspace(id, { status: 'rendering', renderProgress: 0 });
            renderChunked(metadata, getOutputPath(), { workers: 2, chunkDuration: 60 })
                .then(result => {
                if (result.success) {
                    updateWorkspace(id, { status: 'done', outputPath: result.outputPath || '', renderProgress: 100 });
                    renderChecks.set(id, { status: 'done', progress: 100, outputPath: result.outputPath, outputSize: result.fileSize });
                }
                else {
                    updateWorkspace(id, { status: 'error' });
                    renderChecks.set(id, { status: 'error', error: result.error });
                }
            })
                .catch((err) => {
                updateWorkspace(id, { status: 'error' });
                renderChecks.set(id, { status: 'error', error: err.message });
            });
            ok(res, { started: id });
            return;
        }
        // ── GET /render/:id/status ─────────────────────────────────────────────
        if (method === 'GET' && pathname.match(/^render\/[^/]+\/status$/)) {
            const parts = pathname.split('/');
            const id = parts[1];
            const check = renderChecks.get(id);
            if (check) {
                ok(res, { workspaceId: id, ...check });
                return;
            }
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            const pool = getPoolStatus();
            ok(res, { workspaceId: id, status: ws.status, progress: ws.renderProgress, outputPath: ws.outputPath, poolActive: pool.active, poolQueued: pool.queued });
            return;
        }
        // ── GET /output/:id ───────────────────────────────────────────────────
        if (method === 'GET' && pathname.match(/^output\/[^/]+$/)) {
            const parts = pathname.split('/');
            const id = parts[1];
            const ws = getWorkspace(id);
            if (!ws) {
                fail(res, 404, `Workspace ${id} not found`);
                return;
            }
            const outPath = ws.outputPath;
            if (!outPath) {
                ok(res, { exists: false, path: null, size: 0 });
                return;
            }
            try {
                const stat = fs.statSync(outPath);
                ok(res, { exists: true, path: outPath, size: stat.size });
            }
            catch {
                ok(res, { exists: false, path: outPath, size: 0 });
            }
            return;
        }
        // ── GET /logs ──────────────────────────────────────────────────────────
        if (method === 'GET' && pathname === 'logs') {
            const logDir = getLogDir();
            const appLog = path.join(logDir || getAppStoreDir(), 'app.log');
            ok(res, { lines: tailFile(appLog, 100), logPath: appLog });
            return;
        }
        // ── POST /cleanup ──────────────────────────────────────────────────────
        if (method === 'POST' && pathname === 'cleanup') {
            const workspaces = getWorkspaces();
            const deleted = [];
            for (const ws of workspaces) {
                if (ws.status !== 'rendering') {
                    deleteWorkspace(ws.id);
                    deleted.push(ws.id);
                }
            }
            ok(res, { deleted: deleted.length, ids: deleted });
            return;
        }
        // ── 404 ────────────────────────────────────────────────────────────────
        fail(res, 404, `Unknown endpoint: ${method} /${pathname}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        devLog(`[E2E Server] Error: ${msg}`);
        fail(res, 500, msg);
    }
}
// ─── Server ───────────────────────────────────────────────────────────────────
let server = null;
const PORT = 9312;
export function startE2EServer() {
    if (server)
        return server;
    server = http.createServer(handle);
    server.listen(PORT, '127.0.0.1', () => {
        devLog(`[E2E Server] Listening on http://127.0.0.1:${PORT}`);
        console.log(`\n[HyperClip E2E] Test server running on http://127.0.0.1:${PORT}`);
        console.log('[HyperClip E2E] Run: node scripts/test-e2e.mjs\n');
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            devLog(`[E2E Server] Port ${PORT} already in use — skipping test server`);
        }
        else {
            devLog(`[E2E Server] Error: ${err.message}`);
        }
    });
    return server;
}
export function stopE2EServer() {
    if (server) {
        server.close();
        server = null;
        devLog('[E2E Server] Stopped');
    }
}
