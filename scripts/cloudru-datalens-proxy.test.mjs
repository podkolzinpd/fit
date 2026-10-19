import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Проброс к базе — единственная дверь к данным снаружи Cloud.ru: только
// адреса DataLens, только закрытый кластер, без разрыва TLS.
test('DataLens proxy allows only DataLens ranges to the private cluster', () => {
  const config = read('../infra/cloudru/nginx-stream-datalens.conf')
  const allowed = [...config.matchAll(/^\s*allow ([^;]+);/gm)].map((match) => match[1])
  assert.deepEqual(allowed, [
    '178.154.242.128/28', '178.154.242.144/28', '178.154.242.160/28',
    '178.154.242.176/28', '178.154.242.192/28', '178.154.242.208/28',
    '130.193.60.0/28', '127.0.0.1',
  ])
  assert.match(config, /^\s*deny all;/m)
  assert.match(config, /^\s*listen 55432;/m)
  assert.match(config, /^\s*proxy_pass 10\.70\.10\.67:5432;/m)
  assert.doesNotMatch(config, /ssl_certificate|proxy_ssl|listen [^;]*ssl/)
})

test('DataLens proxy workflow is manual, confirmation-gated and keeps no secrets', () => {
  const workflow = read('../.github/workflows/configure-cloudru-datalens-proxy.yml')
  assert.match(workflow, /^on:\n  workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /workflow_run:|schedule:|\n  push:/)
  assert.match(workflow, /test "\$CONFIRMATION" = OPEN_DATALENS_DB_PROXY/)
  assert.match(workflow, /if: inputs\.mode == 'apply'/)
  assert.match(workflow, /group: cloudru-stage-vm/)
  assert.doesNotMatch(workflow, /secrets\.|PASSWORD|id-token: write/)
})
