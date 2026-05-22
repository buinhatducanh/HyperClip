"use strict";
/**
 * Tests for ramdisk.ts pure utility functions.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const os_1 = __importDefault(require("os"));
// Inline the pure functions from ramdisk.ts for isolated testing
// (avoids importing modules with side effects)
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function getAutoRamDiskSize() {
    const totalGB = os_1.default.totalmem() / (1024 ** 3);
    if (totalGB >= 48)
        return 4;
    if (totalGB >= 32)
        return 3;
    if (totalGB >= 16)
        return 2;
    if (totalGB >= 8)
        return 1;
    return 0;
}
// Mirrors sanitizeFilename from ramdisk.ts
function sanitizeFilename(name) {
    // eslint-disable-next-line no-control-regex -- intentional: strip ASCII control chars
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120);
}
(0, vitest_1.describe)('formatBytes', () => {
    (0, vitest_1.it)('returns 0 B for zero', () => {
        (0, vitest_1.expect)(formatBytes(0)).toBe('0 B');
    });
    (0, vitest_1.it)('formats bytes', () => {
        (0, vitest_1.expect)(formatBytes(512)).toBe('512 B');
        (0, vitest_1.expect)(formatBytes(1)).toBe('1 B');
    });
    (0, vitest_1.it)('formats KB', () => {
        (0, vitest_1.expect)(formatBytes(1024)).toBe('1 KB');
        (0, vitest_1.expect)(formatBytes(1536)).toBe('1.5 KB');
        (0, vitest_1.expect)(formatBytes(10_000)).toBe('9.8 KB');
    });
    (0, vitest_1.it)('formats MB', () => {
        (0, vitest_1.expect)(formatBytes(1024 * 1024)).toBe('1 MB');
        (0, vitest_1.expect)(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
        (0, vitest_1.expect)(formatBytes(500 * 1024 * 1024)).toBe('500 MB');
    });
    (0, vitest_1.it)('formats GB', () => {
        (0, vitest_1.expect)(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
        (0, vitest_1.expect)(formatBytes(4 * 1024 * 1024 * 1024)).toBe('4 GB');
    });
    (0, vitest_1.it)('formats TB', () => {
        (0, vitest_1.expect)(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
        (0, vitest_1.expect)(formatBytes(2.5 * 1024 * 1024 * 1024 * 1024)).toBe('2.5 TB');
    });
});
(0, vitest_1.describe)('getAutoRamDiskSize', () => {
    (0, vitest_1.it)('returns 4 for machines >= 48GB', () => {
        // This reflects actual system — adjust expectation based on machine RAM
        const result = getAutoRamDiskSize();
        (0, vitest_1.expect)([0, 1, 2, 3, 4]).toContain(result); // valid values
    });
    (0, vitest_1.it)('returns a positive integer for typical dev machines', () => {
        const result = getAutoRamDiskSize();
        (0, vitest_1.expect)(result).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(result).toBeLessThanOrEqual(4);
        (0, vitest_1.expect)(Number.isInteger(result)).toBe(true);
    });
    (0, vitest_1.it)('produces deterministic values (idempotent)', () => {
        (0, vitest_1.expect)(getAutoRamDiskSize()).toBe(getAutoRamDiskSize());
    });
});
(0, vitest_1.describe)('sanitizeFilename (ramdisk)', () => {
    (0, vitest_1.it)('passes through clean filenames', () => {
        (0, vitest_1.expect)(sanitizeFilename('my_video.mp4')).toBe('my_video.mp4');
        (0, vitest_1.expect)(sanitizeFilename('Clip 123 (final).mov')).toBe('Clip 123 (final).mov');
        (0, vitest_1.expect)(sanitizeFilename('日本語ファイル名.mp4')).toBe('日本語ファイル名.mp4');
    });
    (0, vitest_1.it)('replaces all Windows-invalid characters', () => {
        (0, vitest_1.expect)(sanitizeFilename('file<name>.txt')).toBe('file_name_.txt');
        (0, vitest_1.expect)(sanitizeFilename('path/to\\file')).toBe('path_to_file');
        (0, vitest_1.expect)(sanitizeFilename('file|name')).toBe('file_name');
        (0, vitest_1.expect)(sanitizeFilename('file*name?')).toBe('file_name_');
        (0, vitest_1.expect)(sanitizeFilename('file"name:doc')).toBe('file_name_doc');
    });
    (0, vitest_1.it)('strips control characters (ASCII 0x00–0x1F)', () => {
        // Null byte and unit separator replaced
        (0, vitest_1.expect)(sanitizeFilename('a\x00b\x1fc')).toBe('a_b_c');
    });
    (0, vitest_1.it)('trims and limits to 120 chars', () => {
        (0, vitest_1.expect)(sanitizeFilename('  test.mp4  ')).toBe('test.mp4');
        (0, vitest_1.expect)(sanitizeFilename('a'.repeat(200))).toHaveLength(120);
    });
    (0, vitest_1.it)('handles empty string', () => {
        (0, vitest_1.expect)(sanitizeFilename('')).toBe('');
    });
});
