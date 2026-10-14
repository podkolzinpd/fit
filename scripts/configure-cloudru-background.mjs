import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCloudruApiEnv } from './check-cloudru-api-env.mjs'

export function backgroundEnvironment(api, push) {
  checkCloudruApiEnv(api)
  const fields = api.split('\n').filter(line => /^DATABASE_(HOST|PORT|NAME|USER|PASSWORD|SSL_MODE)=/.test(line))
  if (fields.length !== 6) throw new Error('cloudru_background_database_rejected')
  const entries = push.trimEnd().split('\n')
  if (entries.length !== 3 || ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .some(name => entries.filter(line => line.startsWith(name + '=')).length !== 1)
    || entries.some(line => !/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=[^\x00-\x20\x7f]+$/.test(line))) {
    throw new Error('cloudru_background_push_rejected')
  }
  return [...fields, 'FIT_MEDIA_STORAGE_PROVIDER=cloudru', ...entries].join('\n') + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const id = process.argv[2]
    if (process.getuid() !== 0 || !/^[0-9]+-[0-9]+$/.test(id ?? '')) throw new Error('rejected')
    const value = backgroundEnvironment(readFileSync('/opt/fit/secrets/api.env', 'utf8'),
      readFileSync(`/opt/fit/secrets/push-external-${id}.env`, 'utf8'))
    writeFileSync(`/opt/fit/secrets/background-next-${id}.env`, value, { mode: 0o600, flag: 'wx' })
  } catch { console.error('cloudru_background_configuration_failed'); process.exitCode = 1 }
}
