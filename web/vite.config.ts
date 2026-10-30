import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api -> webhook Admin API; /webhook/wany-* (login Instagram) -> n8n (default lokal; N8N_URL=https://kinasih.app.n8n.cloud untuk cloud)
const N8N = process.env.N8N_URL || 'http://localhost:5678'
const proxy = {
  '/api': { target: N8N, changeOrigin: true, rewrite: () => '/webhook/wany-api' },
  '^/webhook/wany-': { target: N8N, changeOrigin: true },
}
const allowedHosts = ['autoreply.remot.in', 'localhost']

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy, allowedHosts },
  preview: { port: 5180, proxy, allowedHosts },
})
