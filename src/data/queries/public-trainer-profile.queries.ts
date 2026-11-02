export function publicTrainerProfileQuery(publicId: string, apiBaseUrl: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/v1/trainers/${encodeURIComponent(publicId)}/public-profile`, { cache: 'no-store' })
}
