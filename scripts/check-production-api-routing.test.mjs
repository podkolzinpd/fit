import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { productionApiOrigin, validateProductionApiRouting } from './check-production-api-routing.mjs'

const ready = {
  VITE_YANDEX_API_BASE_URL: productionApiOrigin,
  VITE_YANDEX_APP_SESSION_ENABLED: 'true', VITE_YANDEX_MAIN_ROUTING_ENABLED: 'true',
  VITE_YANDEX_ONLY_AUTH_ENABLED: 'true', VITE_YANDEX_NATIVE_REGISTRATION_ENABLED: 'true',
}

test('web and native production routing uses one provider-independent HTTPS origin', () => {
  assert.deepEqual(validateProductionApiRouting(ready), [])
  assert.deepEqual(validateProductionApiRouting({ ...ready, VITE_YANDEX_API_BASE_URL: productionApiOrigin + '/' }), [])
  for (const value of [undefined, '', 'https://old.containers.yandexcloud.net',
    'http://api.fit-training.ru', productionApiOrigin + '?token=private']) {
    const errors = validateProductionApiRouting({ ...ready, VITE_YANDEX_API_BASE_URL: value })
    assert.ok(errors.length > 0)
    assert.ok(!errors.join().includes('private'))
  }
})

test('production routing cannot silently fall back to the legacy backend or session', () => {
  for (const name of Object.keys(ready).filter(name => name.endsWith('_ENABLED'))) {
    for (const value of [undefined, '', 'false', 'TRUE']) {
      assert.ok(validateProductionApiRouting({ ...ready, [name]: value }).length > 0, name)
    }
  }
})

test('speech activation accepts only the authenticated canonical relay', () => {
  for (const value of [undefined, '', 'wss://api.fit-training.ru/stt']) {
    assert.deepEqual(validateProductionApiRouting({ ...ready, VITE_SPEECHKIT_RELAY_URL: value }), [])
  }
  for (const value of ['wss://old.sslip.io/stt', 'ws://api.fit-training.ru/stt', 'wss://api.fit-training.ru/stt?session=private']) {
    const errors = validateProductionApiRouting({ ...ready, VITE_SPEECHKIT_RELAY_URL: value })
    assert.ok(errors.length > 0)
    assert.ok(!errors.join().includes('private'))
  }
})

test('current Cloud.ru web and Android auth builds validate the canonical contract before building', () => {
  for (const name of ['prepare-cloudru-frontend.yml', 'android-build.yml']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')
    assert.ok(workflow.includes(`VITE_YANDEX_API_BASE_URL: ${productionApiOrigin}`), name)
    assert.ok(workflow.includes('node scripts/check-production-api-routing.mjs'), name)
    assert.ok(!workflow.includes('https://bbat47es6kspjb3dvfn2.containers.yandexcloud.net\n'), name)
  }
})
