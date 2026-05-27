'use client'

import { colors, spacing, fontSize } from './design-system/tokens'

/**
 * Custom error boundary — replaces Next.js built-in _error.tsx.
 * Without this, Next.js uses the default _error which imports <Html> from _document,
 * triggering "Html should not be imported outside of pages/_document" during build prerender.
 */
export default function ErrorPage({ error }: { error: Error }) {
  return (
    <div style={{ padding: '40px', color: colors.text, background: colors.bg, minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: colors.error }}>Error</h1>
      <pre style={{ color: colors.textSecondary, fontSize: '12px' }}>{error?.message || 'Unknown error'}</pre>
    </div>
  )
}
