const LOCAL_SUPABASE_HOSTS = new Set(['127.0.0.1', 'localhost'])

export function assertSafeSupabaseUrl(url: string, isDevelopment: boolean): void {
  if (!isDevelopment) return

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new Error('VITE_SUPABASE_URL содержит некорректный URL')
  }

  if (!LOCAL_SUPABASE_HOSTS.has(hostname)) {
    throw new Error(
      'Локальная разработка может использовать только локальный Supabase (localhost или 127.0.0.1). Production подключается только через Vercel.',
    )
  }
}
