// Audit fixture only. No credentials, host mounts, published ports or cloud APIs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const image = 'docker.io/library/postgres:17'
const prefix = `fit-return-audit-${process.pid}-${randomBytes(4).toString('hex')}`
const names = [`${prefix}-source`, `${prefix}-target`]
const created = []
const checks = []
let phase = 'preflight'
let freezeStarted
let freezeSeconds
let imageId
let report
const started = performance.now()

function command(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('podman', args, { input, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error('local_command_failed')
  return result
}
function sql(container, text, database = 'fit_audit', allowFailure = false) {
  return command(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-U', 'fit_owner', '-d', database], { input: text, allowFailure })
}
function value(container, text, database) { return sql(container, text, database).stdout.toString().trim() }
function check(name, result) { assert.ok(result, name); checks.push({ name, passed: true }) }
function dump(container) {
  return command(['exec', container, 'pg_dump', '-h', '127.0.0.1', '-U', 'fit_owner', '-d', 'fit_audit', '--format=custom']).stdout
}
function restore(container, archive, allowFailure = false) {
  return command(['exec', '-i', container, 'pg_restore', '-h', '127.0.0.1', '-U', 'fit_owner', '-d', 'fit_audit',
    '--clean', '--if-exists', '--single-transaction', '--no-owner', '--exit-on-error'], { input: archive, allowFailure })
}
function manifest(container) {
  const text = value(container, `select json_build_object(
    'records',(select json_agg(r order by id) from public.records r),
    'children',(select json_agg(c order by id) from public.children c),
    'outbox',(select json_agg(o order by event) from public.outbox o),
    'history',(select json_agg(m order by version) from app_private.fit_migrations m));`)
  return createHash('sha256').update(text).digest('hex')
}
function writer(container, text) {
  return sql(container, `set role fit_api; set fit.actor='1'; ${text}`, 'fit_audit', true)
}
function fence(container) {
  sql(container, 'revoke insert,update,delete on all tables in schema public from fit_api;')
}
function open(container) {
  sql(container, 'grant insert,update,delete on all tables in schema public to fit_api;')
}
const source = names[0], target = names[1]
try {
  imageId = command(['image', 'inspect', image, '--format', '{{.Id}}']).stdout.toString().trim()
  assert.match(imageId, /^[a-f0-9]{64}$/)
  for (const name of names) {
    // Refuse a collision; only resources successfully created by this run are cleaned.
    assert.notEqual(command(['container', 'exists', name], { allowFailure: true }).status, 0)
    command(['run', '--detach', '--pull=never', '--name', name, '--network=none', '--memory=384m',
      '--cpus=1', '--pids-limit=128', '--tmpfs', '/var/lib/postgresql/data:rw',
      '--env', 'POSTGRES_USER=fit_owner', '--env', 'POSTGRES_DB=fit_audit',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image])
    created.push(name)
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      ready = command(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'fit_owner', '-d', 'fit_audit'], { allowFailure: true }).status === 0
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, 'local_postgres_not_ready')
    const version = Number(value(name, 'show server_version_num'))
    assert.ok(version >= 170000 && version < 180000, 'postgres_17_required')
    sql(name, 'create role fit_api nologin;')
  }
  phase = 'fixture'
  sql(source, `create schema app_private;
    create table app_private.fit_migrations(version integer primary key);
    insert into app_private.fit_migrations values(1);
    create table public.records(id integer primary key, tenant integer not null, amount integer not null);
    create table public.children(id integer primary key, record_id integer not null references public.records(id));
    create table public.outbox(event text primary key, outcome text not null, attempts integer not null);
    insert into public.records values(1,1,10),(2,1,20),(3,2,30);
    insert into public.children values(1,1);
    insert into public.outbox values('historical','uncertain',1),('fresh','pending',0);
    alter table public.records enable row level security;
    create policy actor_scope on public.records to fit_api using(tenant=current_setting('fit.actor')::integer)
      with check(tenant=current_setting('fit.actor')::integer);
    grant usage on schema public to fit_api;
    grant select,insert,update,delete on all tables in schema public to fit_api;`)
  sql(target, 'create database fit_preserved_history;')
  sql(target, 'create table preserved(value integer); insert into preserved values(99);', 'fit_preserved_history')
  restore(target, dump(source))
  fence(target)
  check('standby_rejects_write', writer(target, 'update public.records set amount=11 where id=1').status !== 0)
  check('source_accepts_write_before_freeze', writer(source,
    'update public.records set amount=12 where id=1; delete from public.records where id=2; insert into public.records values(4,1,40);').status === 0)
  sql(source, 'alter table public.records add column revision integer not null default 1; insert into app_private.fit_migrations values(2);')
  for (const name of names) command(['exec', name, 'mkdir', '-p', '/tmp/media'])
  command(['exec', '-i', source, 'sh', '-c', 'cat > /tmp/media/updated.bin'], { input: Buffer.from('fixture-v2') })
  command(['exec', '-i', source, 'sh', '-c', 'cat > /tmp/media/new.bin'], { input: Buffer.from('fixture-new') })
  command(['exec', '-i', target, 'sh', '-c', 'cat > /tmp/media/deleted.bin'], { input: Buffer.from('fixture-old') })
  check('precopy_is_detectably_stale', manifest(source) !== manifest(target))
  phase = 'freeze'
  freezeStarted = performance.now()
  fence(source)
  check('old_source_request_rejected_after_fence', writer(source, 'update public.records set amount=100 where id=1').status !== 0)
  // Test cancellation before any destination write, then re-enter the frozen state.
  open(source)
  check('cancel_before_destination_write_reopens_source', writer(source, 'update public.records set amount=12 where id=1').status === 0)
  check('cancel_keeps_destination_fenced', writer(target, 'update public.records set amount=100 where id=1').status !== 0)
  fence(source)
  const finalArchive = dump(source)
  const oldManifest = manifest(target)
  // Keep the TOC/schema readable, but interrupt a later data block. The
  // existing target must survive a restore that already began transactional DDL.
  assert.ok(finalArchive.length > 512, 'fixture_archive_too_small')
  const bad = restore(target, finalArchive.subarray(0, finalArchive.length - 256), true)
  check('interrupted_archive_rejected', bad.status !== 0)
  check('failed_restore_does_not_change_target', oldManifest === manifest(target))
  restore(target, finalArchive)
  check('final_rows_updates_deletions_history_match', manifest(source) === manifest(target))
  restore(target, finalArchive)
  check('repeat_final_restore_is_deterministic_while_fenced', manifest(source) === manifest(target))
  for (const key of ['updated.bin', 'new.bin']) {
    const bytes = command(['exec', source, 'cat', `/tmp/media/${key}`]).stdout
    command(['exec', '-i', target, 'sh', '-c', `cat > /tmp/media/${key}`], { input: bytes })
    const readback = command(['exec', target, 'cat', `/tmp/media/${key}`]).stdout
    check(`synthetic_media_${key}_checksum`, createHash('sha256').update(bytes).digest('hex') === createHash('sha256').update(readback).digest('hex'))
  }
  command(['exec', target, 'rm', '/tmp/media/deleted.bin'])
  check('synthetic_media_deletion_applied', command(['exec', target, 'test', '-e', '/tmp/media/deleted.bin'], { allowFailure: true }).status !== 0)
  check('foreign_key_preserved', sql(target, 'insert into public.children values(2,999)', 'fit_audit', true).status !== 0)
  check('row_security_preserved', value(target, "set role fit_api; set fit.actor='1'; select count(*) from public.records") === '2')
  check('history_of_old_destination_preserved', value(target, 'select value from preserved', 'fit_preserved_history') === '99')
  check('historical_outbox_not_replayed', value(target, "select outcome || ':' || attempts from public.outbox where event='historical'") === 'uncertain:1')
  check('no_background_delivery_during_rehearsal', value(target, "select attempts from public.outbox where event='fresh'") === '0')
  check('restored_destination_stays_fenced', writer(target, 'update public.records set amount=100 where id=1').status !== 0)
  phase = 'open_destination'
  open(target)
  check('destination_accepts_first_write', writer(target, 'update public.records set amount=13 where id=1').status === 0)
  check('source_stays_fenced_after_destination_opens', writer(source, 'update public.records set amount=100 where id=1').status !== 0)
  check('dns_only_return_would_lose_new_write', manifest(source) !== manifest(target))
  freezeSeconds = (performance.now() - freezeStarted) / 1000
  check('fixture_freeze_below_two_hours', freezeSeconds <= 7200)
  report = { status: 'passed', checkedAt: new Date().toISOString(), imageId,
    scope: 'synthetic PostgreSQL and local-file primitive rehearsal; not production cutover acceptance',
    elapsedSeconds: (performance.now() - started) / 1000, freezeSeconds, checks,
    notVerified: ['production throughput and two-hour SLA', 'existing pooled connections and all real writers',
      'cloud IAM and managed PostgreSQL extensions', 'real S3 signed URLs and version/delete semantics',
      'DNS and native clients', 'real API boot after restore', 'historical divergent production reconciliation'] }
} catch {
  console.error(JSON.stringify({ status: 'failed', phase }))
  process.exitCode = 1
} finally {
  for (const name of created.reverse()) {
    const result = command(['rm', '--force', name], { allowFailure: true })
    if (result.error || result.status !== 0) {
      console.error(JSON.stringify({ status: 'failed', phase: 'cleanup' }))
      process.exitCode = 1
    }
  }
}

if (report && process.exitCode !== 1) console.log(JSON.stringify(report, null, 2))
