export function aiFunctionsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.FIT_MEDIA_STORAGE_PROVIDER === 'cloudru') {
    return environment.FIT_AI_FUNCTIONS_ENABLED === 'true'
  }
  return environment.FIT_AI_FUNCTIONS_ENABLED !== 'false'
}
