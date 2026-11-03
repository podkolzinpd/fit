import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from './yandex-main.queries'

export async function corporateServiceRequest(path: string, body?: object): Promise<Response> {
  const session = yandexAppSessionTransport()
  if (!session) return new Response(null, { status: 401 })
  const queries = createYandexMainQueries(session.apiBaseUrl, session.sessionToken)
  try { return await (body === undefined ? queries.read(path) : queries.write(path, 'POST', body)) }
  catch { throw new Error('Не удалось связаться с сервером. Ввод сохранён — повторите попытку.') }
}
