import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { experimentView, runSelectedScenario } from './experiment-service.mjs'

const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Укажите допустимый PORT.')
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/onest-cyrillic.woff2', ['onest-cyrillic.woff2', 'font/woff2']],
  ['/onest-latin.woff2', ['onest-latin.woff2', 'font/woff2']],
])

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  })
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body)
}

async function readRunInput(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return
  let body = ''
  for await (const chunk of req) {
    if (body.length + chunk.length > 1024) return
    body += chunk
  }
  try {
    return JSON.parse(body)
  } catch {
    return
  }
}

const server = createServer(async (req, res) => {
  try {
    const { host, origin } = req.headers
    if (!hosts.has(host)) return reply(res, 403, { error: 'Откройте приложение через локальный адрес.' })
    const path = new URL(req.url, `http://${host}`).pathname
    if (req.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path)
      return reply(res, 200, await readFile(new URL(`./public/${file}`, import.meta.url)), type)
    }
    if (req.method === 'GET' && path === '/api/experiment') {
      return reply(res, 200, experimentView())
    }
    if (req.method === 'POST' && path === '/api/run') {
      if (origin !== `http://${host}`) return reply(res, 403, { error: 'Запускайте прогон из приложения.' })
      const { status, body } = await runSelectedScenario(await readRunInput(req))
      return reply(res, status, body)
    }
    reply(res, 404, { error: 'Страница не найдена.' })
  } catch (error) {
    if (res.destroyed) return
    console.error(error.code ?? error.name)
    reply(res, 500, { error: 'Приложение не смогло обработать запрос.' })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`Фокус · http://127.0.0.1:${port}`))
