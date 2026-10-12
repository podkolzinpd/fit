import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { limeTags } from './fit-lime-ci-scope.mjs'

export function fitLimeArgs(project, mode, tagList = '') {
  if (!['mobile-chromium', 'lime-acceptance-webkit'].includes(project)) throw new Error('Unknown Fit Lime browser project')
  const args = ['test', 'e2e/trainer-schedule-v2.visual.spec.ts', `--project=${project}`, '--workers=2']
  if (mode === 'full' && tagList === '') return { args, tags: [] }
  const tags = tagList.split(',')
  if (mode !== 'scoped' || !tags.includes('critical') || tags.length < 2
    || new Set(tags).size !== tags.length || tags.some(tag => !limeTags.includes(tag))) {
    throw new Error('Invalid Fit Lime selection; refusing an empty or unverified browser gate')
  }
  args.push(`--grep=@lime-(${tags.join('|')})\\b`)
  return { args, tags }
}

export function validateFitLimeInventory(report, tags) {
  const specs = []
  const visit = suite => { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child) }
  for (const suite of report.suites ?? []) visit(suite)
  if (report.errors?.length || specs.length === 0) throw new Error('Fit Lime collection failed or is empty')
  for (const tag of tags) {
    if (!specs.some(spec => spec.tags?.includes(`lime-${tag}`))) throw new Error(`Missing Fit Lime inventory tag: ${tag}`)
  }
  return specs.filter(spec => tags.some(tag => spec.tags?.includes(`lime-${tag}`))).length
}

function main() {
  if (process.env.FIT_SCHEDULE_V2_VISUAL !== '1') throw new Error('Fit Lime acceptance must be enabled; refusing a skipped browser gate')
  const selection = fitLimeArgs(...process.argv.slice(2))
  const cli = resolve('node_modules/playwright/cli.js')
  if (selection.tags.length > 0) {
    const collection = spawnSync(process.execPath, [cli, 'test', 'e2e/trainer-schedule-v2.visual.spec.ts',
      selection.args[2], '--list', '--reporter=json'], { encoding: 'utf8', timeout: 60000 })
    if (collection.status !== 0) throw new Error('Fit Lime inventory collection failed')
    const count = validateFitLimeInventory(JSON.parse(collection.stdout), selection.tags)
    console.log(`Scoped Fit Lime acceptance: ${count} cases; ${selection.tags.join(', ')}`)
  } else console.log('Full Fit Lime release acceptance; no grep or test limit')
  const result = spawnSync(process.execPath, [cli, ...selection.args], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
