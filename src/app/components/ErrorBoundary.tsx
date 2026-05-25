'use client'
import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 16, background: '#0A0A0A', minHeight: '100vh',
          padding: 32,
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700 }}>Lỗi giao diện</div>
          <div style={{ fontSize: 12, color: '#666', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message || 'Đã xảy ra lỗi không xác định'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, padding: '8px 20px', background: '#00B4FF', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
            }}
          >
            Tải lại trang
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
