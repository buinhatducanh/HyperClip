/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Disable static page generation — Electron runs `next start` (fully dynamic server)
  // Pages use Zustand which calls useContext (not available during SSR prerender)
  // Setting output manual + force-dynamic on all pages prevents prerender attempts
  output: 'standalone',
}

export default nextConfig
