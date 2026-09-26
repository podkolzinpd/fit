import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareFrontend } from './prepare-yandex-frontend.mjs'

const sha = 'a'.repeat(40)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fit-frontend-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets'))
  for (const name of ['index.html', 'sw.js', 'asset-recovery.js', 'site.webmanifest', 'assets/app-12345678.js']) {
    await writeFile(join(root, name), 'fixture')
  }
  return root
}

test('deterministic checksums, MIME, cache and source routing without deployment', async (t) => {
  const root = await fixture(t)
  const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)))
  const manifest = await prepareFrontend(root, sha, routes)
  assert.deepEqual(manifest, await prepareFrontend(root, sha, routes))
  assert.equal(manifest.deployable, false)
  assert.deepEqual(manifest.requiredRouting, routes)
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    assert.equal(file.size, 7)
    assert.equal(file.cacheControl, file.key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  }
  assert.equal(manifest.files.find((file) => file.key === 'sw.js').contentType, 'application/javascript; charset=utf-8')
  await writeFile(join(root, 'index.html'), 'changed')
  assert.notDeepEqual(manifest, await prepareFrontend(root, sha, routes))
})

test('rejects missing entrypoint and invalid release', async (t) => {
  const root = await fixture(t)
  await assert.rejects(prepareFrontend(root, 'main', []), /commit SHA/)
  await rm(join(root, 'index.html'))
  await assert.rejects(prepareFrontend(root, sha, []), /Missing required artifact/)
})

for (const forbidden of ['.env', 'assets/source.js.map', 'private.pem']) {
  test(`rejects ${forbidden}`, async (t) => {
    const root = await fixture(t)
    await writeFile(join(root, forbidden), 'synthetic')
    await assert.rejects(prepareFrontend(root, sha, []), /forbidden|Unsupported/)
  })
}

test('rejects symlinks instead of reading outside the artifact', async (t) => {
  const root = await fixture(t)
  await symlink(join(root, 'index.html'), join(root, 'linked.html'))
  await assert.rejects(prepareFrontend(root, sha, []), /Symlinks/)
})

test('workflow is manual, artifact-only and has no cloud credentials', async () => {
  const workflow = await readFile(new URL('../.github/workflows/prepare-yandex-frontend.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\b(push|pull_request|schedule):|id-token:|secrets\.|terraform apply|aws s3|yc storage/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /127\.0\.0\.1:54321/)
})

test('separate Terraform root is disabled and private, without DNS or IAM changes', async () => {
  const configuration = await readFile(new URL('../infra/yandex-frontend/main.tf', import.meta.url), 'utf8')
  assert.match(configuration, /variable "enabled"\s*{[^}]*default\s*= false/)
  assert.match(configuration, /prevent_destroy = true/)
  assert.match(configuration, /force_destroy = false/)
  assert.doesNotMatch(configuration, /resource "yandex_(dns|iam|resourcemanager)|backend "s3"|website\s*{|read\s*= true/)
})
