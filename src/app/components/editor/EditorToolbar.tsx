'use client'

const TOOLS = [
  { id: 'select', label: 'SELECT', icon: '⊹' },
  { id: 'trim', label: 'TRIM', icon: '⟨⟩' },
  { id: 'text', label: 'TEXT', icon: 'T' },
  { id: 'image', label: 'IMAGE', icon: '▣' },
  { id: 'speed', label: 'SPEED', icon: '◷' },
]

interface Props {
  activeTool: string
  onToolChange: (tool: string) => void
}

export function EditorToolbar({ activeTool, onToolChange }: Props) {
  return (
    <div
      className="flex flex-col items-center gap-1 shrink-0"
      style={{
        width: 44,
        background: '#0D0D0D',
        borderRight: '1px solid #1A1A1A',
        padding: '8px 0',
      }}
    >
      {TOOLS.map((tool) => {
        const isActive = activeTool === tool.id
        return (
          <button
            key={tool.id}
            onClick={() => onToolChange(tool.id)}
            style={{
              width: 32,
              height: 32,
              background: isActive ? '#00B4FF15' : 'transparent',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: isActive ? '#00B4FF44' : 'transparent',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            title={tool.label}
          >
            <span
              style={{
                fontSize: 12,
                color: isActive ? '#00B4FF' : '#333',
                lineHeight: 1,
                fontFamily: 'monospace',
              }}
            >
              {tool.icon}
            </span>
            <span
              style={{
                fontSize: 6,
                color: isActive ? '#00B4FF66' : '#222',
                letterSpacing: '0.05em',
                marginTop: 1,
              }}
            >
              {tool.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}