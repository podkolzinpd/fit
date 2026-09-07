export type YandexMainHttpMethod = 'DELETE' | 'POST' | 'PUT'

export interface YandexMainQueries {
  read(path: string): Promise<Response>
  write(path: string, method: YandexMainHttpMethod, body?: object): Promise<Response>
}

function endpoint(apiBaseUrl: string, path: string): string {
  if (!path.startsWith('/v1/')) throw new Error('Некорректный путь Yandex API')
  return `${apiBaseUrl}${path}`
}

export function createYandexMainQueries(
  apiBaseUrl: string,
  sessionToken: string,
): YandexMainQueries {
  const sessionHeaders = { 'x-fit-session': sessionToken }
  return {
    read: (path) => fetch(endpoint(apiBaseUrl, path), {
      cache: 'no-store',
      headers: sessionHeaders,
    }),
    write: (path, method, body) => fetch(endpoint(apiBaseUrl, path), {
      method,
      cache: 'no-store',
      headers: body === undefined
        ? sessionHeaders
        : { ...sessionHeaders, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  }
}
