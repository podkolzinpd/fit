import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { downloadVerifiedAsset, gradleCacheZip, gradleKotlinCacheJar, kotlinCompiler, officialTools, prepareOfficialCiTool } from './prepare-official-ci-tools.mjs'

const bytes = Buffer.from('verified synthetic archive')
const spec = { url: 'https://api.github.com/repos/synthetic/tool/releases/assets/1', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'fit-ci-tools-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('accepts the complete verified archive and revalidates cache without another download', () => workspace(async root => {
  const destination = join(root, 'archive.zip')
  let requests = 0
  const fetchAsset = async (url, options) => {
    requests++
    assert.equal(url, spec.url)
    assert.equal(options.headers.Accept, 'application/octet-stream')
    assert.equal(options.headers.Authorization, undefined)
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close()
    } }))
  }
  assert.equal(await downloadVerifiedAsset(spec, destination, fetchAsset), destination)
  assert.deepEqual(await readFile(destination), bytes)
  await downloadVerifiedAsset(spec, destination, fetchAsset)
  assert.equal(requests, 1)
  assert.deepEqual(await readdir(root), ['archive.zip'])
}))

for (const [name, response, error] of [
  ['HTTP504', () => new Response('timeout', { status: 504 }), /HTTP 504/],
  ['partial HTTP206', () => new Response(bytes, { status: 206 }), /HTTP 206/],
  ['truncated', () => new Response(bytes.subarray(1)), /size mismatch/],
  ['oversized', () => new Response(Buffer.concat([bytes, bytes])), /size mismatch/],
  ['tampered', () => new Response(Buffer.alloc(bytes.length)), /SHA256 mismatch/],
  ['JSON metadata', () => new Response('{"asset":1}'), /size mismatch/],
  ['interrupted stream', () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 3)); controller.error(new Error('stream failed')) } })), /stream failed/],
]) test(`rejects ${name} without leaving a runnable or cached artifact`, () => workspace(async root => {
  await assert.rejects(downloadVerifiedAsset(spec, join(root, 'archive.zip'), async () => response()), error)
  assert.deepEqual(await readdir(root), [])
}))

test('does not overwrite a corrupted existing cache or hide the checksum error', () => workspace(async root => {
  const path = join(root, 'archive.zip'), corrupt = Buffer.alloc(bytes.length)
  await writeFile(path, corrupt)
  let requests = 0
  await assert.rejects(downloadVerifiedAsset(spec, path, async () => { requests++; return new Response(bytes) }), /SHA256 mismatch/)
  assert.equal(requests, 0)
  assert.deepEqual(await readFile(path), corrupt)
}))

test('uses the official Maven artifact in the normal Gradle content store without GitHub headers', () => workspace(async root => {
  assert.equal(gradleKotlinCacheJar('/cache'), '/cache/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-compiler-embeddable/2.0.21/79346ed53db48b18312a472602eb5c057070c54d/kotlin-compiler-embeddable-2.0.21.jar')
  assert.equal(kotlinCompiler.sha256, '9fa8cdd1de0dccffe154c997d423ec6b5f53cd6d9177e3a77a9b0de03fb1bc81')
  assert.equal(new URL(kotlinCompiler.url).hostname, 'repo.maven.apache.org')
  await downloadVerifiedAsset({ ...spec, url: kotlinCompiler.url }, join(root, 'compiler.jar'), async (url, options) => {
    assert.equal(url, kotlinCompiler.url)
    assert.deepEqual(options.headers, { Accept: 'application/octet-stream' })
    return new Response(bytes)
  })
  const source = await readFile(new URL('./prepare-official-ci-tools.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /--offline|init\.gradle|mavenLocal|writeFile\([^\n]*\.bin/)
  assert.match(source, /await downloadVerifiedAsset\(kotlinCompiler, gradleKotlinCacheJar\(gradleHome\), fetchAsset\)/)
}))

test('matches Gradle8.14.3 PathAssembler without fabricating wrapper success markers', async () => {
  const properties = await readFile(new URL('../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8')
  assert.equal(gradleCacheZip(properties, '/cache'), '/cache/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3-all.zip')
  for (const modified of [properties.replace('8.14.3', '8.14.4'), properties.replace('services.gradle.org', 'example.test'), properties.replace('zipStoreBase=GRADLE_USER_HOME', 'zipStoreBase=PROJECT'), properties.replace('distributionPath=wrapper/dists', 'distributionPath=../../outside')]) {
    assert.throws(() => gradleCacheZip(modified, '/cache'), /Unreviewed/)
  }
  const source = await readFile(new URL('./prepare-official-ci-tools.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /writeFile\([^\n]*\.ok|mkdir\([^\n]*\.ok/)
  await assert.rejects(prepareOfficialCiTool('arbitrary'), /Expected gradle or terraform/)
})

test('retains immutable official versions and verifies both CI and release consumers', async () => {
  assert.equal(officialTools.gradle.sha256, 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c')
  assert.equal(officialTools.terraform.sha256, '214ac0a04a4f31ee0e3eb04ab1db9213c3ecaee9d4ebfd3d05b57399081c9d25')
  const android = await readFile(new URL('../.github/workflows/android-build.yml', import.meta.url), 'utf8')
  assert.equal([...android.matchAll(/prepare-official-ci-tools.mjs gradle/g)].length, 2)
  assert.match(android, /prepare-official-ci-tools.mjs gradle\n\s+- run: \.\/gradlew testDebugUnitTest assembleDebug/)
  const release = await readFile(new URL('../.github/workflows/release-android-ota.yml', import.meta.url), 'utf8')
  assert.match(release, /prepare-official-ci-tools.mjs gradle\n\s+cd android\n\s+\.\/gradlew testDebugUnitTest assembleRelease/)
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /node --test scripts\/prepare-official-ci-tools.test.mjs/)
  assert.match(ci, /init -backend=false -plugin-dir="\$RUNNER_TEMP\/fit-ci-providers"/)
  assert.match(ci, /terraform -chdir=infra\/yandex-frontend validate/)
  assert.match(ci, /terraform -chdir=infra\/yandex-frontend test/)
})
