import { pathToFileURL } from 'node:url'

const gatewayId = 'd5drmhq5ovqk03jgsm8i'
const base = `https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${gatewayId}`
const commitPattern = /^[a-f0-9]{40}$/

export function summarizeGateway({ gateway, specification, operations, previousCommit, candidateCommit, sinceUtc }) {
  if (!commitPattern.test(previousCommit) || !commitPattern.test(candidateCommit)) throw new Error('Expected commits must be SHA-1 IDs')
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(sinceUtc) || Number.isNaN(Date.parse(sinceUtc))) {
    throw new Error('Incident start must be RFC-3339 UTC')
  }
  const version = specification?.info?.version
  const activeCommit = typeof version === 'string' && commitPattern.test(version.slice(0, 40))
    ? version.slice(0, 40) : 'unknown'
  const latest = operations.filter((operation) => String(operation.createdAt ?? '') >= sinceUtc)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))).slice(0, 10)
  const state = {
    gatewayStatus: gateway?.status ?? 'unknown',
    requestLoggingDisabled: gateway?.logOptions?.disabled === true,
    activeCommit,
    activeIsPrevious: activeCommit === previousCommit,
    activeIsCandidate: activeCommit === candidateCommit,
    operations: latest.map((operation) => ({
      id: operation.id ?? 'unknown',
      createdAt: operation.createdAt ?? 'unknown',
      done: operation.done === true,
      errorCode: operation.error?.code ?? null,
    })),
  }
  state.settledOnKnownVersion = state.gatewayStatus === 'ACTIVE'
    && state.requestLoggingDisabled
    && (state.activeIsPrevious || state.activeIsCandidate)
    && latest.length > 0
    && latest.every((operation) => operation.done === true)
  return state
}

async function main() {
  const { YC_IAM_TOKEN: token, PREVIOUS_COMMIT: previousCommit,
    CANDIDATE_COMMIT: candidateCommit, INCIDENT_SINCE_UTC: sinceUtc } = process.env
  if (!token) throw new Error('Short-lived Yandex identity is required')
  const read = async (url) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Read-only Yandex API returned HTTP ${response.status}`)
    return response.json()
  }
  const [gateway, specResponse, operationResponse] = await Promise.all([
    read(base),
    read(`${base}:spec?format=JSON`),
    read(`${base}/operations?pageSize=100`),
  ])
  const report = summarizeGateway({
    gateway,
    specification: JSON.parse(specResponse.openapiSpec),
    operations: operationResponse.operations ?? [],
    previousCommit,
    candidateCommit,
    sinceUtc,
  })
  console.log(JSON.stringify(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
