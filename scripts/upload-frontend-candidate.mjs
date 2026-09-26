import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatewayPlan } from './frontend-gateway-plan.mjs'

// Deliberately restricted to the separately approved candidate bucket.
const bucket = 'fit-frontend-probe-b1goqho1'
export async function uploadCandidate(bundle, run = promisify(execFile)) {
const plan = gatewayPlan(bundle, [], {
  bucket, reader: 'aje67ouc4633u7i7oc2a',
  frontendOrigin: 'https://d5drmhq5ovqk03jgsm8i.wnq2w1o5.apigw.yandexcloud.net',
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const directory = await mkdtemp(join(tmpdir(), 'fit-candidate-upload-'))
let verified = 0
try {
  for (const [index, object] of plan.objects.entries()) {
    const file = join(directory, String(index))
    const downloaded = join(directory, `${index}.remote`)
    const args = ['--bucket', bucket, '--key', object.object]
    let exists = true
    try {
      await run('yc', ['storage', 's3api', 'get-object', ...args, downloaded], { timeout: 120_000 })
    } catch (error) {
      if (!/NoSuchKey/.test(String(error.stderr))) throw new Error(`Cannot inspect candidate object ${index}`)
      exists = false
    }
    if (!exists) {
      const bytes = Buffer.from(object.upload.content, 'base64')
      if (hash(bytes) !== object.upload.sha256) throw new Error('Upload checksum mismatch')
      await writeFile(file, bytes, { flag: 'wx' })
      const metadata = ['--content-type', object.contentType, '--cache-control', object.cacheControl]
      if (object.upload.contentEncoding) metadata.push('--content-encoding', object.upload.contentEncoding)
      try {
        await run('yc', ['storage', 's3api', 'put-object', ...args, '--body', file, ...metadata], { timeout: 120_000 })
        await run('yc', ['storage', 's3api', 'get-object', ...args, downloaded], { timeout: 120_000 })
      } catch { throw new Error(`Upload or verification failed at object ${index}`) }
    }
    if (hash(await readFile(downloaded)) !== object.upload.sha256) throw new Error(`Remote checksum mismatch at object ${index}`)
    verified += 1
    if (verified % 20 === 0) console.log(`Verified ${verified}/${plan.objects.length}`)
  }
  console.log(`Verified ${verified} objects. No ACL, CORS or gateway changes applied.`)
  return plan.specification
} finally {
  await rm(directory, { recursive: true, force: true })
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, flag] = process.argv.slice(2)
  if (!input || flag !== '--upload-only') throw new Error('Usage: upload-frontend-candidate.mjs RELEASE --upload-only')
  const bundle = JSON.parse(await readFile(input, 'utf8'))
  const specification = await uploadCandidate(bundle)
  await writeFile(`gateway-${bundle.release}.json`, JSON.stringify(specification), { flag: 'wx' })
}
