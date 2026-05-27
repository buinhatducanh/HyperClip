export const colors = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceHover: '#F8F8F8',
  border: '#E0E0E0',
  borderLight: '#EAEAEA',
  borderHover: '#D0D0D0',
  text: '#1A1A1A',
  textSecondary: '#888888',
  textTertiary: '#AAAAAA',
  accent: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  sidebarBg: '#FFFFFF',
  terminalBg: '#1A1A1A',
} as const

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const

export const fontSize = {
  xs: 10, sm: 12, md: 14, lg: 16,
} as const

export type SpacingKey = keyof typeof spacing
export type FontSizeKey = keyof typeof fontSize

/** Resolve spacing prop to px value */
export function px(n: SpacingKey | number): number {
  return typeof n === 'number' ? n : spacing[n]
}
