import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: '/genlayer-consensus-governance/',
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          web3: ['viem'],
          markdown: ['react-markdown', 'rehype-sanitize'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
