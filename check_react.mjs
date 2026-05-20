import { create } from './node_modules/zustand/vanilla/index.js'

const store = create((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}))

console.log('Vanilla store created:', typeof store.getState)
console.log('State:', store.getState())
