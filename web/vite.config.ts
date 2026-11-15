import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/live-camera': { target: process.env.LIVE_BRIDGE_URL || 'http://127.0.0.1:8791', rewrite: path => path.replace(/^\/live-camera/, '') || '/' },
      '/library': {
        target: process.env.LIBRARY_URL || 'http://127.0.0.1:8788',
        rewrite: (path) => path.replace(/^\/library/, '') || '/',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
