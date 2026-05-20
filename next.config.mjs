/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Electron main.ts spawns Next.js directly: node_modules/.bin/next dev/start.
  // Prerender errors are expected for 'use client' pages with Zustand (useContext during SSR).
  // These pages are served dynamically at runtime.
  // electron-builder bundles .next/ directory — no standalone output needed.
}

export default nextConfig
