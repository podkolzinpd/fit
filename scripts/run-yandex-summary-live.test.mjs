import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const smokeUrl = new URL('run-yandex-summary-live.mjs', import.meta.url).href
const contractUrl = new URL('services/api/src/legacy-summary/summary-contract.ts', root).href

// The child executes the real CLI, but its fetch can only return synthetic responses.
// Assertions inside fetch also prove that the CLI uses the canonical native contract.
function runSmoke({ envFile = false, upstreamError = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fit-summary-smoke-'))
  const fixture = join(directory, 'training.json')
  const environment = join(directory, 'smoke.env')
  writeFileSync(fixture, '{}')
  writeFileSync(environment, 'YANDEX_CLOUD_API_KEY="synthetic-key"\nYANDEX_CLOUD_FOLDER_ID=synthetic-folder\nYANDEX_CLOUD_MODEL_ID=fixture-model\n')
  const source = `
    import assert from 'node:assert/strict';
    import { SUMMARY_JSON_SCHEMA, SUMMARY_SYSTEM_PROMPT } from ${JSON.stringify(contractUrl)};
    process.argv = [process.execPath, ${JSON.stringify(smokeUrl)},
      ${envFile ? JSON.stringify(pathToFileURL(environment).href) : 'undefined'},
      ${JSON.stringify(pathToFileURL(fixture).href)}];
    let calls = 0;
    const summary = {
      trainer: { headline: 'За период завершено 2 тренировки.',
        progress: ['Подтверждены результаты двух тренировок.'],
        consistency: 'За период завершено 2 тренировки.', attention: [] },
      client: { headline: 'За период завершено 2 тренировки.',
        achievements: ['Стабильность: подтверждены результаты двух тренировок.'],
        consistency: 'За период завершено 2 тренировки.', encouragement: 'Результаты сохранены.',
        goalAlignment: '', nextSteps: ['Сохранить текущий ритм.'], missingContext: [],
        analysisVersion: 'trainer-summary-v3' }
    };
    globalThis.fetch = async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
      assert.equal(init.headers.Authorization, 'Api-Key synthetic-key');
      const request = JSON.parse(init.body);
      assert.equal(request.modelUri, 'gpt://synthetic-folder/fixture-model/latest');
      assert.deepEqual(request.jsonSchema.schema, SUMMARY_JSON_SCHEMA);
      assert.deepEqual(request.completionOptions, { stream: false, temperature: 0.1, maxTokens: '1800' });
      assert.deepEqual(request.messages[0], { role: 'system', text: SUMMARY_SYSTEM_PROMPT });
      assert.deepEqual(JSON.parse(request.messages[1].text), { completed_workouts: {} });
      if (${upstreamError}) return new Response('synthetic-key', { status: 503 });
      if (calls === 2) {
        assert.equal(request.messages.length, 4);
        assert.match(request.messages[3].text, /Предыдущий JSON не прошёл автоматическую проверку/);
      }
      assert.ok(calls <= 2);
      return Response.json({ result: {
        alternatives: [{ message: { text: JSON.stringify(calls === 1
          ? { ...summary, client: { ...summary.client, consistency: 'Ты хорошо поддерживал ритм тренировок.' } }
          : summary) } }],
        usage: { totalTokens: '100' }, modelVersion: 'fixture-version'
      } });
    };
    await import(${JSON.stringify(smokeUrl)});
  `
  try {
    return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, YANDEX_CLOUD_API_KEY: 'synthetic-key',
        YANDEX_CLOUD_FOLDER_ID: 'synthetic-folder', YANDEX_CLOUD_MODEL_ID: 'fixture-model' },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const envFile of [false, true]) {
  test(`native smoke preserves quality retry and usage with ${envFile ? 'explicit env file' : 'process env'}`, () => {
    const result = runSmoke({ envFile })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.attempts, 2)
    assert.equal(output.usage.totalTokens, '200')
    assert.equal(output.model_version, 'fixture-version')
    assert.equal(output.summary.client.consistency, 'За период завершено 2 тренировки.')
  })
}

test('native smoke masks credentials in upstream errors', () => {
  const result = runSmoke({ upstreamError: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Yandex Cloud returned HTTP 503: \[MASKED\]/)
  assert.doesNotMatch(result.stderr, /synthetic-key/)
})
