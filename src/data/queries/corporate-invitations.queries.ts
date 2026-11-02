import { getYandexMainRoutingConfig } from '../../app/feature-flags'
import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from './yandex-main.queries'
import { fetchWithTimeout } from './request-timeout'

export function corporateInvitationRequest(path:string,body?:object):Promise<Response> {
  const session=yandexAppSessionTransport()
  if (!session) return Promise.resolve(new Response(null,{status:401}))
  const queries=createYandexMainQueries(session.apiBaseUrl,session.sessionToken)
  return body===undefined?queries.read(path):queries.write(path,'POST',body)
}
export function corporateInvitationPreview(token:string):Promise<Response> {
  const config=getYandexMainRoutingConfig()
  if (!config) return Promise.reject(new Error('Приглашение временно недоступно.'))
  return fetchWithTimeout(globalThis.fetch,`${config.apiBaseUrl}/v1/corporate-invitations/preview`,{
    method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({token}),
  },15_000,'Не удалось проверить приглашение. Повторите попытку.')
}
