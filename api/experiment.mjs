import { experimentView } from '../experiment-service.mjs'

export function GET() {
  return Response.json(experimentView(), { headers: { 'Cache-Control': 'no-store' } })
}
