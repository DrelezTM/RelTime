import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import http from 'node:http'
import https from 'node:https'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_TARGET_URL || 'https://www.gapeka2025.com'
  const isHttps = target.startsWith('https')

  const agent = isHttps
    ? new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 })
    : new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 })

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
          agent,
          headers: {
            Connection: 'keep-alive',
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['connection'] = 'keep-alive'
            })
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
    worker: {
      format: 'es',
    },
  }
})

