import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './frontend-release.mjs'

function safeRoot(root) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(root)
      || root.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Unsafe frontend root')
  }
  return root
}

export async function materializeCloudruFrontend(bundle, directory, expectedCommit) {
  verifyRelease(bundle)
  if (bundle.commit !== expectedCommit) throw new Error('Frontend source mismatch')
  const root = resolve(directory)
  // An existing directory (including a symlink) is never reused or overwritten.
  await mkdir(root, { mode: 0o755 })
  for (const file of bundle.files) {
    const destination = resolve(root, file.key)
    await mkdir(dirname(destination), { recursive: true, mode: 0o755 })
    await writeFile(destination, Buffer.from(file.content, 'base64'), { flag: 'wx', mode: 0o644 })
  }
  return bundle.files.length
}

function staticLocations(bundle) {
  return bundle.files.map((file) => `    location = /${file.key} {
        default_type "${file.contentType}";
        add_header Cache-Control "${file.cacheControl}" always;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri =404;
    }`).join('\n') + `
    location ~ ^/assets/.*\\.js$ {
        rewrite ^ /asset-recovery.js last;
    }
    location ~ ^/(assets|fonts|media)/ { return 404; }
    location ~ \\.[A-Za-z0-9]+$ { return 404; }
    location / { try_files $uri /index.html; }
`
}

export function cloudruNginxConfigurations(bundle, root, logDirectory = '/var/log/nginx') {
  verifyRelease(bundle)
  safeRoot(root)
  safeRoot(logDirectory)
  const common = (log) => `    root ${root};
    index index.html;
    server_tokens off;
    disable_symlinks on;
    access_log ${logDirectory}/fit-cloudru-access.log ${log};
    error_log ${logDirectory}/fit-cloudru-error.log crit;
    add_header X-Content-Type-Options nosniff always;
`
  const logging = (name) => `# Managed by prepare-cloudru-frontend; no request URI, IP or headers in access logs.
log_format ${name} '$request_method $status $request_time';
`
  const candidate = `${logging('fit_cloudru_candidate_safe')}server {
    listen 127.0.0.1:18083;
    server_name fit-training.ru;
${common('fit_cloudru_candidate_safe')}${staticLocations(bundle)}}
`
  // The existing public proxy continues to use 18081; candidate verification
  // uses a separate port and cannot alter the serving stage process.
  const stage = `pid /run/fit-frontend-stage.pid;
error_log ${logDirectory}/fit-cloudru-error.log crit;
events { worker_connections 256; }
http {
${candidate.replace('listen 127.0.0.1:18083;', 'listen 127.0.0.1:18081;')}
}
`
  return { candidate, stage }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [releaseFile, outputDirectory, expectedCommit, vmRoot] = process.argv.slice(2)
  if (!releaseFile || !outputDirectory || !expectedCommit || !vmRoot) {
    throw new Error('Usage: prepare-cloudru-frontend.mjs RELEASE OUTPUT SHA VM_SITE_ROOT')
  }
  const bundle = JSON.parse(await readFile(releaseFile, 'utf8'))
  const output = resolve(outputDirectory)
  const configuration = cloudruNginxConfigurations(bundle, vmRoot)
  await mkdir(output, { mode: 0o755 })
  const count = await materializeCloudruFrontend(bundle, resolve(output, 'site'), expectedCommit)
  await writeFile(resolve(output, 'candidate.conf'), configuration.candidate, { flag: 'wx' })
  await writeFile(resolve(output, 'stage.conf'), configuration.stage, { flag: 'wx' })
  console.log(`Prepared ${count} verified frontend files and offline Nginx configurations; no activation`)
}
