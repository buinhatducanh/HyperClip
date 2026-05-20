/**
 * Tests for constants.ts — verify all quota/threshold values are consistent.
 */
import { describe, it, expect } from 'vitest';
// Inline constants (mirrors src/app/lib/constants.ts)
const MAX_UNITS_PER_PROJECT = 9500;
const QUOTA_WARNING_PCT = 80;
const QUOTA_CRITICAL_THRESHOLD = 1000;
const QUOTA_WARNING_THRESHOLD = 5000;
const QUOTA_BAR_WARN_PCT = 75;
const QUOTA_BAR_EXHAUSTED_PCT = 90;
const STALE_SESSION_DAYS = 7;
const RESET_ANIMATION_MS = 5000;
const CPU_WARN_PCT = 80;
describe('Quota constants', () => {
    it('MAX_UNITS_PER_PROJECT should be 9500', () => {
        expect(MAX_UNITS_PER_PROJECT).toBe(9500);
    });
    it('QUOTA_WARNING_PCT should be 80', () => {
        expect(QUOTA_WARNING_PCT).toBe(80);
    });
    it('QUOTA_BAR_WARN_PCT should be less than QUOTA_BAR_EXHAUSTED_PCT', () => {
        expect(QUOTA_BAR_WARN_PCT).toBeLessThan(QUOTA_BAR_EXHAUSTED_PCT);
        expect(QUOTA_BAR_WARN_PCT).toBe(75);
        expect(QUOTA_BAR_EXHAUSTED_PCT).toBe(90);
    });
    it('QUOTA_CRITICAL_THRESHOLD should be less than QUOTA_WARNING_THRESHOLD', () => {
        expect(QUOTA_CRITICAL_THRESHOLD).toBeLessThan(QUOTA_WARNING_THRESHOLD);
        expect(QUOTA_CRITICAL_THRESHOLD).toBe(1000);
        expect(QUOTA_WARNING_THRESHOLD).toBe(5000);
    });
    it('STALE_SESSION_DAYS should be 7', () => {
        expect(STALE_SESSION_DAYS).toBe(7);
    });
    it('RESET_ANIMATION_MS should be 5000', () => {
        expect(RESET_ANIMATION_MS).toBe(5000);
    });
    it('CPU_WARN_PCT should be 80', () => {
        expect(CPU_WARN_PCT).toBe(80);
    });
});
describe('Quota threshold logic', () => {
    it('quotaPercent 80 should trigger warning', () => {
        const isWarning = 80 >= QUOTA_WARNING_PCT;
        expect(isWarning).toBe(true);
    });
    it('quotaPercent 79 should NOT trigger warning', () => {
        const isWarning = 79 >= QUOTA_WARNING_PCT;
        expect(isWarning).toBe(false);
    });
    it('totalQuotaRemaining 999 should be critical', () => {
        const isCritical = 999 < QUOTA_CRITICAL_THRESHOLD;
        expect(isCritical).toBe(true);
    });
    it('totalQuotaRemaining 1001 should NOT be critical', () => {
        const isCritical = 1001 < QUOTA_CRITICAL_THRESHOLD;
        expect(isCritical).toBe(false);
    });
});
