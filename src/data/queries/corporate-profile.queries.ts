import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from './yandex-main.queries'

export function corporateProfileRequest(trainerId: string, suffix = '', body?: object): Promise<Response> {
  const transport = yandexAppSessionTransport()
  if (!transport) return Promise.resolve(new Response(null, { status: 401 }))
  const queries = createYandexMainQueries(transport.apiBaseUrl, transport.sessionToken)
  const path = `/v1/admin/trainers/${encodeURIComponent(trainerId)}/profile${suffix}`
  return body === undefined ? queries.read(path) : queries.write(path, 'POST', body)
}
