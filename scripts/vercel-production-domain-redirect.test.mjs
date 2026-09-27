import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
)
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('redirects only the legacy production hostname to fit-training.ru', () => {
  assert.deepEqual(config.redirects, [
    {
      source: '/:path*',
      destination: 'https://fit-training.ru/:path*',
      has: [
        {
          type: 'host',
          value: 'fit-drab.vercel.app',
        },
      ],
      permanent: true,
    },
  ])
})

test('keeps production analytics enabled on the canonical domain', () => {
  assert.match(
    indexHtml,
    /\['fit-drab\.vercel\.app', 'fit-training\.ru'\]\.includes\(\s*window\.location\.hostname,/,
  )
})
