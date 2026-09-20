import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const presentation = JSON.parse(await readFile(
  join(root, 'src/shared/exercise-media-presentation.generated.json'),
  'utf8',
))
const manifest = JSON.parse(await readFile(
  join(root, 'scripts/data/vital-gym-pro-media-manifest.json'),
  'utf8',
))

async function publicPosterHashes(folder) {
  const directory = join(root, 'public/exercises', folder)
  const entries = []
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.jpg') || name.endsWith('-end.jpg')) continue
    const bytes = await readFile(join(directory, name))
    entries.push([
      `/exercises/${folder}/${name}`,
      createHash('sha256').update(bytes).digest('hex'),
    ])
  }
  return entries
}

test('covers every reviewed exercise poster with verified presentation metadata', async () => {
  const privatePosters = manifest.files
    .filter(({ path }) => path.endsWith('.jpg') && !path.endsWith('-end.jpg'))
    .map(({ path, sha256 }) => [`/exercises/vital-pro/${path}`, sha256])
  const expected = new Map([
    ...await publicPosterHashes('vital'),
    ...await publicPosterHashes('reference'),
    ...privatePosters,
  ])

  assert.equal(presentation.version, 1)
  assert.equal(expected.size, 721)
  assert.deepEqual(Object.keys(presentation.items).sort(), [...expected.keys()].sort())
  for (const [path, sha256] of expected) {
    const item = presentation.items[path]
    assert.equal(item.sha256, sha256, `${path} metadata must match the reviewed poster`)
    assert.equal(item.crop.length, 4, `${path} crop must have four insets`)
    for (const inset of item.crop) {
      assert.equal(Number.isFinite(inset) && inset >= 0 && inset <= 36, true, `${path} crop inset is unsafe`)
    }
    assert.match(item.backdrop, /^rgb\(\d{2,3} \d{2,3} \d{2,3}\)$/u)
  }
})

test('removes the known pale canvas around the selected dumbbell RDL reference', () => {
  const item = presentation.items['/exercises/vital-pro/vital-dumbbell-rdl-ex248.jpg']
  assert.ok(item)
  assert.equal(item.crop[0], 0)
  assert.equal(item.crop[2], 0)
  assert.ok(item.crop[1] > 10)
  assert.ok(item.crop[3] > 10)
  assert.match(item.backdrop, /^rgb\(1[01234567]\d 1[01234567]\d 1[01234567]\d\)$/u)
})

