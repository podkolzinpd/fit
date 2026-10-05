import { probeFrontendGatewayWarmup } from './probe-frontend-gateway-warmup.mjs'
import { resolveFrontendAddresses } from './probe-production-frontend.mjs'

export function createFrontendProbeHandler({
  probe = probeFrontendGatewayWarmup,
  now = Date.now,
  expiresAt = process.env.PROBE_EXPIRES_AT,
  log = (report) => console.log(JSON.stringify(report)),
} = {}) {
  return async () => {
    const expiry = Date.parse(expiresAt ?? '')
    if (!Number.isFinite(expiry)) throw new Error('PROBE_EXPIRES_AT is required')
    if (now() >= expiry) return { status: 'expired' }
    const report = await probe({
      maxAddresses: 1,
      network: 'yandex-cloud',
      resolveAddresses: () => resolveFrontendAddresses({ name: 'system', useResolver: true }),
    })
    log({ event: 'frontend_gateway_probe', ...report })
    // A measured network failure is data, not a reason to retry and warm again.
    return { status: report.status, measured: true, requests: report.requests.length }
  }
}

export const handler = createFrontendProbeHandler()
