import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const budgets = {
  'AGENTS.md': 12 * 1024,
  'docs/FIT_WORKFLOW.md': 16 * 1024,
  'docs/CURRENT_STATE.md': 12 * 1024,
  'docs/UI_TASK_PROMPT.md': 12 * 1024,
}
const linkedDocs = [
  ...Object.keys(budgets), 'docs/ACTIVE_CONTRACTS.md', 'docs/REGRESSION_LESSONS.md',
  'docs/ENGINEERING_RULES.md', 'docs/UI_IDENTITY.md', 'docs/UI_DESIGN_SYSTEM.md',
]
const archive = 'docs/archive/workflow-20261027'

export function budgetErrors(name, text) {
  const errors = []
  if (Buffer.byteLength(text) > budgets[name]) errors.push(name + ': byte budget exceeded')
  if (name === 'docs/CURRENT_STATE.md') {
    const lines = text.trimEnd().split('\n')
    if (lines.length > 120) errors.push(name + ': more than 120 lines')
    if (lines.some(line => Buffer.byteLength(line) > 600)) errors.push(name + ': line longer than 600 bytes')
  }
  return errors
}

export function acceptanceErrors(body) {
  const errors = []
  const version = body.match(/^Проверенная версия:\s*(.+)$/m)?.[1] ?? ''
  if (!/\b[a-f0-9]{7,64}\b/i.test(version)) errors.push('Acceptance: missing checked commit or content hash')
  const header = '| ID | Результат | Проверка | Статус |'
  const start = body.indexOf(header)
  if (start < 0) return [...errors, 'Acceptance: missing result table']
  const rows = body.slice(start + header.length).trimStart().split('\n')
  const ids = new Set()
  let count = 0
  for (const line of rows) {
    if (!line.trim().startsWith('|')) break
    const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue
    count++
    if (cells.length !== 4) { errors.push('Acceptance: expected four cells'); continue }
    const [id, result, proof, status] = cells
    if (!/^[A-Z][A-Z0-9]*-?\d+$/.test(id) || ids.has(id)) errors.push('Acceptance: missing or duplicate ID ' + id)
    ids.add(id)
    if ([result, proof].some(value => !value || /^(указать|TODO|TBD|ожидаемый результат|тест\/действие)/i.test(value))) {
      errors.push('Acceptance: missing result/evidence for ' + id)
    }
    if (status !== 'проверено' && status !== 'согласован перенос') errors.push('Acceptance: unfinished ' + id)
    if (status === 'согласован перенос' && !/https:\/\//.test(proof)) errors.push('Acceptance: missing owner decision link for ' + id)
  }
  if (!count) errors.push('Acceptance: empty table')
  return errors
}

function inside(root, path) {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

export function checkRepository(root) {
  const errors = []
  for (const name of linkedDocs) {
    const file = resolve(root, name)
    if (!existsSync(file)) { errors.push(name + ': missing'); continue }
    const text = readFileSync(file, 'utf8')
    if (name in budgets) errors.push(...budgetErrors(name, text))
    // Only maintained entry documents; historical links remain historical evidence.
    for (const match of text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const path = resolve(dirname(file), decodeURIComponent(target))
      if (!inside(root, path) || !existsSync(path)) errors.push(name + ': broken local link ' + target)
    }
  }
  const manifest = JSON.parse(readFileSync(resolve(root, archive, 'manifest.json'), 'utf8'))
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !manifest.files.length) errors.push('Archive: invalid provenance')
  for (const item of manifest.files) {
    const path = resolve(root, item.archive)
    if (!inside(resolve(root, archive), path) || !existsSync(path)) {
      errors.push('Archive: missing or outside root ' + item.archive); continue
    }
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (hash !== item.sha256) errors.push('Archive: changed historical source ' + item.source)
  }
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--pr-body')) throw new Error('Usage: check-workflow-docs.mjs [--pr-body FILE]')
    const errors = checkRepository(root)
    if (args.length) errors.push(...acceptanceErrors(readFileSync(args[1], 'utf8')))
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
    else console.log('Workflow docs: budgets, links, archive integrity' + (args.length ? ', acceptance structure' : '') + ' passed. UI quality is not inferred.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
