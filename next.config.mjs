/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tauri serves a static export from `out/`. Output must be 'export'
  // so Next.js builds a single static bundle the Tauri file protocol
  // can load. `trailingSlash: true` is required for static export.
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
