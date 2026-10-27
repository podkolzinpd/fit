import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from './yandex-main.queries'

export function corporateAdminRequest(path: 'access' | 'bundle' | 'offices' | 'trainers', body?: object): Promise<Response> {
  const transport = yandexAppSessionTransport()
  if (!transport) return Promise.resolve(new Response(null, { status: 401 }))
  const queries = createYandexMainQueries(transport.apiBaseUrl, transport.sessionToken)
  return body === undefined ? queries.read(`/v1/admin/${path}`) : queries.write(`/v1/admin/${path}`, 'PUT', body)
}
