import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readRestoreTarget, planClientRestore, applyClientRestore, verifyClientRestore, type RestorePlan } from '../../../../scripts/cloudru-client-restore.mjs'

const source = process.env.TEST_DATABASE_URL
const database = `fit_client_restore_${process.pid}`
describe.skipIf(source === undefined)('owner-approved canonical client restoration with real RLS', () => {
  let admin: Pool, owner: Pool, runtime: Pool
  let created = false, createdOwner = false
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_test_database_required')
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query('begin')
    await admin.query('select pg_advisory_xact_lock(193635,1)')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_api'")).rowCount) await admin.query('create role fit_api')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_owner'")).rowCount) {
      await admin.query('create role fit_owner'); createdOwner = true
    }
    await admin.query('commit')
    await admin.query(`create database ${database} owner fit_owner`); created = true
    url.pathname = `/${database}`
    // Test-only SET ROLE matches the existing operational-test bootstrap.
    // Production connects directly with its protected owner/runtime credentials.
    owner = new Pool({ connectionString: url.href, options: '-c role=fit_owner', max: 2 })
    const migrating = await owner.connect()
    try {
      await runner({ dbClient: migrating, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
        direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
        createMigrationsSchema: true, verbose: false, log: () => {} })
    } finally { migrating.release() }
    runtime = new Pool({ connectionString: url.href, options: '-c role=fit_api', max: 1 })
  })
  afterAll(async () => {
    if (runtime) await runtime.end()
    if (owner) await owner.end()
    if (created) await admin.query(`drop database ${database}`)
    if (createdOwner) await admin.query('drop role fit_owner')
    if (admin) await admin.end()
  })
  async function fixture() {
    const athleteId = randomUUID(), trainerId = randomUUID(), other = randomUUID(), card = randomUUID(), old = randomUUID()
    await owner.query(`insert into public.profiles(id,first_name,account_role) values
      ($1,'Synthetic athlete','client'),($2,'Synthetic trainer','trainer'),($3,'Synthetic other','trainer')`, [athleteId, trainerId, other])
    await owner.query('insert into public.trainers(profile_id) values($1),($2)', [trainerId, other])
    await owner.query(`insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic canonical')`, [card, athleteId])
    await owner.query(`insert into public.clients(id,trainer_id,full_name,merged_into_client_id,archived_at) values($1,$2,'Synthetic merged source',$3,now())`, [old, trainerId, card])
    await owner.query(`insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,'Private synthetic note') on conflict do nothing`, [old, trainerId])
    await owner.query(`insert into public.client_trainer_relationships(client_id,trainer_id,status,connected_at,disconnected_at,connected_by,disconnected_by)
      values($1,$2,'disconnected',now()-interval '10 days',now()-interval '5 days',$3,$3)`, [card, trainerId, athleteId])
    const workouts = (await owner.query<{ id: string }>(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,completed_at,notes)
      select $1,$2,$3,current_date-n,'done',now()-interval '1 day','Private synthetic result' from generate_series(1,21) n returning id`, [card, athleteId, trainerId])).rows
    const exercise = (await owner.query<{ id: string }>(`insert into public.workout_exercises(workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
      values($1,$2,$3,0,'system','fixture:restore','Synthetic exercise','back','strength') returning id`, [workouts[0]!.id, athleteId, card])).rows[0]!
    await owner.query(`insert into public.workout_sets(workout_exercise_id,trainer_id,client_id,position,plan_weight_kg,plan_reps,fact_weight_kg,fact_reps,confirmed_at)
      values($1,$2,$3,0,10,12,12,10,now())`, [exercise.id, athleteId, card])
    return { athleteId, trainerId, other, card, old }
  }
  async function plan(f: { athleteId: string; trainerId: string }) {
    const c = await owner.connect(); try { return await planClientRestore(c, readRestoreTarget(JSON.stringify({ trainerProfileId: f.trainerId, athleteProfileId: f.athleteId }))) } finally { c.release() }
  }
  async function apply(p: RestorePlan, backupVerified = true) {
    const c = await owner.connect(); try { return await applyClientRestore(c, p, { backupVerified }) } finally { c.release() }
  }
  async function verify(p: RestorePlan) {
    const c = await runtime.connect(); try { return await verifyClientRestore(c, p) } finally { c.release() }
  }
  it('restores only the canonical connection, keeps old periods/results/notes and verifies actual fit_api visibility', async () => {
    const f = await fixture(), p = await plan(f)
    await expect(verify(p)).rejects.toThrow('runtime_receipt')
    await expect(apply(p, false)).rejects.toThrow('backup_required')
    expect(await apply(p)).toMatchObject({ replayed: false, historyUnchanged: true, done: 21 })
    expect(await verify(p)).toMatchObject({ trainerCanReadCanonical: true, done: 21 })
    expect(await apply(p)).toMatchObject({ replayed: true, historyUnchanged: true })
    const periods = (await owner.query('select status,count(*)::int count from public.client_trainer_relationships where client_id=$1 group by status order by status', [f.card])).rows
    expect(periods).toEqual([{ status: 'active', count: 1 }, { status: 'disconnected', count: 1 }])
    const notes = (await owner.query('select note from public.client_trainers where client_id=any($1::uuid[]) and trainer_id=$2', [[f.old, f.card], f.trainerId])).rows
    expect(notes).toEqual([{ note: 'Private synthetic note' }, { note: 'Private synthetic note' }])
    expect(JSON.stringify(p.report)).not.toContain(f.athleteId)
    expect(JSON.stringify(p.report)).not.toContain('Private synthetic')
  })
  it('rejects missing, swapped or unrelated native profiles before any restoration', async () => {
    const f = await fixture()
    await expect(plan({ trainerId: f.athleteId, athleteId: f.trainerId })).rejects.toThrow('role')
    await expect(plan({ trainerId: randomUUID(), athleteId: f.athleteId })).rejects.toThrow('role')
    await expect(plan({ trainerId: f.other, athleteId: f.athleteId })).rejects.toThrow('source')
    expect((await owner.query("select count(*)::int count from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows).toEqual([{ count: 0 }])
    expect((await owner.query('select client_id from public.client_trainers where client_id=$1 and trainer_id=$2', [f.card, f.trainerId])).rows).toEqual([])
  })
  it('rejects a concurrent trainer and preserves all state without restoring a second active trainer', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.other, f.athleteId])
    await expect(apply(p)).rejects.toThrow('other_trainer')
    expect((await owner.query('select trainer_id from public.client_trainer_relationships where client_id=$1 and status=$2', [f.card, 'active'])).rows).toEqual([{ trainer_id: f.other }])
  })
  it('does not certify another period or a lost restored membership', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [f.card, f.trainerId])
    await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.trainerId, f.athleteId])
    await expect(verify(p)).rejects.toThrow('runtime_receipt')
    const g = await fixture(), q = await plan(g)
    await apply(q)
    await owner.query('delete from public.client_trainers where client_id=$1 and trainer_id=$2', [g.card, g.trainerId])
    await expect(verify(q)).rejects.toThrow('runtime_receipt')
    await expect(apply(q)).rejects.toThrow('restored_membership_missing')
  })
  it('a changed result invalidates the plan and a new real disconnect cannot be undone by replay', async () => {
    const f = await fixture(), p = await plan(f)
    await owner.query('update public.workouts set notes=$2 where client_id=$1', [f.card, 'New synthetic result'])
    await expect(apply(p)).rejects.toThrow('state_changed')
    const current = await plan(f); await apply(current)
    await owner.query(`update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2 where id=$1`, [current.periodId, f.athleteId])
    await expect(apply(current)).rejects.toThrow('restored_period_ended')
    expect((await owner.query<{ count: number }>("select count(*)::int count from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]?.count).toBe(0)
  })
  it('rolls back even the membership insert when a later operation fails', async () => {
    const f = await fixture(), p = await plan(f), c = await owner.connect()
    try {
      await expect(applyClientRestore({ query: (sql: string, values?: unknown[]) => {
        if (typeof sql === 'string' && sql.startsWith('insert into public.client_trainer_relationships')) return Promise.reject(Error('synthetic late failure'))
        return c.query(sql, values)
      } }, p, { backupVerified: true })).rejects.toThrow('synthetic late failure')
      expect((await c.query('select client_id from public.client_trainers where client_id=$1 and trainer_id=$2', [f.card, f.trainerId])).rows).toEqual([])
    } finally { c.release() }
  })
  async function privateFixture() {
    const f = await fixture()
    for (const id of [f.athleteId, f.trainerId]) await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [createHash('sha256').update(id).digest('hex'), id])
    const workoutIds = (await owner.query<{ id: string }>("select id from public.workouts where client_id=$1 and status='done' order by id", [f.card])).rows.map(w => w.id)
    await owner.query(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,notes)
      values($1,$2,$3,current_date,'planned','Keep planned'),($1,$2,$3,current_date,'cancelled','Keep cancelled')`, [f.card, f.athleteId, f.trainerId])
    await owner.query("insert into public.trainer_finance_packages(trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,'Preserve synthetic finance',10,50000,current_date)", [f.trainerId, f.card])
    return { ...f, expected: { clientId: f.card, workoutIds, workouts: 21, exercises: 1, sets: 1 } }
  }
  async function privatePlan(f: Awaited<ReturnType<typeof privateFixture>>, evidence?: { messageSha256: string; since: string }) {
    const c = await owner.connect()
    try { return await planClientRestore(c, { trainerId: f.trainerId, athleteId: f.athleteId }, f.expected, evidence) } finally { c.release() }
  }
  it('private proven history preserves planned/cancelled rows and finance and verifies BOTH runtime actors', async () => {
    const f = await privateFixture()
    await expect(plan(f)).rejects.toThrow('history')
    const before = (await owner.query('select to_jsonb(w) value from public.workouts w where client_id=$1 order by id', [f.card])).rows
    const financial = (await owner.query('select to_jsonb(p) value from public.trainer_finance_packages p where client_id=$1 order by id', [f.card])).rows
    const p = await privatePlan(f)
    await expect(apply(p, false)).rejects.toThrow('backup_required')
    expect(await apply(p)).toMatchObject({ historyUnchanged: true, replayed: false, done: 21 })
    expect(await verify(p)).toMatchObject({ trainerCanReadCanonical: true, athleteCanReadCanonical: true, athleteCanReadTrainer: true, bothCanReadImported: true, done: 21 })
    expect((await owner.query('select to_jsonb(w) value from public.workouts w where client_id=$1 order by id', [f.card])).rows).toEqual(before)
    expect((await owner.query('select to_jsonb(p) value from public.trainer_finance_packages p where client_id=$1 order by id', [f.card])).rows).toEqual(financial)
    expect(await apply(p)).toMatchObject({ replayed: true, historyUnchanged: true })
  })
  it('private history rejects another canonical card or missing native identity before repair', async () => {
    const f = await privateFixture()
    await owner.query('delete from app_private.auth_identities where profile_id=$1', [f.athleteId])
    await expect(privatePlan(f)).rejects.toThrow('expected_identity')
    const g = await privateFixture()
    g.expected.clientId = randomUUID()
    await expect(privatePlan(g)).rejects.toThrow('expected_identity')
  })
  it('identity rejection privately inspects exact invitations and scoped session metadata without selecting a same-name claimant', async () => {
    const f = await privateFixture(), current = randomUUID(), candidate = randomUUID(), unrelated = randomUUID()
    await owner.query('delete from app_private.auth_identities where profile_id=$1', [f.athleteId])
    await owner.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic current','client')", [current])
    await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [createHash('sha256').update(current).digest('hex'), current])
    await owner.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '1 day')", [createHash('sha256').update('synthetic session '+current).digest('hex'), current])
    await owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,' Synthetic   canonical '),($3,$2,'Different unrelated person')", [candidate, f.trainerId, unrelated])
    const invitation = async (card: string, trainer: string, claimant: string, age: string) => {
      await owner.query(`insert into public.client_invitations(client_id,created_by,target_role,code_hash,expires_at,claimed_by,claimed_at,created_at)
        values($1,$2,'client',$3,now()+interval '1 day',$4,now(),now()-$5::interval)`, [card, trainer, createHash('sha256').update(randomUUID()).digest('hex'), claimant, age])
    }
    await invitation(f.old, f.trainerId, f.athleteId, '30 days')
    await invitation(candidate, f.trainerId, current, '1 day')
    await invitation(candidate, f.other, current, '1 day')
    await invitation(unrelated, f.trainerId, current, '1 day')
    const failure = await privatePlan(f).then(() => { throw Error('identity must reject') }, (error: unknown) => error)
    expect(failure).toMatchObject({ message: 'client_restore_expected_identity', privateDiagnostic: { identityEvidence: {
      actorSelected: false, sameNameIsNotIdentityProof: true, importedCounts: { workouts: 21, exercises: 1, sets: 1 },
    } } })
    const evidence = (failure as { privateDiagnostic: { identityEvidence: { invitations: { client_id: string; exact_import_card: boolean }[]; profiles: { id: string; active_sessions: number }[] } } }).privateDiagnostic.identityEvidence
    expect(evidence.invitations).toHaveLength(2)
    expect(evidence.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ client_id: f.old, exact_import_card: true }),
      expect.objectContaining({ client_id: candidate, exact_import_card: false }),
    ]))
    expect(evidence.profiles.find(p => p.id === current)).toMatchObject({ active_sessions: 1 })
    expect(JSON.stringify(evidence)).not.toMatch(/token_sha256|provider_subject_sha256|code_hash|Synthetic|Private synthetic/)
    expect((await owner.query("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows).toEqual([{ n: 0 }])
  })
  it('feedback evidence stays private and can never produce an apply plan, even for linked identities or ambiguous messages', async () => {
    const f = await privateFixture(), message = 'Synthetic profile verification '+randomUUID()
    const evidence = { messageSha256: createHash('sha256').update(message).digest('hex'), since: new Date(Date.now()-60000).toISOString() }
    for (const [user, role] of [[f.athleteId, 'client'], [f.trainerId, 'trainer']]) {
      await owner.query(`insert into public.app_feedback(user_id,account_role,kind,message,screen_path,app_version,display_mode,user_agent)
        values($1,$2,'problem',$3,'/synthetic-private-screen','synthetic','browser','synthetic-private-agent')`, [user, role, message])
    }
    const failure = await privatePlan(f, evidence).then(() => { throw Error('evidence must never produce a plan') }, (error: unknown) => error)
    expect(failure).toMatchObject({ message: 'client_restore_identity_evidence_review_required', privateDiagnostic: { identityEvidence: { actorSelected: false } } })
    const found = (failure as { privateDiagnostic: { identityEvidence: { feedback: { user_id: string; account_role: string }[] } } }).privateDiagnostic.identityEvidence
    expect(found.feedback).toHaveLength(2)
    expect(found.feedback).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: f.athleteId, account_role: 'client' }), expect.objectContaining({ user_id: f.trainerId, account_role: 'trainer' })]))
    expect(JSON.stringify(found)).not.toMatch(/Synthetic|synthetic-private|token_sha256|provider_subject_sha256|messageSha256/)
    expect((await owner.query("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows).toEqual([{ n: 0 }])
  })
  it('read-only discovery sees the exact imported card after ownership changes without assuming or changing the current actor', async () => {
    const f = await privateFixture(), current = randomUUID()
    await owner.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic changed owner','client')", [current])
    await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [createHash('sha256').update(current).digest('hex'), current])
    await owner.query('update public.clients set auth_user_id=$2 where id=$1', [f.card, current])
    await expect(privatePlan(f)).rejects.toThrow('canonical')
    const evidence = { messageSha256: createHash('sha256').update(randomUUID()).digest('hex'), since: new Date(Date.now()-60000).toISOString() }
    const failure = await privatePlan(f, evidence).then(() => { throw Error('discovery must reject apply planning') }, (error: unknown) => error)
    expect(failure).toMatchObject({ message: 'client_restore_identity_evidence_review_required', privateDiagnostic: {
      state: { card: { id: f.card, auth_user_id: current } },
      identityEvidence: { feedback: [], actorSelected: false, importedCounts: { workouts: 21, exercises: 1, sets: 1 } },
    } })
    const evidenceProfiles = (failure as { privateDiagnostic: { identityEvidence: { profiles: { id: string; account_role: string; yandex_identities: number }[] } } }).privateDiagnostic.identityEvidence.profiles
    expect(evidenceProfiles.find(p => p.id === current)).toEqual(expect.objectContaining({ id: current, account_role: 'client', yandex_identities: 1 }))
    expect((await owner.query('select auth_user_id from public.clients where id=$1', [f.card])).rows).toEqual([{ auth_user_id: current }])
    expect((await owner.query("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows).toEqual([{ n: 0 }])
  })
  it('private history refuses another same-name live card linked to this trainer', async () => {
    const f = await privateFixture()
    await owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic canonical')", [randomUUID(), f.trainerId])
    await expect(privatePlan(f)).rejects.toThrow('other_canonical_candidate')
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]?.n).toBe(0)
  })
  it('private history rejects foreign/missing imported IDs and modified expected bindings', async () => {
    const f = await privateFixture()
    f.expected.workoutIds[0] = randomUUID()
    await expect(privatePlan(f)).rejects.toThrow('imported_history_changed')
    const g = await privateFixture(), p = await privatePlan(g)
    const changed = structuredClone(p)
    changed.expectedHistory = { ...g.expected, sets: 2 }
    await expect(apply(changed)).rejects.toThrow('expected_binding')
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [g.card])).rows[0]?.n).toBe(0)
  })
  it('private finance or prior planned-row changes invalidate the plan without writes', async () => {
    const f = await privateFixture(), p = await privatePlan(f)
    await owner.query("update public.trainer_finance_packages set title='Legitimate newer finance' where client_id=$1", [f.card])
    await expect(apply(p)).rejects.toThrow('state_changed')
    const g = await privateFixture(), q = await privatePlan(g)
    await owner.query("update public.workouts set notes='Legitimate newer plan' where client_id=$1 and status='planned'", [g.card])
    await expect(apply(q)).rejects.toThrow('state_changed')
    expect((await owner.query<{ n: number }>("select count(*)::int n from public.client_trainer_relationships where client_id=any($1::uuid[]) and status='active'", [[f.card, g.card]])).rows[0]?.n).toBe(0)
  })
  it('private verification rejects changed ownership or a lost imported set', async () => {
    const f = await privateFixture(), p = await privatePlan(f)
    await apply(p)
    await owner.query('delete from public.workout_sets where client_id=$1', [f.card])
    await expect(verify(p)).rejects.toThrow('trainer_imported_visibility')
    const g = await privateFixture(), q = await privatePlan(g)
    await apply(q)
    await owner.query('update public.clients set auth_user_id=null where id=$1', [g.card])
    await expect(verify(q)).rejects.toThrow('runtime_receipt')
  })

})
