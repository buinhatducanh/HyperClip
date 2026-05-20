/**
 * Tests for quota status derivation logic.
 * This mirrors the logic used in key_manager.ts and token_manager.ts.
 */
import { describe, it, expect } from 'vitest';
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
describe('deriveKeyStatus', () => {
    it('returns no_key when apiKey is missing', () => {
        expect(deriveKeyStatus(false, 0, 0, 'healthy')).toBe('no_key');
    });
    it('returns unauthorized when project is unauthorized', () => {
        expect(deriveKeyStatus(true, 0, 0, 'unauthorized')).toBe('unauthorized');
    });
    it('returns exhausted when quota is 100%', () => {
        expect(deriveKeyStatus(true, MAX_UNITS, 0, 'healthy')).toBe('exhausted');
    });
    it('returns exhausted when projectStatus is exhausted', () => {
        expect(deriveKeyStatus(true, 0, 0, 'exhausted')).toBe('exhausted');
    });
    it('returns warning when quota is at 80pct', () => {
        const pct80 = Math.round(MAX_UNITS * 0.8);
        expect(deriveKeyStatus(true, pct80, 0, 'healthy')).toBe('warning');
    });
    it('returns warning when quota is above 80%', () => {
        expect(deriveKeyStatus(true, MAX_UNITS - 1, 0, 'healthy')).toBe('warning');
    });
    it('returns healthy when quota is below 80%', () => {
        const pct79 = Math.round(MAX_UNITS * 0.79);
        expect(deriveKeyStatus(true, pct79, 0, 'healthy')).toBe('healthy');
    });
    it('returns error when there are errors', () => {
        expect(deriveKeyStatus(true, 100, 1, 'healthy')).toBe('error');
    });
    it('prefers exhausted over warning', () => {
        expect(deriveKeyStatus(true, MAX_UNITS, 0, 'healthy')).toBe('exhausted');
    });
    it('prefers unauthorized over exhausted', () => {
        expect(deriveKeyStatus(true, MAX_UNITS, 0, 'unauthorized')).toBe('unauthorized');
    });
});
describe('quota thresholds', () => {
    it('75% of MAX_UNITS is a valid threshold', () => {
        const pct75 = Math.round(MAX_UNITS * 0.75);
        expect(pct75).toBe(Math.round(9500 * 0.75));
        expect(pct75).toBeLessThan(Math.round(MAX_UNITS * 0.8));
    });
    it('total quota of N projects is N * MAX_UNITS', () => {
        expect(10 * MAX_UNITS).toBe(95000);
        expect(200 * MAX_UNITS).toBe(1_900_000);
    });
    it('remaining units for N projects is N * MAX_UNITS - used', () => {
        const usedTotal = 5000;
        const remaining = 10 * MAX_UNITS - usedTotal;
        expect(remaining).toBe(90000);
    });
});
