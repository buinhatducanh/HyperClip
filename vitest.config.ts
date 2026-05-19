import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['electron/**/*.test.ts', 'electron/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/services/**/*.ts'],
      exclude: ['electron/services/**/*.d.ts'],
    },
  },
  resolve: {
    // Allow imports without .js extension (needed for tsconfig ESM settings)
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
})
