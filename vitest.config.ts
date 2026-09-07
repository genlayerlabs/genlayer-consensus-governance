import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // the same alias vite.config.ts gives the app, so a unit under src/lib may
  // import its collaborators the way the app does
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
