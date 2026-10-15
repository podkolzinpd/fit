export function publicTrainerProfileQuery(publicId: string, apiBaseUrl: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/v1/trainers/${encodeURIComponent(publicId)}/public-profile`)
}

export async function localPublicTrainerProfileQuery(publicId: string) {
  if (import.meta.env.MODE !== 'development' && import.meta.env.MODE !== 'test') {
    throw new Error('Устаревший источник данных недоступен в этой сборке.')
  }
  const { supabase } = await import('./client')
  return supabase.rpc('get_public_trainer_profile', { p_public_id: publicId })
}
