/**
 * Health Alert Checker — runs periodically to detect system health issues
 * and send notifications before customer notices problems.
 *
 * Alert conditions:
 * - Innertube dead: readySessions = 0
 * - OAuth quota low: any project < 10% remaining
 * - OAuth exhausted: all projects exhausted
 * - Download failed: 3+ consecutive failures
 * - Disk space low: free < 5GB
 * - No new videos: 24h since last detection
 */
import { IPC_CHANNELS } from '../ipc/channels.js';
import { getFreeDiskSpace } from './ramdisk.js';
import { getSessionManager } from './chrome_cookies.js';
import { getProjectManager } from './project_manager.js';
import { getAppStoreDir } from './paths.js';
// ─── State ───────────────────────────────────────────────────────────────────
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between repeat alerts
const sentAlerts = new Map(); // alertId → lastSent timestamp
// Track consecutive download failures
let consecutiveDownloadFails = 0;
// Track last video detection timestamp
let lastVideoDetectionMs = 0;
export function recordVideoDetected() {
    lastVideoDetectionMs = Date.now();
}
export function recordDownloadFail() {
    consecutiveDownloadFails++;
}
export function recordDownloadSuccess() {
    consecutiveDownloadFails = 0;
}
// ─── Check Functions ──────────────────────────────────────────────────────────
async function checkInnertubeHealth() {
    try {
        const sm = await getSessionManager();
        await sm.ensureInit();
        const sessions = sm.getSessions();
        const readyCount = sessions.filter(s => s.cookies?.SAPISID && s.cookies?.PSID && s.isConsented).length;
        if (readyCount === 0 && sessions.length > 0) {
            return {
                id: 'innertube_dead',
                severity: 'critical',
                category: 'innertube',
                message: 'All Chrome sessions failed — detection sẽ chuyển sang OAuth.',
                action: 'Đóng Chrome → Mở lại HyperClip → Đăng nhập lại Chrome profiles',
                timestamp: Date.now(),
            };
        }
    }
    catch { }
    return null;
}
async function checkOAuthQuota() {
    try {
        const pm = getProjectManager();
        const stats = pm.getStatus();
        if (stats.total === 0)
            return null;
        const totalQuota = stats.totalQuotaRemaining + stats.totalQuotaUsedToday;
        // All exhausted
        if (stats.exhausted === stats.total && stats.total > 0) {
            return {
                id: 'oauth_exhausted',
                severity: 'critical',
                category: 'oauth',
                message: `OAuth quota exhausted trên tất cả ${stats.total} projects.`,
                action: 'Thêm GCP projects mới từ Settings → Projects',
                timestamp: Date.now(),
            };
        }
        // Any project below 10%
        const remainingPercent = totalQuota > 0 ? (stats.totalQuotaRemaining / totalQuota) * 100 : 100;
        if (remainingPercent < 10 && remainingPercent > 0) {
            return {
                id: 'oauth_quota_low',
                severity: 'warning',
                category: 'oauth',
                message: `OAuth quota còn ${remainingPercent.toFixed(1)}% — sắp hết.`,
                action: 'Thêm GCP projects mới từ Settings → Projects',
                timestamp: Date.now(),
            };
        }
    }
    catch { }
    return null;
}
async function checkDiskSpace() {
    try {
        const storeDir = getAppStoreDir();
        const freeBytes = getFreeDiskSpace(storeDir);
        const freeGB = freeBytes / (1024 ** 3);
        if (freeGB < 5) {
            return {
                id: 'disk_space_low',
                severity: 'critical',
                category: 'storage',
                message: `Disk space còn ${freeGB.toFixed(1)} GB — nguy hiểm.`,
                action: 'Xóa video cũ từ Settings → Storage, hoặc thay đổi thư mục lưu trữ',
                timestamp: Date.now(),
            };
        }
    }
    catch { }
    return null;
}
async function checkDownloadFailures() {
    if (consecutiveDownloadFails >= 3) {
        return {
            id: 'download_failed',
            severity: 'warning',
            category: 'download',
            message: `Download thất bại ${consecutiveDownloadFails} lần liên tiếp.`,
            action: 'Kiểm tra kết nối mạng và trạng thái YouTube video',
            timestamp: Date.now(),
        };
    }
    return null;
}
async function checkNoNewVideos() {
    if (lastVideoDetectionMs === 0)
        return null; // Not enough data yet
    const hoursSinceLastDetection = (Date.now() - lastVideoDetectionMs) / (1000 * 60 * 60);
    if (hoursSinceLastDetection >= 24) {
        return {
            id: 'no_new_videos',
            severity: 'warning',
            category: 'detection',
            message: 'Không có video mới trong 24 giờ. Kiểm tra danh sách kênh.',
            action: 'Thêm kênh mới từ Dashboard hoặc kiểm tra Chrome sessions',
            timestamp: Date.now(),
        };
    }
    return null;
}
// ─── Main Check ──────────────────────────────────────────────────────────────
export async function checkHealthAlerts() {
    const checks = [
        checkInnertubeHealth,
        checkOAuthQuota,
        checkDiskSpace,
        checkDownloadFailures,
        checkNoNewVideos,
    ];
    const alerts = [];
    for (const check of checks) {
        const alert = await check();
        if (alert)
            alerts.push(alert);
    }
    return alerts;
}
// ─── Send Alerts to Renderer ─────────────────────────────────────────────────
export function sendHealthAlerts(alerts, window) {
    for (const alert of alerts) {
        const lastSent = sentAlerts.get(alert.id) || 0;
        if (Date.now() - lastSent < ALERT_COOLDOWN_MS)
            continue; // Still in cooldown
        sentAlerts.set(alert.id, Date.now());
        const type = alert.severity === 'critical' ? 'error' : 'warning';
        const fullMessage = alert.action
            ? `${alert.message}\n→ ${alert.action}`
            : alert.message;
        window.webContents.send(IPC_CHANNELS.NOTIFICATION_EVENT, {
            type,
            message: fullMessage,
            category: alert.category,
            alertId: alert.id,
            severity: alert.severity,
        });
    }
}
