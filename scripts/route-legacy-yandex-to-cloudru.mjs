import { pathToFileURL } from 'node:url'
import { appendFile } from 'node:fs/promises'

export const legacyContainerId = 'bbat47es6kspjb3dvfn2'
const containerBase = 'https://serverless-containers.api.cloud.yandex.net/containers/v1'
const dnsBase = 'https://dns.api.cloud.yandex.net/dns/v1/zones'
const names = ['fit-training.ru.', 'www.fit-training.ru.', 'api.fit-training.ru.']

export function compatibilityDnsChange(records) {
  const relevant = records.filter(record => names.includes(record.name) && ['A', 'AAAA', 'CNAME'].includes(record.type))
  for (const record of relevant) {
    const accepted = record.type === 'A'
      ? record.data?.every(value => ['87.242.117.210', '158.160.171.31', '158.160.184.183'].includes(value))
      : record.type === 'CNAME' && record.name === 'www.fit-training.ru.' && record.data?.every(value => value === 'fit-training.ru.')
    if (!accepted || !record.data?.length) throw new Error('legacy_dns_unexpected_record')
  }
  return { deletions: relevant, additions: names.map(name => ({ name, type: 'A', ttl: '60', data: ['87.242.117.210'] })) }
}

export function compatibilityRevision(previous, imageUrl) {
  if (previous.containerId !== legacyContainerId || !/^[a-z0-9]{20}$/.test(previous.serviceAccountId ?? '')
    || !/^cr\.yandex\/crp5dt6662a8s2vlt1hm\/api:cloudru-compat-[a-f0-9]{40}$/.test(imageUrl ?? '')) throw new Error('legacy_revision_rejected')
  return { containerId: legacyContainerId, resources: { memory: '134217728', cores: '1', coreFraction: '100' },
    executionTimeout: '180s', concurrency: '16', serviceAccountId: previous.serviceAccountId,
    imageSpec: { imageUrl, environment: {} }, logOptions: { disabled: true }, runtime: { http: {} } }
}

async function main() {
  const mode = process.argv[2]
  if (!['inspect', 'dns', 'api'].includes(mode) || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit'
    || process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.YC_IAM_TOKEN) throw new Error('legacy_context_rejected')
  if (mode !== 'inspect' && process.env.CONFIRMATION !== 'ROUTE_OLD_ADDRESSES_TO_CLOUDRU') throw new Error('legacy_confirmation_rejected')
  async function json(url, body) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${process.env.YC_IAM_TOKEN}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new Error(`legacy_control_plane_http_${response.status}`)
    return response.json()
  }
  async function completed(operation) {
    if (!/^[a-z0-9]+$/.test(operation.id ?? '')) throw new Error('legacy_operation_rejected')
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await json(`https://operation.api.cloud.yandex.net/operations/${operation.id}`)
      if (result.done) { if (result.error) throw new Error('legacy_operation_failed'); return result }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    throw new Error('legacy_operation_timeout')
  }
  const container = await json(`${containerBase}/containers/${legacyContainerId}`)
  if (container.name !== 'fit-stage-api' || container.folderId !== 'b1goqho12tlk9dibc3f3') throw new Error('legacy_container_rejected')
  const revisions = await json(`${containerBase}/revisions?containerId=${legacyContainerId}&pageSize=100`)
  if (revisions.nextPageToken) throw new Error('legacy_revisions_incomplete')
  const active = (revisions.revisions ?? []).filter(revision => revision.status === 'ACTIVE')
  if (active.length !== 1 || !/^[a-z0-9]{20}$/.test(active[0].id ?? '')) throw new Error('legacy_revision_ambiguous')
  if (mode === 'api') {
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('legacy_summary_missing')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Previous Yandex API revision retained for rollback: ${active[0].id}\n`)
    const operation = await json(`${containerBase}/revisions:deploy`, compatibilityRevision(active[0], process.env.COMPAT_IMAGE))
    await completed(operation)
    console.log('{"event":"legacy_api_compatibility_deployed"}')
    return
  }
  const matches = []
  for (const folder of ['b1goqho12tlk9dibc3f3', 'b1g6sd1kdaiqd1frauk4']) {
    const zones = await json(`${dnsBase}?folderId=${folder}&pageSize=1000`)
    if (zones.nextPageToken) throw new Error('legacy_zones_incomplete')
    matches.push(...(zones.dnsZones ?? []).filter(zone => zone.zone === 'fit-training.ru.' && zone.publicVisibility))
    if (matches.length) break
  }
  if (matches.length !== 1 || !/^[a-z0-9]+$/.test(matches[0].id)) throw new Error('legacy_zone_ambiguous')
  const zoneId = matches[0].id
  const recordPage = await json(`${dnsBase}/${zoneId}/records?pageSize=1000`)
  if (recordPage.nextPageToken) throw new Error('legacy_records_incomplete')
  const change = compatibilityDnsChange(recordPage.recordSets ?? [])
  if (mode === 'dns') await completed(await json(`${dnsBase}/${zoneId}:updateRecordSets`, change))
  console.log(JSON.stringify({ event: mode === 'dns' ? 'legacy_dns_routed_to_cloudru' : 'legacy_compatibility_inventory',
    zoneId, previousRevision: active[0].id, records: change.deletions.map(({ name, type, ttl, data }) => ({ name, type, ttl, data })) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'legacy_compatibility_failed'); process.exitCode = 1 })
}
