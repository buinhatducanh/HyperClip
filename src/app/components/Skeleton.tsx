'use client'

// ─── Skeleton Pulse Animation (injected once via global style) ───────────────────
// App already has @keyframes in globals.css; add shimmer there if needed.
// For now we use a CSS-variable-based shimmer via inline style.

function Shimmer({ width = '100%', height = 14, radius = 3, style = {} }: {
  width?: string | number
  height?: string | number
  radius?: number
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: '#1A1A1A',
        animation: 'skeletonPulse 1.6s ease-in-out infinite',
        ...style,
      }}
    />
  )
}

// ─── Workspace Card Skeleton ─────────────────────────────────────────────────────

export function SkeletonCard() {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid #141414',
      transition: 'background 0.1s',
    }}>
      {/* Thumbnail */}
      <Shimmer width={48} height={36} radius={3} style={{ flexShrink: 0 }} />
      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
        <Shimmer width="85%" height={11} radius={2} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Shimmer width={36} height={9} radius={2} />
          <Shimmer width={28} height={9} radius={2} />
        </div>
      </div>
      {/* Status dot */}
      <Shimmer width={6} height={6} radius={3} style={{ alignSelf: 'center', flexShrink: 0 }} />
    </div>
  )
}

// ─── Workspace Queue Skeleton ───────────────────────────────────────────────────

export function SkeletonQueue() {
  return (
    <div style={{ flex: 1, overflow: 'hidden' }}>
      {/* Group header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', background: '#0F0F0F',
        borderBottom: '1px solid #181818',
      }}>
        <Shimmer width={6} height={6} radius={3} />
        <Shimmer width={48} height={10} radius={2} />
      </div>
      {/* Cards */}
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// ─── Channel Item Skeleton ──────────────────────────────────────────────────────

export function SkeletonChannelItem() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px',
    }}>
      <Shimmer width={24} height={24} radius={12} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <Shimmer width="70%" height={11} radius={2} />
      </div>
    </div>
  )
}

// ─── Editor Skeleton ─────────────────────────────────────────────────────────────

export function SkeletonEditor() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#121212' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingLeft: 16, paddingRight: 16, height: 40,
        borderBottom: '1px solid #1A1A1A', background: '#0D0D0D', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shimmer width={8} height={8} radius={2} />
          <Shimmer width={40} height={10} radius={2} />
          <div style={{ width: 1, height: 10, background: '#222' }} />
          <Shimmer width={180} height={11} radius={2} />
        </div>
      </div>

      {/* Body: canvas + controls */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas area */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#0A0A0A', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          {/* 9:16 video skeleton */}
          <div style={{
            width: '100%', maxWidth: 300, aspectRatio: '9/16',
            background: '#0D0D0D', borderRadius: 3,
            border: '1px solid #1A1A1A',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header zone */}
            <div style={{ flex: '0 0 20%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shimmer width={40} height={12} radius={3} />
            </div>
            {/* Video zone */}
            <div style={{ flex: '0 0 60%', background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Spinner */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.1)',
                borderTopColor: '#00B4FF',
                animation: 'spin 0.8s linear infinite',
              }} />
            </div>
            {/* Title zone */}
            <div style={{ flex: '0 0 20%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shimmer width={80} height={12} radius={3} />
            </div>
          </div>
          {/* Dimension badge */}
          <Shimmer width={64} height={10} radius={2} />
        </div>

        {/* Controls panel */}
        <div style={{ width: 280, borderLeft: '1px solid #1A1A1A', background: '#111', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden', padding: '0 12px' }}>
            {/* Section headers + content */}
            {['TRIM', 'TITLE', 'SPEED', 'BACKGROUND'].map((label, i) => (
              <div key={label} style={{ borderBottom: '1px solid #1A1A1A' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}>
                  <Shimmer width={11} height={11} radius={2} />
                  <Shimmer width={32} height={10} radius={2} />
                  <div style={{ flex: 1 }} />
                  <Shimmer width={10} height={10} radius={2} />
                </div>
                {/* Content */}
                {i === 0 && (
                  <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Shimmer width="100%" height={4} radius={2} />
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Shimmer width={40} height={10} radius={2} />
                      <Shimmer width={40} height={10} radius={2} />
                    </div>
                  </div>
                )}
                {i === 1 && (
                  <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Shimmer width="100%" height={36} radius={3} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Shimmer width="33%" height={26} radius={3} />
                      <Shimmer width="33%" height={26} radius={3} />
                      <Shimmer width="33%" height={26} radius={3} />
                    </div>
                  </div>
                )}
                {i === 2 && (
                  <div style={{ paddingBottom: 10 }}>
                    <Shimmer width="100%" height={28} radius={3} />
                  </div>
                )}
                {i === 3 && (
                  <div style={{ paddingBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Shimmer width="33%" height={26} radius={3} />
                      <Shimmer width="33%" height={26} radius={3} />
                      <Shimmer width="33%" height={26} radius={3} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Export button */}
          <div style={{ padding: 12, borderTop: '1px solid #1A1A1A' }}>
            <Shimmer width="100%" height={40} radius={3} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton Styles (add to globals.css) ──────────────────────────────────────
// This component injects the skeleton pulse keyframes via a style tag.
export function SkeletonStyles() {
  return (
    <style>{`
      @keyframes skeletonPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  )
}
