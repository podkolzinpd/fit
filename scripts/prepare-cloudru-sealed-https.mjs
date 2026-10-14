import { X509Certificate, createPrivateKey } from 'node:crypto'
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = '/etc/fit/tls'
const MARKER = '# fit-cloudru-sealed-v1\n'
const BODY = '{"status":"cloudru_https_prepared","applicationAccess":"closed"}\n'
const cancellation = new AbortController()

function checkCancelled() {
  if (cancellation.signal.aborted) throw new Error('https_cancelled')
}

export function certificateTargets(target) {
  if (target === 'web') return [
    { domain: 'fit-training.ru' },
    { domain: 'www.fit-training.ru' },
  ]
  if (target !== 'api') throw new Error('https_target_invalid')
  return [{ domain: 'api.fit-training.ru' }]
}

export function validateContent(expected, value, now = Date.now()) {
  if (!value || typeof value.privateKey !== 'string'
    || !Array.isArray(value.certificateChain) || !value.certificateChain.length
    || value.certificateChain.length > 5
    || value.certificateChain.some(pem => typeof pem !== 'string' || !pem.startsWith('-----BEGIN CERTIFICATE-----'))) {
    throw new Error('https_content_invalid')
  }
  try {
    const certificate = new X509Certificate(value.certificateChain[0])
    const allowed = expected.domains ?? [expected.domain]
    const sans = certificate.subjectAltName?.split(', ').map(san => san.replace(/^DNS:/, ''))
    if (certificate.checkHost(expected.domain, { wildcards: false }) !== expected.domain
      || !sans || sans.length !== allowed.length || sans.some(san => !allowed.includes(san))
      || Date.parse(certificate.validFrom) > now
      || Date.parse(certificate.validTo) < now + 14 * 86400_000
      || !certificate.checkPrivateKey(createPrivateKey(value.privateKey))) {
      throw new Error('invalid')
    }
    return { chain: value.certificateChain.join('\n'), key: value.privateKey,
      expiry: certificate.validTo, fingerprint: certificate.fingerprint256 }
  } catch {
    throw new Error('https_certificate_invalid')
  }
}

export function sealedConfiguration(certificates, { address = '', port = 443 } = {}) {
  if (!['', '127.0.0.1:'].includes(address) || ![443, 18443].includes(port)
    || !certificates.length || certificates.length > 2) throw new Error('https_config_invalid')
  return MARKER + certificates.map(({ domain, chainPath, keyPath }) => {
    if (!['fit-training.ru', 'www.fit-training.ru', 'api.fit-training.ru'].includes(domain)
      || [chainPath, keyPath].some(path => typeof path !== 'string'
        || !/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..'))) throw new Error('https_config_invalid')
    return `server {
    listen ${address}${port} ssl;
    server_name ${domain};
    ssl_certificate ${chainPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_tickets off;
    access_log off;
    error_log stderr crit;
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header X-Fit-HTTPS-Mode "sealed" always;
    location / { return 503 '${BODY.replaceAll('\n', '\\n')}'; }
}
`
  }).join('\n')
}

function command(binary, args, rollback = false) {
  if (!rollback) checkCancelled()
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 })
  if (result.status !== 0) {
    const error = new Error('https_command_failed')
    error.diagnostic = { command: binary, exitCode: result.status, signal: result.signal }
    throw error
  }
  return result.stdout
}

export function verifySealed(domain, port, caFile) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const args = ['--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '3', '--max-time', '5',
      '--resolve', `${domain}:${port}:127.0.0.1`, '--dump-header', '-', '--write-out', '\nHTTP_STATUS:%{http_code}',
      ...(caFile ? ['--cacert', caFile] : []),
      ...(method === 'HEAD' ? ['--head'] : ['--request', method]),
      `https://${domain}:${port}/v1/auth/yandex/session`]
    const output = command('curl', args)
    if (!output.endsWith('HTTP_STATUS:503')
      || !/x-fit-https-mode: sealed\r?\n/i.test(output)
      || !/cache-control: no-store\r?\n/i.test(output)
      || (method !== 'HEAD' && !output.includes(BODY))) throw new Error('https_sealed_smoke_failed')
  }
}

async function verifyAfterReload(domain) {
  const deadline = Date.now() + 5000
  while (true) {
    try { verifySealed(domain, 443); return }
    catch (error) {
      // Nginx reload returns before new workers accept TLS. Old sealed workers
      // may still present the previous vhost cert (60), or the listener starts (7).
      // Never bypass certificate validation or retry HTTP/body/other failures.
      if (error.diagnostic?.command !== 'curl' || ![7, 60].includes(error.diagnostic.exitCode)
        || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

export async function loadCertificates(target) {
  const targets = certificateTargets(target)
  const name = targets[0].domain
  const contents = {}
  for (const file of ['fullchain.pem', 'privkey.pem']) {
    const path = await realpath(`/etc/letsencrypt/live/${name}/${file}`)
    const prefix = `/etc/letsencrypt/archive/${name}/`
    const stat = await lstat(path)
    if (!path.startsWith(prefix) || !/^(?:fullchain|privkey)[0-9]+\.pem$/.test(path.slice(prefix.length))
      || !stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.size > 100_000
      || (file === 'privkey.pem' && (stat.mode & 0o077) !== 0)) throw new Error('https_local_certificate_unsafe')
    contents[file] = await readFile(path, 'utf8')
  }
  const certificateChain = contents['fullchain.pem'].match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
  return targets.map(expected => ({ ...expected, ...validateContent({ ...expected, domains: targets.map(t => t.domain) },
    { certificateChain, privateKey: contents['privkey.pem'] }) }))
}

async function exists(path) {
  try { await lstat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function stopProbe(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, 5000)
    child.once('exit', () => { clearTimeout(deadline); resolve() })
    child.kill('SIGTERM')
  })
}

async function prepare() {
  if (process.getuid() !== 0 || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit'
    || process.env.GITHUB_REF !== 'refs/heads/main'
    || !/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA ?? '')
    || process.env.PREPARE_CONFIRMATION !== 'PREPARE_CLOUDRU_HTTPS_CLOSED') {
    throw new Error('https_prepare_not_confirmed')
  }
  const target = process.env.TARGET
  certificateTargets(target)
  for (const name of ['api', 'web']) {
    if (await exists(`/etc/nginx/sites-enabled/fit-public-${name}`)) throw new Error('https_public_ingress_active')
  }
  const site = `/etc/nginx/sites-available/fit-cloudru-sealed-${target}`
  const link = `/etc/nginx/sites-enabled/fit-cloudru-sealed-${target}`
  if (await exists(site) && (!(await lstat(site)).isFile() || (await lstat(site)).uid !== 0)) {
    throw new Error('https_site_not_owned')
  }
  const old = await exists(site) ? await readFile(site, 'utf8') : undefined
  if (old && (!old.startsWith(MARKER) || /proxy_pass|fastcgi_pass|uwsgi_pass|\binclude\b/.test(old))) {
    throw new Error('https_site_not_owned')
  }
  const linked = await exists(link)
  if (linked && (!(await lstat(link)).isSymbolicLink() || await readlink(link) !== site)) {
    throw new Error('https_site_not_owned')
  }
  command('nginx', ['-t'])
  const active = command('nginx', ['-T']).split(/^# configuration file /m).filter(section =>
    !/^\/etc\/nginx\/sites-enabled\/fit-cloudru-sealed-(?:api|web):\n/.test(section)).join('\n')
  if (/server_name\s+[^;]*\bfit-training\.ru\b/.test(active)) throw new Error('https_existing_domain_ingress')
  // Keys are generated by Certbot on this VM; no remote certificate/key transfer.
  const certificates = await loadCertificates(target)
  checkCancelled()
  if (await exists('/etc/fit') && (!(await lstat('/etc/fit')).isDirectory()
    || (await lstat('/etc/fit')).uid !== 0 || ((await lstat('/etc/fit')).mode & 0o022) !== 0)) {
    throw new Error('https_secret_root_not_owned')
  }
  if (await exists(ROOT) && (!(await lstat(ROOT)).isDirectory()
    || (await lstat(ROOT)).uid !== 0 || ((await lstat(ROOT)).mode & 0o022) !== 0)) {
    throw new Error('https_secret_root_not_owned')
  }
  await mkdir(ROOT, { recursive: true, mode: 0o700 })
  await chmod(ROOT, 0o700)
  const candidate = await mkdtemp(join(ROOT, `sealed-${target}-`))
  let probe
  let installed = false
  let successful = false
  let configTemp
  try {
    const paths = []
    for (const certificate of certificates) {
      checkCancelled()
      const chainPath = join(candidate, `${certificate.domain}.chain.pem`)
      const keyPath = join(candidate, `${certificate.domain}.key.pem`)
      await writeFile(chainPath, certificate.chain, { mode: 0o600, flag: 'wx' })
      await writeFile(keyPath, certificate.key, { mode: 0o600, flag: 'wx' })
      paths.push({ domain: certificate.domain, chainPath, keyPath })
    }
    const probePath = join(candidate, 'probe.conf')
    await writeFile(probePath, `pid ${candidate}/probe.pid; error_log stderr crit; events {} http {\n`
      + sealedConfiguration(paths, { address: '127.0.0.1:', port: 18443 }) + '\n}\n', { mode: 0o600 })
    command('nginx', ['-t', '-c', probePath])
    probe = spawn('nginx', ['-c', probePath, '-g', 'daemon off;'], { stdio: 'ignore' })
    await new Promise((resolve, reject) => {
      probe.once('spawn', resolve)
      probe.once('error', () => reject(new Error('https_probe_start_failed')))
    })
    let ready = false
    for (let attempt = 0; attempt < 20; attempt++) {
      checkCancelled()
      if (probe.exitCode !== null) throw new Error('https_probe_start_failed')
      try { ready = (await readFile(join(candidate, 'probe.pid'), 'utf8')).trim() === String(probe.pid) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('https_probe_start_failed')
    for (const { domain } of paths) verifySealed(domain, 18443)
    await stopProbe(probe)
    const next = join(candidate, 'site.conf')
    await writeFile(next, sealedConfiguration(paths), { mode: 0o600 })
    // Mark before the first write so a partial/failed installation rolls back.
    installed = true
    checkCancelled()
    configTemp = await mkdtemp(`/etc/nginx/sites-available/.fit-cloudru-sealed-${target}-`)
    const configNext = join(configTemp, 'site.conf')
    await writeFile(configNext, await readFile(next), { mode: 0o644, flag: 'wx' })
    await rename(configNext, site)
    if (!linked) await symlink(site, link)
    command('nginx', ['-t'])
    command('systemctl', ['reload', 'nginx'])
    for (const { domain } of paths) await verifyAfterReload(domain)
    checkCancelled()
    successful = true
    process.stdout.write(JSON.stringify({ event: 'cloudru_sealed_https_prepared',
      domains: certificates.map(({ domain, expiry, fingerprint }) => ({ domain, expiry, fingerprint })),
      applicationAccess: 'closed', dnsChanged: false }) + '\n')
  } finally {
    await stopProbe(probe)
    if (!successful) {
      if (installed) {
        if (old !== undefined) await writeFile(site, old, { mode: 0o644 })
        else await rm(site, { force: true })
        if (!linked) await rm(link, { force: true })
        try {
          command('nginx', ['-t'], true)
          command('systemctl', ['reload', 'nginx'], true)
        } catch { throw new Error('https_rollback_failed') }
      }
      await rm(candidate, { recursive: true, force: true })
    }
    if (configTemp) await rm(configTemp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('SIGTERM', () => cancellation.abort())
  process.on('SIGINT', () => cancellation.abort())
  prepare().catch(error => {
    const code = /^https_[a-z_]+(?:_[1-5][0-9]{2})?$/.test(error.message) ? error.message : 'https_prepare_failed'
    process.stderr.write(`${code}; no certificate contents emitted.\n`)
    if (error.diagnostic) process.stderr.write(JSON.stringify(error.diagnostic) + '\n')
    process.exitCode = 1
  })
}
