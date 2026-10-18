import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { compressAssets } from './build/compress.mjs'

export default defineConfig({
  plugins: [react(), compressAssets()],
  build: { manifest: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/assets/ppt': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
    },
  },
})
