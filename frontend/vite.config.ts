/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.BID_API_BASE || 'http://localhost:8090',
        changeOrigin: true,
      },
      '/ws': { target: process.env.BID_WS_BASE || 'ws://localhost:8091', ws: true },
      '/openapi.json': { target: process.env.BID_API_BASE || 'http://localhost:8090' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{spec,test}.ts'],
  },
})
