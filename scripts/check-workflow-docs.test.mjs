import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { budgetErrors, acceptanceErrors, checkRepository } from './check-workflow-docs.mjs'

const body = 'Проверенная версия: 4ed3f6a939208d9557c06fb9571f539809f8ca45\n\n| ID | Результат | Проверка | Статус |\n| --- | --- | --- | --- |\n| P1 | История сохранена | SHA256 всех исходников совпадает | проверено |\n'
test('accepts a compact existing PR table; no second report needed', () => {
  assert.deepEqual(acceptanceErrors(body), [])
})
test('rejects unchecked results, empty evidence and duplicate IDs', () => {
  assert.ok(acceptanceErrors(body.replace('проверено', 'не проверено')).length)
  assert.ok(acceptanceErrors(body.replace('SHA256 всех исходников совпадает', '')).length)
  assert.ok(acceptanceErrors(body + '| P1 | Другой результат | Проверка | проверено |\n').length)
})
test('rejects a template or missing version/table', () => {
  assert.ok(acceptanceErrors(readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8')).length)
  assert.ok(acceptanceErrors(body.replace(/4ed3[a-f0-9]+/, '')).length)
  assert.ok(acceptanceErrors('All done').length)
})
test('a deferral needs a recorded owner decision, not just a status', () => {
  const deferred = body.replace('проверено', 'согласован перенос')
  assert.ok(acceptanceErrors(deferred).length)
  assert.deepEqual(acceptanceErrors(deferred.replace('SHA256 всех исходников совпадает', 'Решение https://example.test/decision')), [])
})
test('prevents huge multibyte snapshot lines even within 120 lines', () => {
  assert.ok(budgetErrors('docs/CURRENT_STATE.md', 'я'.repeat(301)).length)
  assert.ok(budgetErrors('docs/CURRENT_STATE.md', 'x\n'.repeat(121)).length)
  assert.ok(budgetErrors('AGENTS.md', 'я'.repeat(7000)).length)
  assert.deepEqual(budgetErrors('docs/CURRENT_STATE.md', '# Index\nShort status\n'), [])
})
test('checks real entry documents and byte-preserved historical sources', () => {
  assert.deepEqual(checkRepository(resolve(import.meta.dirname, '..')), [])
})
test('detects broken links and changed archive bytes in an isolated copy', t => {
  const root = mkdtempSync(join(tmpdir(), 'fit-workflow-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = resolve(import.meta.dirname, '..')
  cpSync(join(source, 'docs'), join(root, 'docs'), { recursive: true })
  cpSync(join(source, 'AGENTS.md'), join(root, 'AGENTS.md'))
  writeFileSync(join(root, 'AGENTS.md'), '[missing](missing-file.md)\n')
  writeFileSync(join(root, 'docs/archive/workflow-20261027/AGENTS.original.txt'), 'lost history')
  const errors = checkRepository(root)
  assert.ok(errors.some(x => x.includes('broken local link')))
  assert.ok(errors.some(x => x.includes('changed historical source')))
})
