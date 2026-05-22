"use strict";
/**
 * Tests for date/time parsing logic (parseRelativeDate).
 * This function is inlined here since it's not exported from youtube.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
function parseRelativeDate(relativeStr, now) {
    const minMatch = relativeStr.match(/(\d+)\s*min/i);
    if (minMatch)
        return now - parseInt(minMatch[1]) * 60 * 1000;
    const hourMatch = relativeStr.match(/(\d+)\s*hour/i);
    if (hourMatch)
        return now - parseInt(hourMatch[1]) * 60 * 60 * 1000;
    const dayMatch = relativeStr.match(/(\d+)\s*day/i);
    if (dayMatch)
        return now - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
    const weekMatch = relativeStr.match(/(\d+)\s*week/i);
    if (weekMatch)
        return now - parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
    const moMatch = relativeStr.match(/(\d+)\s*month/);
    if (moMatch)
        return now - parseInt(moMatch[1]) * 2_592_000_000;
    const yrMatch = relativeStr.match(/(\d+)\s*year/);
    if (yrMatch)
        return now - parseInt(yrMatch[1]) * 31_536_000_000;
    const iso = new Date(relativeStr).getTime();
    return isNaN(iso) ? 0 : iso;
}
const NOW = 1700000000000; // 2023-11-14 20:26:40 UTC
(0, vitest_1.describe)('parseRelativeDate', () => {
    (0, vitest_1.it)('parses minutes correctly', () => {
        const result = parseRelativeDate('5 minutes ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 5 * 60 * 1000);
    });
    (0, vitest_1.it)('parses single minute correctly', () => {
        const result = parseRelativeDate('1 minute ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 1 * 60 * 1000);
    });
    (0, vitest_1.it)('parses hours correctly', () => {
        const result = parseRelativeDate('3 hours ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 3 * 60 * 60 * 1000);
    });
    (0, vitest_1.it)('parses single hour correctly', () => {
        const result = parseRelativeDate('1 hour ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 60 * 60 * 1000);
    });
    (0, vitest_1.it)('parses days correctly', () => {
        const result = parseRelativeDate('2 days ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 2 * 24 * 60 * 60 * 1000);
    });
    (0, vitest_1.it)('parses weeks correctly', () => {
        const result = parseRelativeDate('1 week ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 7 * 24 * 60 * 60 * 1000);
    });
    (0, vitest_1.it)('parses months correctly (approx 30 days)', () => {
        const result = parseRelativeDate('2 months ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 2 * 2_592_000_000);
    });
    (0, vitest_1.it)('parses years correctly (approx 365 days)', () => {
        const result = parseRelativeDate('1 year ago', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 31_536_000_000);
    });
    (0, vitest_1.it)('parses ISO date strings', () => {
        const isoStr = '2024-01-15T12:00:00Z';
        const expected = new Date(isoStr).getTime();
        (0, vitest_1.expect)(parseRelativeDate(isoStr, NOW)).toBe(expected);
    });
    (0, vitest_1.it)('returns 0 for unparseable strings', () => {
        (0, vitest_1.expect)(parseRelativeDate('just now', NOW)).toBe(0);
        (0, vitest_1.expect)(parseRelativeDate('yesterday', NOW)).toBe(0);
        (0, vitest_1.expect)(parseRelativeDate('', NOW)).toBe(0);
    });
    // NOTE: 'streams in 10 minutes' matches the minutes regex (10 minutes)
    // because the regex /(\d+)\s*min/i only checks for the pattern, not the full string.
    // So it returns NOW - 10 minutes. This is the existing behavior.
    (0, vitest_1.it)('parses embedded minutes even in non-relative strings', () => {
        const result = parseRelativeDate('streams in 10 minutes', NOW);
        (0, vitest_1.expect)(result).toBe(NOW - 10 * 60 * 1000);
    });
    (0, vitest_1.it)('handles plural forms', () => {
        (0, vitest_1.expect)(parseRelativeDate('1 minute ago', NOW)).toBe(NOW - 60_000);
        (0, vitest_1.expect)(parseRelativeDate('2 minutes ago', NOW)).toBe(NOW - 120_000);
        (0, vitest_1.expect)(parseRelativeDate('1 hour ago', NOW)).toBe(NOW - 3_600_000);
        (0, vitest_1.expect)(parseRelativeDate('2 hours ago', NOW)).toBe(NOW - 7_200_000);
    });
});
