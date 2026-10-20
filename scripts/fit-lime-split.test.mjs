import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { fitLimeArgs, fitLimeSpecs, validateFitLimeInventory } from './run-fit-lime-ci.mjs'
import FitLimeTimingReporter from './fit-lime-timing-reporter.mjs'
import { fitLimePartitions } from './fit-lime-ci-scope.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = workflow.slice(workflow.indexOf('  e2e-fit-lime:\n'), workflow.indexOf('  e2e:\n'))
const matrix = job.slice(job.indexOf('      matrix:\n'), job.indexOf('    env:\n'))
const engines = [...matrix.matchAll(/- project: (\S+)\n\s+browser: (\S+)/g)].map(([, project, browser]) => ({ project, browser }))
const partitions = fitLimePartitions('full')

test('CI requires behavior and every visual shard in each existing engine', () => {
  assert.deepEqual(engines, [
    { project: 'mobile-chromium', browser: 'chromium' },
    { project: 'lime-acceptance-webkit', browser: 'webkit' },
  ])
  assert.deepEqual(partitions, [
    { lane: 'behavior', shard: '1/1' }, ...[1, 2, 3, 4].map(i => ({ lane: 'visual', shard: `${i}/4` })),
  ])
  assert.match(matrix, /acceptance: \$\{\{ fromJSON\(needs\.e2e-scope\.outputs\.lime_partitions\) \}\}/)
  assert.match(workflow, /lime_partitions: \$\{\{ steps\.lime-scope\.outputs\.partitions \}\}/)
  assert.match(job, /fail-fast: false/)
  assert.doesNotMatch(job, /continue-on-error/)
  assert.match(workflow, /e2e:\n    needs: \[e2e-scope, e2e-yandex-auth, e2e-visual, e2e-chromium, e2e-webkit, e2e-fit-lime\]/)
})

test('small scoped PRs use two lanes without four-way visual setup duplication', () => {
  assert.deepEqual(fitLimePartitions('scoped'), [{ lane: 'behavior', shard: '1/1' }, { lane: 'visual', shard: '1/1' }])
  assert.throws(() => fitLimePartitions('unknown'))
})

test('lane/shard selectors cannot omit an unknown partition or inject arguments', () => {
  for (const lane of ['', 'unknown', '--grep=none']) assert.throws(() => fitLimeArgs('mobile-chromium', 'full', '', lane))
  for (const shard of ['', '0/4', '5/4', '2/1', '1/8', '1/4 --grep=none']) {
    assert.throws(() => fitLimeArgs('mobile-chromium', 'full', '', 'visual', shard))
  }
  assert.throws(() => fitLimeArgs('mobile-chromium', 'full', '', 'behavior', '1/4'))
  assert.throws(() => fitLimeArgs('mobile-chromium', 'full', '', 'all', '1/4'))
  assert.equal(validateFitLimeInventory({ suites: [{ specs: [{}] }] }, []), 1)
})

test('behavior has no image capture, CSS/geometry or font assertions', () => {
  const source = readFileSync(join(root, fitLimeSpecs.behavior), 'utf8')
  assert.doesNotMatch(source, /\.screenshot\(|\.toHaveCSS\(|\.boundingBox\(|getBoundingClientRect|document\.fonts|scrollWidth/)
  assert.match(source, /test\.skip\(!process\.env\.FIT_SCHEDULE_V2_VISUAL/)
})

test('shared fixtures declare no tests and create mutable state inside page-scoped factories', () => {
  const path = join(root, 'e2e/fit-lime-fixtures.ts')
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.getText(ast), 'test')
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(ast.statements.some(n => ts.isFunctionDeclaration(n) && n.name.text === 'mockPilot'))
})

test('finance/template visual matrices cannot grow back into full business chains', () => {
  const source = readFileSync(join(root, fitLimeSpecs.visual), 'utf8')
  const ast = ts.createSourceFile(fitLimeSpecs.visual, source, ts.ScriptTarget.Latest, true)
  const bodies = new Map()
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'test') {
      const title = node.arguments[0].getText(ast)
      const callback = node.arguments.find(ts.isArrowFunction)
      if (callback && /Finance payment layout and keyboard|Template diagnostic layout/.test(title)) {
        bodies.set(title.includes('Finance') ? 'finance' : 'template', callback.getText(ast))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(bodies.size, 2)
  assert.match(bodies.get('finance'), /seedPaidFinanceFixture\(ledger\)/)
  assert.match(bodies.get('finance'), /height: 400/)
  assert.doesNotMatch(bodies.get('finance'), /menuitem|receiptIds|\.voidedAt|commands/)
  assert.match(bodies.get('template'), /copyTemplateDiagnostic\(page\)/)
  assert.doesNotMatch(bodies.get('template'), /page\.clock|page\.reload|commands|\/health|rows\.size/)
})

test('real Playwright partitions preserve the 669-case union without duplicates in either engine', () => {
  const collect = (args) => {
    const result = spawnSync(process.execPath, [join(root, 'node_modules/playwright/cli.js'), ...args, '--list', '--reporter=json'],
      { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, FIT_SCHEDULE_V2_VISUAL: '1' } })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout), cases = []
    assert.ok(!report.errors?.length)
    function visit(suite) {
      for (const spec of suite.specs ?? []) cases.push(`${spec.file}:${spec.line}:${spec.column}:${spec.title}`)
      for (const child of suite.suites ?? []) visit(child)
    }
    visit(report)
    return cases
  }
  for (const { project } of engines) {
    const full = collect(fitLimeArgs(project, 'full').args)
    assert.equal(full.length, 669) // Previous662 + seven YAFIT-627 Live execution-mode cases (timer/person, confirm, prep in person mode).
    for (const width of [375, 390, 430, 1440]) {
      assert.equal(full.filter(key => key.endsWith(`Figma workout Coach reference full editor ${width}`)).length, 1)
      assert.equal(full.filter(key => key.endsWith(`Figma workout Coach reference schedule guides and filters ${width}`)).length, 1)
    }
    assert.equal(full.filter(key => key.endsWith('Trainer restores archived client before sharing an invitation')).length, 1)
    assert.equal(full.filter(key => key.endsWith('Invitation denial refreshes an already-connected client')).length, 1)
    assert.equal(full.filter(key => key.endsWith('Coach copied plan replaces exercises, preserves values and retries a failed save')).length, 1)
    assert.equal(full.filter(key => key.endsWith('Lime notification settings show safe diagnostics when browser push initialization fails')).length, 1)
    assert.equal(full.filter(item => item.includes('Figma workout Coach plan input ')).length, 4)
    assert.equal(full.filter(key => key.includes('Client Lime compact Live composition ')).length, 4)
    assert.equal(full.filter(key => key.endsWith('Client Lime Live gradual keyboard keeps the edited row visible')).length, 1)
    for (const title of ['Client Lime grouped drag preserves facts drafts and exact retry', 'Client Lime pointer drag autoscrolls and preserves draft', 'Client Lime touch drag autoscrolls and preserves draft']) assert.equal(full.filter(key => key.endsWith(title)).length, 1)
    for (const role of ['client', 'trainer']) assert.equal(full.filter(key => key.endsWith(`Lime Live direct input keeps confirmed facts editable ${role}`)).length, 1)
    assert.equal(full.filter((item) => item.includes('Client Lime empty workouts creation and equal controls ')).length, 4)
    // Original 16 finance + 9 template visual configurations remain; their
    // long chains now run just once per Mono/Lime surface in each engine.
    assert.equal(full.filter(key => key.includes('Finance payment layout and keyboard')).length, 16)
    assert.equal(full.filter(key => key.includes('Template diagnostic layout')).length, 9)
    assert.equal(full.filter(key => key.includes('Finance payment lifecycle behavior')).length, 2)
    assert.equal(full.filter(key => key.includes('Template slow connection and diagnostic retry behavior')).length, 2)
    const financeTitles = [false, true].flatMap(lime => ['light', 'dark'].flatMap(theme =>
      [320, 390, 430, 1440].map(width => `Finance payment layout and keyboard ${lime ? 'Lime' : 'Mono'} ${theme} ${width}`)))
    const templateTitles = [[false, 'light'], [false, 'dark'], [true, 'dark']].flatMap(([lime, theme]) =>
      [390, 430, 1440].map(width => `Template diagnostic layout ${width} lime=${lime} ${theme}`))
    for (const title of [...financeTitles, ...templateTitles]) assert.equal(full.filter(key => key.endsWith(title)).length, 1, title)
    const parts = partitions.flatMap(({ lane, shard }) => collect(fitLimeArgs(project, 'full', '', lane, shard).args))
    assert.equal(parts.length, full.length)
    assert.equal(new Set(parts).size, parts.length)
    assert.deepEqual(parts.sort(), full.sort())
    const scoped = collect(fitLimeArgs(project, 'scoped', 'critical,finance').args)
    const scopedParts = fitLimePartitions('scoped').flatMap(({ lane, shard }) =>
      collect(fitLimeArgs(project, 'scoped', 'critical,finance', lane, shard).args))
    assert.equal(scoped.length, 104) // Existing100 + compact Live layout assertions.
    assert.equal(new Set(scopedParts).size, scopedParts.length)
    assert.deepEqual(scopedParts.sort(), scoped.sort())
  }
})

test('timing report records retries and durations but excludes titles and runtime payloads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-lime-timing-test-'))
  try {
    const reporter = new FitLimeTimingReporter()
    reporter.onBegin({ projects: [{ outputDir: directory }] })
    reporter.onTestEnd({ id: 'synthetic-case', title: 'not-for-export', location: { file: '/workspace/e2e/fixture.spec.ts', line: 12, column: 1 },
      parent: { project: () => ({ name: 'webkit' }) } }, {
      duration: 8000, retry: 1, status: 'passed', errors: ['not-for-export'], stdout: ['not-for-export'], attachments: ['not-for-export'],
    })
    reporter.onEnd({ status: 'passed', duration: 9000 })
    const raw = readFileSync(join(directory, 'lime-timings.json'), 'utf8')
    assert.doesNotMatch(raw, /not-for-export|workspace|attachments|errors|stdout/)
    const report = JSON.parse(raw)
    assert.equal(report.attempts[0].durationMs, 8000)
    assert.equal(report.attempts[0].retry, 1)
    assert.equal(report.status, 'passed')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
