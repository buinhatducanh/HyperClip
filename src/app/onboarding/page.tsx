'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../lib/store'
import { ChromeSetupStep } from './steps/ChromeSetupStep'
import { ChannelsStep } from './steps/ChannelsStep'
import { ProjectsStep } from './steps/ProjectsStep'
import { QualityStep } from './steps/QualityStep'
import { CompleteStep } from './steps/CompleteStep'

export const dynamic = 'force-dynamic'

const STEPS = [
  { id: 'chrome', label: 'Chrome Setup', desc: 'Quyền truy cập YouTube' },
  { id: 'channels', label: 'Thêm Channels', desc: 'Theo dõi kênh' },
  { id: 'projects', label: 'GCP Projects', desc: 'OAuth quota dự phòng' },
  { id: 'quality', label: 'Tốc độ & Chất lượng', desc: 'Cấu hình detection' },
  { id: 'complete', label: 'Hoàn tất', desc: 'Sẵn sàng sử dụng' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const { settings, setSettings, initChannels } = useAppStore()

  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const [isLoaded, setIsLoaded] = useState(false)

  // Load current state — check what needs to be skipped
  useEffect(() => {
    const load = async () => {
      // Check settings
      const s = await ipc.getSettings() as any
      if (s?.onboardingComplete) {
        router.replace('/')
        return
      }

      // Check sessions (Chrome setup)
      const sessionStatus = await ipc.getSessionStatus() as any
      const sessions = sessionStatus?.sessions || []
      const readySessions = sessions.filter((s: any) => s.isConsented)
      if (readySessions.length > 0) {
        setCompletedSteps(prev => new Set([...prev, 'chrome']))
      }

      // Check channels
      await initChannels()
      const store = useAppStore.getState()
      if (store.channels.length > 0) {
        setCompletedSteps(prev => new Set([...prev, 'channels']))
      }

      // Check projects
      const projects = await ipc.getProjects() as any[]
      if (projects && projects.length > 0) {
        setCompletedSteps(prev => new Set([...prev, 'projects']))
      }

      // Apply settings to store
      if (s) setSettings(s)
      setIsLoaded(true)
    }
    load()
  }, [])

  const skipToStep = useCallback((stepId: string) => {
    const idx = STEPS.findIndex(s => s.id === stepId)
    if (idx >= 0) setCurrentStep(idx)
  }, [])

  const handleStepComplete = useCallback((stepId: string) => {
    setCompletedSteps(prev => new Set([...prev, stepId]))
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1)
    }
  }, [currentStep])

  const handleBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1)
  }, [currentStep])

  const handleComplete = useCallback(async () => {
    await ipc.updateSettings({ onboardingComplete: true } as any)
    setSettings({ ...settings, onboardingComplete: true } as any)
    router.replace('/')
  }, [settings, setSettings, router])

  const handleSkipWizard = useCallback(async () => {
    await ipc.updateSettings({ onboardingComplete: true } as any)
    router.replace('/')
  }, [router])

  if (!isLoaded) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0A0A0A',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid #1A1A1A',
          borderTopColor: '#00B4FF',
          animation: 'spin 1s linear infinite',
        }} />
      </div>
    )
  }

  const step = STEPS[currentStep]

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0,
        background: '#0A0A0A',
        display: 'flex',
        fontFamily: 'Inter, sans-serif',
        color: '#fff',
      }}>
        {/* Left panel — branding + progress */}
        <div style={{
          width: 280,
          background: '#0D0D0D',
          borderRight: '1px solid #1A1A1A',
          display: 'flex',
          flexDirection: 'column',
          padding: '40px 28px',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
            <div style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, #00B4FF 0%, #0066CC 100%)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10 8l6 4-6 4V8z" fill="white" />
              </svg>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              HyperClip
            </span>
          </div>

          {/* Welcome text */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
              Setup Wizard
            </div>
            <div style={{ fontSize: 11, color: '#444', lineHeight: 1.6 }}>
              Cài đặt trong 5 phút.<br />Theo dõi video mới tự động 24/7.
            </div>
          </div>

          {/* Step progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            {STEPS.map((s, i) => {
              const isActive = s.id === step.id
              const isDone = completedSteps.has(s.id) || i < currentStep
              const isCurrent = i === currentStep
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    // Can jump to any completed step or the current step
                    if (isDone || isCurrent) setCurrentStep(i)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: isActive ? '#111111' : 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 10px',
                    cursor: isDone || isCurrent ? 'pointer' : 'default',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {/* Step indicator */}
                  <div style={{
                    width: 24, height: 24,
                    borderRadius: '50%',
                    border: `2px solid ${isDone ? '#00FF88' : isCurrent ? '#00B4FF' : '#2A2A2A'}`,
                    background: isDone ? '#00FF8822' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: isDone ? '#00FF88' : isCurrent ? '#00B4FF' : '#333',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}>
                    {isDone ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="#00FF88" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    ) : i + 1}
                  </div>

                  {/* Step label */}
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 600,
                      color: isActive || isDone ? '#fff' : '#333',
                      lineHeight: 1.2,
                    }}>
                      {s.label}
                    </div>
                    <div style={{
                      fontSize: 9, color: isActive ? '#555' : '#2A2A2A',
                      marginTop: 1,
                    }}>
                      {s.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Skip button */}
          <button
            onClick={handleSkipWizard}
            style={{
              background: 'transparent', border: 'none',
              fontSize: 10, color: '#333', cursor: 'pointer',
              padding: '8px 0', marginTop: 24,
              textAlign: 'left',
            }}
          >
            Bỏ qua wizard →
          </button>
        </div>

        {/* Right panel — step content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Top bar */}
          <div style={{
            padding: '20px 40px',
            borderBottom: '1px solid #1A1A1A',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>
                Bước {currentStep + 1} / {STEPS.length}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
                {step.label}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Progress dots */}
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    width: i === currentStep ? 24 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i < currentStep ? '#00FF88' : i === currentStep ? '#00B4FF' : '#2A2A2A',
                    transition: 'all 0.3s',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Step content */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '40px',
            animation: 'slideIn 0.3s ease-out',
          }}>
            {step.id === 'chrome' && (
              <ChromeSetupStep
                onComplete={() => handleStepComplete('chrome')}
                onSkip={() => handleStepComplete('chrome')}
              />
            )}
            {step.id === 'channels' && (
              <ChannelsStep
                onComplete={() => handleStepComplete('channels')}
                onSkip={() => handleStepComplete('channels')}
                onBack={handleBack}
              />
            )}
            {step.id === 'projects' && (
              <ProjectsStep
                onComplete={() => handleStepComplete('projects')}
                onSkip={() => handleStepComplete('projects')}
                onBack={handleBack}
              />
            )}
            {step.id === 'quality' && (
              <QualityStep
                onComplete={() => handleStepComplete('quality')}
                onSkip={() => handleStepComplete('quality')}
                onBack={handleBack}
              />
            )}
            {step.id === 'complete' && (
              <CompleteStep
                onComplete={handleComplete}
                onBack={handleBack}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
