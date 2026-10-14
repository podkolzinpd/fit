import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { limeTags } from './fit-lime-ci-scope.mjs'

export const fitLimeSpecs = {
  behavior: 'e2e/fit-lime.behavior.spec.ts',
  visual: 'e2e/trainer-schedule-v2.visual.spec.ts',
}

export function fitLimeArgs(project, mode, tagList = '', lane = 'all', shard = '1/1') {
  if (!['mobile-chromium', 'lime-acceptance-webkit'].includes(project)) throw new Error('Unknown Fit Lime browser project')
  if (!['all', ...Object.keys(fitLimeSpecs)].includes(lane)) throw new Error('Unknown Fit Lime lane')
  if (!/^[1-4]\/[1-4]$/.test(shard) || Number(shard[0]) > Number(shard[2])
    || (lane !== 'visual' && shard !== '1/1')) throw new Error('Invalid Fit Lime shard')
  const files = lane === 'all' ? Object.values(fitLimeSpecs) : [fitLimeSpecs[lane]]
  const args = ['test', ...files, `--project=${project}`, '--workers=2']
  if (shard !== '1/1') args.push(`--shard=${shard}`)
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
  return tags.length ? specs.filter(spec => tags.some(tag => spec.tags?.includes(`lime-${tag}`))).length : specs.length
}

function main() {
  if (process.env.FIT_SCHEDULE_V2_VISUAL !== '1') throw new Error('Fit Lime acceptance must be enabled; refusing a skipped browser gate')
  const selection = fitLimeArgs(...process.argv.slice(2))
  const cli = resolve('node_modules/playwright/cli.js')
  // Validate the combined feature inventory before selecting a lane: a feature
  // may live entirely in visual acceptance, while critical behavior still runs.
  const collection = spawnSync(process.execPath, [cli, 'test', ...Object.values(fitLimeSpecs),
    `--project=${process.argv[2]}`, '--list', '--reporter=json'], { encoding: 'utf8', timeout: 60000 })
  if (collection.status !== 0) throw new Error('Fit Lime inventory collection failed')
  validateFitLimeInventory(JSON.parse(collection.stdout), selection.tags)
  const partition = spawnSync(process.execPath, [cli, ...selection.args, '--list', '--reporter=json'],
    { encoding: 'utf8', timeout: 60000 })
  if (partition.status !== 0) throw new Error('Fit Lime partition collection failed')
  const count = validateFitLimeInventory(JSON.parse(partition.stdout), [])
  console.log(`Fit Lime ${process.argv[5] ?? 'all'} ${process.argv[6] ?? '1/1'}: ${count} cases; mode=${process.argv[3]}`)
  const reporter = `${process.env.CI ? 'github' : 'list'},./scripts/fit-lime-timing-reporter.mjs`
  const result = spawnSync(process.execPath, [cli, ...selection.args, `--reporter=${reporter}`], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
