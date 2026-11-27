import { runSelectedScenario } from '../experiment-service.mjs'

function json(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

const maxBodySize = 1024

export async function POST(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json(403, { error: 'Запускайте прогон из приложения.' })
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return json(415, { error: 'Ожидается запрос в формате JSON.' })
  }
  if (Number(request.headers.get('content-length')) > maxBodySize) {
    return json(413, { error: 'Запрос слишком большой.' })
  }

  let input
  try {
    const body = await request.text()
    if (Buffer.byteLength(body) > maxBodySize) return json(413, { error: 'Запрос слишком большой.' })
    input = JSON.parse(body)
  } catch {
    return json(400, { error: 'Не удалось прочитать параметры прогона.' })
  }

  const { status, body } = await runSelectedScenario(input)
  return json(status, body)
}
