"use strict";
/**
 * Tests for quota status derivation logic.
 * This mirrors the logic used in key_manager.ts and token_manager.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const MAX_UNITS = 9500;
const QUOTA_WARNING_PCT = 80;
function deriveKeyStatus(hasKey, usedToday, errors, projectStatus) {
    if (!hasKey)
        return 'no_key';
    if (projectStatus === 'unauthorized')
        return 'unauthorized';
    if (usedToday >= MAX_UNITS || projectStatus === 'exhausted')
        return 'exhausted';
    const quotaPercent = Math.round((usedToday / MAX_UNITS) * 100);
    if (quotaPercent >= QUOTA_WARNING_PCT)
        return 'warning';
    if (errors > 0)
        return 'error';
    return 'healthy';
}
(0, vitest_1.describe)('deriveKeyStatus', () => {
    (0, vitest_1.it)('returns no_key when apiKey is missing', () => {
        (0, vitest_1.expect)(deriveKeyStatus(false, 0, 0, 'healthy')).toBe('no_key');
    });
    (0, vitest_1.it)('returns unauthorized when project is unauthorized', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, 0, 0, 'unauthorized')).toBe('unauthorized');
    });
    (0, vitest_1.it)('returns exhausted when quota is 100%', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, MAX_UNITS, 0, 'healthy')).toBe('exhausted');
    });
    (0, vitest_1.it)('returns exhausted when projectStatus is exhausted', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, 0, 0, 'exhausted')).toBe('exhausted');
    });
    (0, vitest_1.it)('returns warning when quota is at 80pct', () => {
        const pct80 = Math.round(MAX_UNITS * 0.8);
        (0, vitest_1.expect)(deriveKeyStatus(true, pct80, 0, 'healthy')).toBe('warning');
    });
    (0, vitest_1.it)('returns warning when quota is above 80%', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, MAX_UNITS - 1, 0, 'healthy')).toBe('warning');
    });
    (0, vitest_1.it)('returns healthy when quota is below 80%', () => {
        const pct79 = Math.round(MAX_UNITS * 0.79);
        (0, vitest_1.expect)(deriveKeyStatus(true, pct79, 0, 'healthy')).toBe('healthy');
    });
    (0, vitest_1.it)('returns error when there are errors', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, 100, 1, 'healthy')).toBe('error');
    });
    (0, vitest_1.it)('prefers exhausted over warning', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, MAX_UNITS, 0, 'healthy')).toBe('exhausted');
    });
    (0, vitest_1.it)('prefers unauthorized over exhausted', () => {
        (0, vitest_1.expect)(deriveKeyStatus(true, MAX_UNITS, 0, 'unauthorized')).toBe('unauthorized');
    });
});
(0, vitest_1.describe)('quota thresholds', () => {
    (0, vitest_1.it)('75% of MAX_UNITS is a valid threshold', () => {
        const pct75 = Math.round(MAX_UNITS * 0.75);
        (0, vitest_1.expect)(pct75).toBe(Math.round(9500 * 0.75));
        (0, vitest_1.expect)(pct75).toBeLessThan(Math.round(MAX_UNITS * 0.8));
    });
    (0, vitest_1.it)('total quota of N projects is N * MAX_UNITS', () => {
        (0, vitest_1.expect)(10 * MAX_UNITS).toBe(95000);
        (0, vitest_1.expect)(200 * MAX_UNITS).toBe(1_900_000);
    });
    (0, vitest_1.it)('remaining units for N projects is N * MAX_UNITS - used', () => {
        const usedTotal = 5000;
        const remaining = 10 * MAX_UNITS - usedTotal;
        (0, vitest_1.expect)(remaining).toBe(90000);
    });
});
