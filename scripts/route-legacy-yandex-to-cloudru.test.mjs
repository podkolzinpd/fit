import assert from 'node:assert/strict'
import test from 'node:test'
import { compatibilityDnsChange, compatibilityRevision, legacyContainerId } from './route-legacy-yandex-to-cloudru.mjs'

test('legacy DNS modifies only known web/API addresses and preserves mail and delegation', () => {
  const root = { name: 'fit-training.ru.', type: 'A', ttl: '600', data: ['158.160.171.31'] }
  const records = [root, { name: 'fit-training.ru.', type: 'MX', data: ['10 mail.synthetic.'] },
    { name: 'other.fit-training.ru.', type: 'A', data: ['192.0.2.1'] }]
  const change = compatibilityDnsChange(records)
  assert.deepEqual(change.deletions, [root])
  assert.equal(change.additions.length, 3)
  assert.ok(change.additions.every(record => record.type === 'A' && record.data[0] === '87.242.117.210'))
  for (const record of [{ ...root, data: ['192.0.2.5'] }, { ...root, type: 'AAAA', data: ['::1'] },
    { ...root, type: 'CNAME', data: ['unknown.invalid.'] }]) {
    assert.throws(() => compatibilityDnsChange([record]), /unexpected_record/)
  }
})

test('old API compatibility revision cannot access old DB credentials or accidentally deploy another service', () => {
  const previous = { containerId: legacyContainerId, serviceAccountId: 'a'.repeat(20) }
  const image = 'cr.yandex/crp5dt6662a8s2vlt1hm/api:cloudru-compat-' + 'a'.repeat(40)
  const revision = compatibilityRevision(previous, image)
  assert.deepEqual(revision.imageSpec.environment, {})
  assert.equal(revision.secrets, undefined)
  assert.equal(revision.connectivity, undefined)
  assert.equal(revision.logOptions.disabled, true)
  assert.throws(() => compatibilityRevision({ ...previous, containerId: 'other' }, image))
  assert.throws(() => compatibilityRevision(previous, 'cr.yandex/other/api:main'))
})
