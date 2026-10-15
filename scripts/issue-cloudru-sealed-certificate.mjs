import { spawn, spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { certificateTargets, loadCertificates } from './prepare-cloudru-sealed-https.mjs'

const ROOT = '/etc/fit/acme'
const DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'
const SERVERS = ['ns1.yandexcloud.net', 'ns2.yandexcloud.net', '1.1.1.1', '8.8.8.8']
const cancelled = new AbortController()

export function dnsChallenge(domain, value) {
  if (!['fit-training.ru', 'www.fit-training.ru', 'api.fit-training.ru'].includes(domain)
    || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('https_challenge_invalid')
  return { event: 'cloudru_acme_dns_required', name: `_acme-challenge.${domain}`, type: 'TXT', value }
}

export function dnsAnswerMatches(answer, value) {
  return answer.trim().split('\n').some(line => line === `"${value}"`)
}

function dig(server, type, name) {
  const result = spawnSync('dig', [`@${server}`, '+short', '+time=2', '+tries=1', type, name],
    { encoding: 'utf8', timeout: 4000, maxBuffer: 10_000 })
  return result.status === 0 ? result.stdout : undefined
}

async function hook() {
  const directory = process.env.FIT_ACME_ATTEMPT
  if (process.getuid() !== 0 || !/^\/etc\/fit\/acme\/attempt-[A-Za-z0-9]+$/.test(directory ?? '')) {
    throw new Error('https_hook_not_confirmed')
  }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o077) !== 0) throw new Error('https_hook_not_confirmed')
  const proof = dnsChallenge(process.env.CERTBOT_IDENTIFIER ?? process.env.CERTBOT_DOMAIN, process.env.CERTBOT_VALIDATION)
  const next = join(directory, `${proof.name}.tmp`)
  await writeFile(next, JSON.stringify(proof), { mode: 0o600, flag: 'wx' })
  await rename(next, join(directory, `${proof.name}.json`))
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline && !cancelled.signal.aborted) {
    const ready = SERVERS.every(server => {
      const cname = dig(server, 'CNAME', proof.name)
      return cname !== undefined && cname.trim() === '' && dnsAnswerMatches(dig(server, 'TXT', proof.name) ?? '', proof.value)
    })
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  throw new Error('https_dns_validation_timeout')
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  // Certbot and its own hooks share only this freshly created process group.
  const signal = name => {
    try { process.kill(-child.pid, name) }
    catch (error) { if (error.code !== 'ESRCH') throw new Error('https_subprocess_stop_failed') }
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { signal('SIGKILL') } catch (error) { reject(error) } }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { signal('SIGTERM') } catch (error) { clearTimeout(timer); reject(error) }
  })
}

async function issue() {
  if (process.getuid() !== 0 || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit'
    || process.env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA ?? '')
    || process.env.CA_TERMS_CONFIRMATION !== 'ACCEPT_LETS_ENCRYPT_TERMS_FOR_CLOUDRU'
    || process.env.DNS_CONFIRMATION !== 'TEMPORARY_FIT_ACME_DNS_WITH_RESTORE') throw new Error('https_issue_not_confirmed')
  const domains = certificateTargets(process.env.TARGET).map(t => t.domain)
  for (const path of ['/etc/fit', ROOT]) {
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw new Error('https_secret_root_not_owned')
  }
  await chmod(ROOT, 0o700)
  for (const target of ['web', 'api']) {
    try { await lstat(`/etc/nginx/sites-enabled/fit-public-${target}`); throw new Error('https_public_ingress_active') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const lineage = `/etc/letsencrypt/live/${domains[0]}`
  let existing = false
  try { await lstat(lineage); existing = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing) {
    await loadCertificates(process.env.TARGET)
    process.stdout.write('{"event":"cloudru_local_certificate_already_valid"}\n')
    return
  }
  const attempt = await mkdtemp(join(ROOT, 'attempt-'))
  let child
  let exit
  const published = new Set()
  const publishProofs = async () => {
    for (const file of await readdir(attempt)) {
      if (!/^_acme-challenge\.(?:api\.|www\.)?fit-training\.ru\.json$/.test(file) || published.has(file)) continue
      const proof = JSON.parse(await readFile(join(attempt, file), 'utf8'))
      const checked = dnsChallenge(proof.name.slice('_acme-challenge.'.length), proof.value)
      if (!domains.includes(checked.name.slice('_acme-challenge.'.length))) throw new Error('https_challenge_invalid')
      process.stdout.write(JSON.stringify(checked) + '\n')
      published.add(file)
    }
  }
  try {
    const script = fileURLToPath(import.meta.url)
    if (![script, process.execPath].every(path => /^\/[a-zA-Z0-9_./-]+$/.test(path))) throw new Error('https_hook_path_invalid')
    child = spawn('certbot', ['certonly', '--config', '/dev/null', '--server', DIRECTORY,
      '--manual', '--preferred-challenges', 'dns', '--manual-auth-hook', `${process.execPath} ${script} --auth-hook`,
      '--non-interactive', '--quiet', '--agree-tos', '--register-unsafely-without-email',
      '--cert-name', domains[0], ...domains.flatMap(domain => ['-d', domain])],
    { detached: true, stdio: 'ignore', env: { ...process.env, FIT_ACME_ATTEMPT: attempt } })
    child.once('error', () => { exit = 1 })
    child.once('exit', code => { exit = code ?? 1 })
    const deadline = Date.now() + 30 * 60_000
    while (exit === undefined && !cancelled.signal.aborted && Date.now() < deadline) {
      await publishProofs()
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await publishProofs()
    if (exit !== 0 || cancelled.signal.aborted) throw new Error('https_issuance_failed')
    await loadCertificates(process.env.TARGET)
    process.stdout.write('{"event":"cloudru_local_certificate_issued","applicationAccess":"closed"}\n')
  } finally {
    await stop(child)
    await publishProofs()
    if (published.size) process.stdout.write(JSON.stringify({ event: 'cloudru_acme_dns_restore_required',
      names: [...published].map(name => name.slice(0, -5)) }) + '\n')
    await rm(attempt, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('SIGTERM', () => cancelled.abort())
  process.on('SIGINT', () => cancelled.abort())
  const operation = process.argv[2] === '--auth-hook' ? hook() : issue()
  operation.catch(error => {
    process.stderr.write((/^https_[a-z_]+$/.test(error.message) ? error.message : 'https_issuance_failed') + '\n')
    process.exitCode = 1
  })
}
