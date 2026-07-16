import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web app calls the EIOS backend under /api. In dev, Vite proxies to the
// Express server (Vol 4 API tier). In prod the same path sits behind the gateway.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: false,
    proxy: {
      '/api': { target: 'http://localhost:4180', changeOrigin: true },
    },
  },
})
