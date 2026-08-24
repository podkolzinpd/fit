export class SupabaseBridgeError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export interface SupabaseBridgeConfig {
  url: string
  publishableKey: string
  serviceRoleKey: string
}

export function readSupabaseBridgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseBridgeConfig | undefined {
  const url = environment.SUPABASE_URL?.trim()
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim()
    ?? environment.SUPABASE_ANON_KEY?.trim()
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !publishableKey || !serviceRoleKey) return undefined

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('SUPABASE_URL must be an HTTPS URL')
  }
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL must be an HTTPS URL')
  return { url: parsed.toString().replace(/\/$/, ''), publishableKey, serviceRoleKey }
}

type RequestOptions = {
  actorToken?: string
  body?: unknown
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'PATCH'
  serviceRole?: boolean
}

export class SupabaseBridge {
  constructor(private readonly config: SupabaseBridgeConfig, private readonly request = fetch) {}

  async authenticatedUserId(actorToken: string): Promise<string | undefined> {
    const response = await this.call('/auth/v1/user', { actorToken })
    if (!response.ok) return undefined
    const value = await response.json() as { id?: unknown }
    return typeof value.id === 'string' ? value.id : undefined
  }

  async select<T>(path: string, actorToken: string): Promise<T> {
    return this.json<T>(`/rest/v1/${path}`, { actorToken })
  }

  async rpc<T>(name: string, body: unknown, actorToken: string): Promise<T> {
    return this.json<T>(`/rest/v1/rpc/${name}`, { actorToken, body, method: 'POST' })
  }

  async service<T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
    return this.json<T>(`/rest/v1/${path}`, { body, method, serviceRole: true })
  }

  private async json<T>(path: string, options: RequestOptions): Promise<T> {
    const response = await this.call(path, options)
    if (!response.ok) throw new SupabaseBridgeError(response.status, 'supabase_request_failed')
    return await response.json() as T
  }

  private async call(path: string, options: RequestOptions): Promise<Response> {
    const key = options.serviceRole ? this.config.serviceRoleKey : this.config.publishableKey
    const authorization = options.actorToken === undefined
      ? `Bearer ${key}`
      : `Bearer ${options.actorToken}`
    try {
      return await this.request(`${this.config.url}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          apikey: key,
          authorization,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
    } catch {
      throw new SupabaseBridgeError(503, 'supabase_unavailable')
    }
  }
}
