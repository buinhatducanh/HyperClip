import type { Metadata } from 'next'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./globals.css')

export const metadata: Metadata = {
  title: 'HyperClip — Auto-Render',
  description: 'Auto-Render Vertical Video System (YouTube → TikTok/Reels)',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body>{children}</body>
    </html>
  )
}
