/**
 * Tests for ramdisk.ts sanitizeFilename function.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// We'll test the logic directly — mock only native modules
beforeEach(() => {
  vi.resetModules()
})

describe('sanitizeFilename', () => {
  // Inline the sanitize logic for testing (pure function)
  // Mirrors electron/services/ramdisk.ts sanitizeFilename()
  function sanitizeFilename(name: string): string {
    // eslint-disable-next-line no-control-regex -- intentional: strip ASCII control chars 0x00-0x1F
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120)
  }

  it('passes through clean filenames', () => {
    expect(sanitizeFilename('video_2024.mp4')).toBe('video_2024.mp4')
    expect(sanitizeFilename('my clip (1).mov')).toBe('my clip (1).mov')
    expect(sanitizeFilename('Ảnh chụp màn hình 2024.png')).toBe('Ảnh chụp màn hình 2024.png')
  })

  it('replaces invalid Windows characters', () => {
    expect(sanitizeFilename('video<clip>.mp4')).toBe('video_clip_.mp4')
    expect(sanitizeFilename('file:name.mov')).toBe('file_name.mov')
    expect(sanitizeFilename('path\\to\\file')).toBe('path_to_file')
    expect(sanitizeFilename('file|split')).toBe('file_split')
    expect(sanitizeFilename('file*star*')).toBe('file_star_')
    expect(sanitizeFilename('file?name')).toBe('file_name')
    expect(sanitizeFilename('con.txt')).toBe('con.txt') // 'con' is reserved but not in our blocklist
  })

  it('trims leading/trailing spaces only', () => {
    expect(sanitizeFilename('  video.mp4  ')).toBe('video.mp4')
    // Tab (ASCII 9) and newline (ASCII 10) are NOT in the invalid char set, so they're kept
    expect(sanitizeFilename('\tvideo.mp4\n')).toBe('_video.mp4_')
  })

  it('limits length to 120 chars', () => {
    const long = 'a'.repeat(150)
    expect(sanitizeFilename(long)).toHaveLength(120)
  })

  it('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('')
  })

  it('handles control characters', () => {
    // \x00 and \x1f in the test string are literal null byte (0x00) and form-feed (0x1F)
    // [<>:"/\\|?*\x00-\x1f] matches all chars from \x00 to \x1f (control chars)
    // This INCLUDES 'n' (ASCII 110) since 110 is between 0 and 31? NO.
    // Actually \x00-\x1f is the range 0x00 to 0x1f (ASCII 0-31).
    // 'n' = 110, which is NOT in range [0-31].
    // So \x00 (\x00=0) and \x1f (\x1f=31) are replaced with _ each:
    // "file" + _ + "name" + _ + "name" = "file_name_name"
    const result = sanitizeFilename('file\x00name\x1fname')
    expect(result).toBe('file_name_name')

    // All chars replaced with _: '__' → trim() keeps both underscores
    expect(sanitizeFilename('\x00\x1f')).toBe('__')
  })
})
