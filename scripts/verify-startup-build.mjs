import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const controllerIndex = html.indexOf('id="fit-startup-controller"')
const moduleIndex = html.search(/<script[^>]+type="module"[^>]*>/)
const stylesheetIndex = html.search(/<link[^>]+rel="stylesheet"[^>]*>/)

assert.notEqual(controllerIndex, -1, 'Production HTML must contain the startup controller')
assert.notEqual(moduleIndex, -1, 'Production HTML must contain the application module')
assert.notEqual(stylesheetIndex, -1, 'Production HTML must contain the application stylesheet')
assert.ok(
  controllerIndex < moduleIndex,
  'The startup controller must run before the application module',
)
assert.ok(
  controllerIndex < stylesheetIndex,
  'The startup controller must run before a blocking application stylesheet',
)

process.stdout.write('Startup controller precedes production module and stylesheet.\n')
