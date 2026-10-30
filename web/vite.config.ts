import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// /api, /sa-api, /plans.json, /webhook/wany-* -> n8n (default lokal; N8N_URL=https://kinasih.app.n8n.cloud untuk cloud).
// PUBLIC_URL (opsional, khusus dev): Origin diganti domain produksi supaya cek CSRF n8n meloloskan panel lokal.
const N8N = process.env.N8N_URL || 'http://localhost:5678'
const PUBLIC = process.env.PUBLIC_URL
const to = (path?: string): ProxyOptions => ({
  target: N8N,
  changeOrigin: true,
  ...(path ? { rewrite: () => path } : {}),
  configure: (proxy) => {
    if (PUBLIC) proxy.on('proxyReq', (req) => req.setHeader('origin', PUBLIC))
  },
})
const proxy = {
  '/api': to('/webhook/wany-api'),
  '/sa-api': to('/webhook/wany-sa'),
  '/plans.json': to('/webhook/wany-plans'),
  '^/webhook/wany-': to(),
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy },
  preview: { port: 5180, proxy },
})
