import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectRosterOwners, readRosterTargets, rosterOwnerQuery } from './cloudru-account-links-audit.mjs'
import { readAccountLinkTargets, inspectAccountLinks } from './cloudru-account-links-audit.mjs'

const input = { rosterNameHashes: ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)] }
const id = '11111111-1111-4111-8111-111111111111'
const owner = { trainer_id: id, account_role: 'trainer', yandex_linked: true,
  matched_names: 3, matched_cards: 3, ambiguous_names: 0, active_clients: 8, matched_ordinals: [1,2,3] }
function fixture(rows = [owner], gate = { username: 'fit_owner', readonly: 'on' }) {
  const calls = []
  return { calls, async query(sql, params) {
    calls.push({ sql, params })
    return { rows: sql.includes('current_user') ? [gate] : sql === rosterOwnerQuery ? rows : [] }
  } }
}

test('roster input accepts only a bounded exact private signature and is separate from email matching', () => {
  assert.deepEqual(readAccountLinkTargets(JSON.stringify(input)), input)
  for (const value of [null,{}, {rosterNameHashes:[]}, {rosterNameHashes:input.rosterNameHashes.slice(0,2)},
    {rosterNameHashes:Array(31).fill('a'.repeat(64))}, {rosterNameHashes:['a'.repeat(64),'a'.repeat(64),'c'.repeat(64)]},
    {rosterNameHashes:['private name',...input.rosterNameHashes.slice(1)]}, {...input,trainerId:id}, {...input,emailHashes:[]}]) {
    assert.throws(() => readRosterTargets(value), /targets_invalid/)
  }
})

test('roster search requires fit_owner and active READ ONLY before reading application data', async () => {
  for (const gate of [{username:'fit_owner',readonly:'off'}, {username:'fit_api',readonly:'on'}]) {
    const db = fixture([],gate)
    await assert.rejects(inspectRosterOwners(db,input), /readonly_required/)
    assert.equal(db.calls.at(-1).sql,'rollback')
    assert.equal(db.calls.some(call => call.sql === rosterOwnerQuery),false)
  }
})

test('all supplied clients may be a subset of a larger roster; no identity or private identifier is emitted', async () => {
  const db = fixture()
  const result = await inspectAccountLinks(db,input,[])
  assert.equal(result.completeMatches,1)
  assert.equal(result.candidates[0].activeClients,8)
  assert.equal(result.actorSelected,false)
  assert.equal(result.productionMutated,false)
  const output=JSON.stringify(result)
  for (const privateValue of [id,...input.rosterNameHashes]) assert.equal(output.includes(privateValue),false)
  assert.equal(db.calls.at(-1).sql,'commit')
  assert.ok(db.calls.every(({sql}) => !/^\s*(insert|update|delete|grant|alter|create|drop)\b/i.test(sql)))
  assert.match(rosterOwnerQuery,/is_active_client_trainer_connection/)
  assert.match(rosterOwnerQuery,/coalesce\(m.alias,c.full_name\)/)
})

test('multiple complete owners remain ambiguous and never select an actor', async () => {
  const result = await inspectRosterOwners(fixture([owner,{...owner,trainer_id:'22222222-2222-4222-8222-222222222222'}]),input)
  assert.equal(result.completeMatches,2)
  assert.equal(result.actorSelected,false)
})

test('duplicate cards, wrong role or a missing Yandex identity cannot become a complete match', async () => {
  for (const row of [{...owner,ambiguous_names:1}, {...owner,matched_cards:2},
    {...owner,account_role:'client'}, {...owner,yandex_linked:false}]) {
    const result=await inspectRosterOwners(fixture([row]),input)
    assert.equal(result.completeMatches,0)
    assert.equal(result.actorSelected,false)
  }
})

test('overflow or malformed evidence rolls back without a partial owner result', async () => {
  for (const rows of [Array(11).fill(owner),[{...owner,active_clients:1001}], [{...owner,trainer_id:'untrusted'}],
    [{...owner,matched_ordinals:[1,1,3]}], [{...owner,matched_ordinals:[1,2,4]}]]) {
    const db=fixture(rows)
    await assert.rejects(inspectRosterOwners(db,input), /scope_exceeded/)
    assert.equal(db.calls.at(-1).sql,'rollback')
  }
})
