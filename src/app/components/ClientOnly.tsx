'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * Prevents children from rendering during SSR prerender.
 * Use this to wrap components that use Zustand stores (useContext fails in SSR).
 *
 * During prerender: renders null (children never execute).
 * During client hydration: renders children after mount.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  return mounted ? <>{children}</> : <>{fallback}</>
}
