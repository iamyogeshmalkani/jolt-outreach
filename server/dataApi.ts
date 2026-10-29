import type { Plugin } from 'vite'
import type { IncomingMessage } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Same folder the Python script writes to. Override with JOLT_OUT_DIR.
const outDir = () => process.env.JOLT_OUT_DIR || path.join(os.homedir(), 'jolt_outreach')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir(), file), 'utf8')) as T
  } catch {
    return fallback
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 5_000_000) reject(new Error('Body too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function dataApi(): Plugin {
  return {
    name: 'jolt-data-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const send = (code: number, payload: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.url === '/data' && req.method === 'GET') {
            return send(200, {
              dir: outDir(),
              people: readJson('people.json', []),
            })
          }
          if (req.url === '/state' && req.method === 'GET') {
            return send(200, readJson('ui_state.json', null))
          }
          if (req.url === '/state' && req.method === 'PUT') {
            const parsed = JSON.parse(await readBody(req))
            fs.mkdirSync(outDir(), { recursive: true })
            const target = path.join(outDir(), 'ui_state.json')
            fs.writeFileSync(target + '.tmp', JSON.stringify(parsed, null, 1))
            fs.renameSync(target + '.tmp', target)
            return send(200, { ok: true })
          }
          send(404, { error: 'Unknown route' })
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : 'Server error' })
        }
      })
    },
  }
}
