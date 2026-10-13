import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './frontend-release.mjs'
import { cloudruNginxConfigurations } from './prepare-cloudru-frontend.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function verifyCloudruFiles(bundle, site, expectedCommit) {
  verifyRelease(bundle)
  if (bundle.commit !== expectedCommit) throw new Error('Frontend source mismatch')
  if (!(await lstat(site)).isDirectory()) throw new Error('Not a frontend directory')
  for (const file of bundle.files) {
    const path = join(site, file.key)
    let directory = site
    for (const part of file.key.split('/').slice(0, -1)) {
      directory = join(directory, part)
      if (!(await lstat(directory)).isDirectory()) throw new Error('Not a regular frontend directory')
    }
    if (!(await lstat(path)).isFile()) throw new Error('Not a regular frontend file')
    const bytes = await readFile(path)
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error('Materialized frontend checksum mismatch')
    }
  }
}

export async function verifyCloudruHttp(bundle, base) {
  verifyRelease(bundle)
  const url = new URL(base)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') {
    throw new Error('Frontend smoke must use loopback HTTP')
  }
  const fileFor = (key) => bundle.files.find((file) => file.key === key)
  async function expect(path, file, status = 200) {
    const response = await fetch(new URL(path, url), {
      redirect: 'manual', signal: AbortSignal.timeout(5_000),
    })
    if (response.status !== status) throw new Error('Frontend HTTP status mismatch')
    if (!file) return
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== file.sha256 || bytes.length !== file.size
        || response.headers.get('cache-control') !== file.cacheControl
        || response.headers.get('content-type')?.split(';')[0] !== file.contentType.split(';')[0]
        || response.headers.get('x-content-type-options') !== 'nosniff') {
      throw new Error('Frontend HTTP bytes or metadata mismatch')
    }
  }
  for (const file of bundle.files) await expect(`/${file.key}`, file)
  for (const path of ['/', '/auth', '/auth/yandex/callback', '/me', '/today']) {
    await expect(path, fileFor('index.html'))
  }
  await expect('/assets/missing-cloudru-probe.js', fileFor('asset-recovery.js'))
  for (const path of ['/assets/missing.css', '/assets/missing.wasm', '/fonts/missing.woff2']) {
    await expect(path, undefined, 404)
  }
}

export async function verifyCloudruConfiguration(bundle, candidate) {
  const stage = join(candidate, 'stage.conf')
  if (!(await lstat(stage)).isFile()) throw new Error('Not a regular frontend configuration')
  const expected = cloudruNginxConfigurations(bundle, join(candidate, 'site')).stage
  if (await readFile(stage, 'utf8') !== expected) throw new Error('Frontend configuration mismatch')
}

async function command(args) {
  const child = spawn('nginx', ['-e', 'stderr', ...args], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 10_000 })
  await new Promise((resolveDone, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolveDone() : reject(new Error('Nginx command failed')))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [releaseFile, candidate, expectedCommit] = process.argv.slice(2)
  if (!releaseFile || !expectedCommit
      || !new RegExp(`^/opt/fit/frontend/candidates/${expectedCommit}-[0-9]+-[0-9]+$`).test(candidate ?? '')
      || !/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error('Invalid candidate probe arguments')
  const bundle = JSON.parse(await readFile(releaseFile, 'utf8'))
  await verifyCloudruFiles(bundle, join(candidate, 'site'), expectedCommit)
  await verifyCloudruConfiguration(bundle, candidate)
  if (process.argv.length > 6 || (process.argv[5] && process.argv[5] !== '--serving')) {
    throw new Error('Invalid frontend verification mode')
  }
  if (process.argv[5] === '--serving') {
    await verifyCloudruHttp(bundle, 'http://127.0.0.1:18081/')
    console.log('Verified serving frontend bytes and metadata on loopback')
    process.exit(0)
  }
  const probe = await mkdtemp(join(tmpdir(), 'fit-cloudru-nginx-probe-'))
  const configuration = join(probe, 'nginx.conf')
  const probeCandidate = join(probe, 'candidate.conf')
  await writeFile(probeCandidate, cloudruNginxConfigurations(bundle, join(candidate, 'site'), probe).candidate, { flag: 'wx' })
  await writeFile(configuration, `pid ${probe}/nginx.pid;
error_log stderr crit;
events {}
http {
    access_log off;
    client_body_temp_path ${probe}/client-body;
    proxy_temp_path ${probe}/proxy;
    fastcgi_temp_path ${probe}/fastcgi;
    uwsgi_temp_path ${probe}/uwsgi;
    scgi_temp_path ${probe}/scgi;
    include ${probeCandidate};
}
`, { flag: 'wx' })
  let child
  try {
    await command(['-p', `${probe}/`, '-c', configuration, '-t'])
    child = spawn('nginx', ['-e', 'stderr', '-p', `${probe}/`, '-c', configuration, '-g', 'daemon off;'], {
      stdio: 'ignore',
    })
    const stopOnTermination = () => child.kill('SIGTERM')
    process.once('SIGTERM', stopOnTermination)
    process.once('SIGINT', stopOnTermination)
    child.once('exit', () => {
      process.removeListener('SIGTERM', stopOnTermination)
      process.removeListener('SIGINT', stopOnTermination)
    })
    let failure
    child.once('error', () => { failure = true })
    child.once('exit', () => { failure = true })
    let ready = false
    for (let attempt = 0; attempt < 20 && !failure; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:18083/index.html', {
          signal: AbortSignal.timeout(1_000), redirect: 'manual',
        })
        const bytes = Buffer.from(await response.arrayBuffer())
        ready = response.status === 200 && sha256(bytes) === bundle.files.find((file) => file.key === 'index.html').sha256
        if (ready) break
      } catch (error) {
        // Only the isolated process startup is polled, never a user mutation.
        if (!(error instanceof TypeError) || error.cause?.code !== 'ECONNREFUSED') throw error
      }
      await new Promise((resolveDone) => setTimeout(resolveDone, 100))
    }
    if (!ready || failure) throw new Error('Isolated Nginx did not start')
    await verifyCloudruHttp(bundle, 'http://127.0.0.1:18083/')
    if (failure) throw new Error('Isolated Nginx exited during verification')
    console.log('Verified all frontend bytes, MIME/cache, SPA, recovery and missing assets on loopback')
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      // A separate PID/config identifies only this probe, never system Nginx.
      if (!child.killed) child.kill('SIGTERM')
      await new Promise((done, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('Isolated Nginx did not stop'))
        }, 5_000)
        child.once('exit', () => { clearTimeout(timer); done() })
      })
    }
    await rm(probe, { recursive: true, force: true })
  }
}
