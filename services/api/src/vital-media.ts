const VITAL_MEDIA_PATH = /^vital-pro\/[a-z0-9][a-z0-9-]*\.(?:jpg|mp4)$/
const MAX_VITAL_MEDIA_BATCH = 32

export interface VitalMediaSigner {
  sign(path: string): Promise<string>
}

export function readVitalMediaRequest(body: unknown): { path: string } | undefined {
  if (typeof body !== 'object' || body === null || !('path' in body)) return undefined
  return typeof body.path === 'string' && VITAL_MEDIA_PATH.test(body.path)
    ? { path: body.path }
    : undefined
}

export function readVitalMediaBatchRequest(body: unknown): { paths: string[] } | undefined {
  if (typeof body !== 'object' || body === null || !('paths' in body) || !Array.isArray(body.paths)) {
    return undefined
  }
  const paths = body.paths
  if (
    paths.length < 1
    || paths.length > MAX_VITAL_MEDIA_BATCH
    || paths.some((path) => typeof path !== 'string' || !VITAL_MEDIA_PATH.test(path))
    || new Set(paths).size !== paths.length
  ) return undefined
  return { paths: paths as string[] }
}
