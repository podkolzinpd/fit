import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(import.meta.dirname, '..')
const source = readFileSync(join(root, 'supabase/functions/parse-workout/index.ts'), 'utf8')
const workflow = readFileSync(join(root, '.github/workflows/deploy-parse-workout-function.yml'), 'utf8')

test('keeps the legacy workout parser to one paid attempt with a 1200-token output cap', () => {
  assert.match(source, /const maxAttempts = goalMode \? 2 : 1/)
  assert.match(source, /const maxTokens = goalMode \? "2000" : "1200"/)
  assert.match(source, /attempt <= maxAttempts/)
  assert.doesNotMatch(source, /attempt < 2/)
  assert.doesNotMatch(source, /attempt === 2/)
})

test('deploys the compatibility function after its parser implementation changes', () => {
  assert.match(workflow, /supabase\/functions\/parse-workout\/\*\*/)
  assert.match(workflow, /services\/api\/src\/legacy-workout-parser\/extracted-workout\.ts/)
  assert.match(workflow, /supabase functions deploy parse-workout/)
  assert.match(workflow, /--no-verify-jwt/)
  assert.match(workflow, /--use-api/)
})
