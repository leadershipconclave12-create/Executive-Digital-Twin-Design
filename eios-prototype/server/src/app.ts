import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { api } from './api/routes.js'
import { errorHandler } from './api/middleware.js'
import './governance/audit.js' // register the audit event subscriber

export function createApp() {
  const app = express()
  // Behind a platform load balancer (Render/Fly/Railway), req.ip is the proxy unless we
  // trust it. Getting this wrong would make every remote request look like localhost and
  // silently defeat the access guard.
  app.set('trust proxy', true)
  app.use(cors())
  // Raw email exports arrive as text/plain; everything else as JSON.
  app.use(express.text({ type: ['text/plain', 'message/rfc822'], limit: '25mb' }))
  app.use(express.json({ limit: '25mb' }))
  app.use('/api', api)

  // In production serve the built UI from the same origin — one container, one port,
  // no CORS, no separate web server. In dev, Vite proxies to us instead.
  const webDist = resolve(process.cwd(), 'web/dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    // SPA fallback: anything that is not /api returns index.html.
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')))
  }

  app.use(errorHandler)
  return app
}
