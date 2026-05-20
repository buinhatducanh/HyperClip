import type { Metadata } from 'next'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./globals.css')

export const metadata: Metadata = {
  title: 'HyperClip — Auto-Render',
  description: 'Auto-Render Vertical Video System (YouTube → TikTok/Reels)',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body>{children}</body>
    </html>
  )
}
