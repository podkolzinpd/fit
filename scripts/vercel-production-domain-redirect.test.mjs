import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
)
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('redirects only the legacy production hostname to fit-training.ru', () => {
  assert.deepEqual(config.routes[0], {
    src: '/(.*)',
    has: [
      {
        type: 'host',
        value: 'fit-drab.vercel.app',
      },
    ],
    headers: {
      Location: 'https://fit-training.ru/$1',
    },
    status: 308,
  })
  assert.equal(config.redirects, undefined)
})

test('keeps production analytics enabled on the canonical domain', () => {
  assert.match(
    indexHtml,
    /window\.location\.hostname === 'fit-training\.ru'/,
  )
  assert.doesNotMatch(indexHtml, /fit-drab\.vercel\.app/)
})
