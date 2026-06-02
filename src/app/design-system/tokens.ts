export const colors = {
  bg: '#0F0F12',
  surface: '#1A1A20',
  surfaceHover: '#242430',
  border: '#2A2A35',
  borderLight: '#1E1E28',
  borderHover: '#3A3A48',
  text: '#FFFFFF',
  textWhite: '#FFFFFF',
  textSecondary: '#A0A0B8',
  textTertiary: '#6A6A7A',
  accent: '#00B4FF',
  accentHover: '#0090CC',
  success: '#00FF88',
  successHover: '#00CC6E',
  warning: '#FFB800',
  warningHover: '#CC9300',
  error: '#FF4757',
  errorHover: '#CC3A47',
  sidebarBg: '#1A1A20',
  terminalBg: '#0F0F12',
} as const

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const

export const fontSize = {
  xs: 12, sm: 14, md: 16, lg: 18,
} as const

export type SpacingKey = keyof typeof spacing
export type FontSizeKey = keyof typeof fontSize

/** Resolve spacing prop to px value */
export function px(n: SpacingKey | number): number {
  return typeof n === 'number' ? n : spacing[n]
}
