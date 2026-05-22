"use strict";
/**
 * HyperClip Logger Service
 *
 * File-based logging with rotation (5MB per file, keep 5).
 * Also captures renderer errors via IPC.
 *
 * Usage: import { log } from './services/logger.js'
 *   log.info('message')
 *   log.warn('message')
 *   log.error('message', error)
 *   log.crash('crash reason', error)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.getLogDir = getLogDir;
exports.getSystemSnapshot = getSystemSnapshot;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const electron_1 = require("electron");
const paths_js_1 = require("./paths.js");
// electron-log is CommonJS
const el = require('electron-log');
const _log = el.default ?? el;
// Configure file transport
const logDir = getLogDir();
_log.transports.file.resolvePathFn = () => path_1.default.join(logDir, 'hyperclip.log');
_log.transports.file.maxSize = 2 * 1024 * 1024; // 2MB per file
_log.transports.file.archiveLogFn = (n) => `hyperclip.${n}.log`;
_log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
_log.transports.file.level = 'debug';
_log.transports.console.level = false; // we use console.log directly in dev
function getLogDir() {
    const dir = path_1.default.join((0, paths_js_1.getAppStoreDir)(), 'logs');
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
// Convenience wrappers matching console API
exports.log = {
    info: (msg, ...args) => {
        _log.info(msg, ...args);
        if (process.env.NODE_ENV === 'development') {
            console.log(`[LOG] ${msg}`, ...args);
        }
    },
    warn: (msg, ...args) => {
        _log.warn(msg, ...args);
        if (process.env.NODE_ENV === 'development') {
            console.warn(`[WARN] ${msg}`, ...args);
        }
    },
    error: (msg, ...args) => {
        _log.error(msg, ...args);
        if (process.env.NODE_ENV === 'development') {
            console.error(`[ERROR] ${msg}`, ...args);
        }
    },
    debug: (msg, ...args) => {
        _log.debug(msg, ...args);
        if (process.env.NODE_ENV === 'development') {
            console.log(`[DEBUG] ${msg}`, ...args);
        }
    },
    crash: (reason, err) => {
        const msg = `[CRASH] ${reason}`;
        _log.error(msg, err instanceof Error ? `${err.message}\n${err.stack}` : String(err ?? ''));
        if (process.env.NODE_ENV === 'development') {
            console.error(msg, err);
        }
    },
};
// Log system snapshot — useful for bug reports
function getSystemSnapshot() {
    return [
        `HyperClip Log Snapshot`,
        `Generated: ${new Date().toISOString()}`,
        `Platform: ${process.platform} ${os_1.default.arch()}`,
        `Node: ${process.version}`,
        `Electron: ${process.versions.electron}`,
        `App: ${electron_1.app.getName()} v${electron_1.app.getVersion()}`,
        `User: ${os_1.default.homedir()}`,
        `CPU: ${os_1.default.cpus()[0]?.model ?? 'unknown'}`,
        `CPU cores: ${os_1.default.cpus().length}`,
        `RAM total: ${Math.round(os_1.default.totalmem() / 1024 / 1024 / 1024)} GB`,
        `Uptime: ${Math.round(os_1.default.uptime() / 60)} min`,
        `PID: ${process.pid}`,
        `Log dir: ${getLogDir()}`,
    ].join('\n');
}
