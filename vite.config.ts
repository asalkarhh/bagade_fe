import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

function createApiProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/api': {
      target,
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on('error', (_err, _req, res) => {
          if (
            !res ||
            !('writeHead' in res) ||
            typeof res.writeHead !== 'function' ||
            res.headersSent ||
            res.writableEnded
          ) {
            return
          }
          res.writeHead(503, {
            'Content-Type': 'application/json',
          })
          res.end(
            JSON.stringify({
              code: 'BACKEND_UNAVAILABLE',
              message: 'Backend service is unavailable',
            }),
          )
        })
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://localhost:8080'
  const proxy = createApiProxy(proxyTarget)

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      port: 4173,
      proxy,
    },
  }
})
