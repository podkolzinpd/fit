import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readRestoreTarget, planClientRestore, applyClientRestore, verifyClientRestore, readConfirmedRestoreVisibility, readImportedAccessVisibility, verifyConfirmedCardMergeOwner, type ImportedAccessAuditTarget, type RestorePlan } from '../../../../scripts/cloudru-client-restore.mjs'

const source = process.env.TEST_DATABASE_URL
const database = `fit_client_restore_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`
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

  async function confirmedFixture() {
    const f = await privateFixture(), current = randomUUID(), currentCard = randomUUID(), invitationId = randomUUID()
    await owner.query('delete from app_private.auth_identities where profile_id=$1', [f.athleteId])
    await owner.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic current','client')", [current])
    await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [createHash('sha256').update(current).digest('hex'), current])
    await owner.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic current card')", [currentCard, f.trainerId])
    await owner.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)', [currentCard, f.trainerId])
    const code = randomUUID().toUpperCase()
    await owner.query(`insert into public.client_invitations(id,client_id,created_by,target_role,code_hash,expires_at)
      values($1,$2,$3,'client',$4,now()+interval '1 day')`, [invitationId, currentCard, f.trainerId, createHash('sha256').update(code).digest('hex')])
    const c = await runtime.connect()
    try {
      await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [current])
      expect((await c.query('select public.claim_client_invitation($1) id', [code])).rows).toEqual([{ id: currentCard }])
      await c.query('commit')
    } finally { c.release() }
    const claimed = (await owner.query<{ claimed_at: Date }>('select claimed_at from public.client_invitations where id=$1', [invitationId])).rows[0]!
    const clockAhead=claimed.claimed_at.getTime()-Date.now()
    if(clockAhead>0&&clockAhead<1000)await new Promise(resolve=>setTimeout(resolve,clockAhead+2))
    const proof = { invitationId, claimedAt: claimed.claimed_at.toISOString(), ownerConfirmedAt: new Date().toISOString() }
    return { ...f, current, currentCard, code, proof }
  }

  async function mergeFixture() {
    const f = await confirmedFixture()
    await owner.query(`insert into public.client_merge_operations(source_client_id,target_client_id,actor_id,status,completed_at)
      values($1,$2,$3,'completed',now())`, [f.old,f.card,f.athleteId])
    await owner.query("insert into public.trainer_finance_packages(trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,'Existing current balance',8,42000,current_date),($1,$3,'Archived balance stays',4,21000,current_date)", [f.trainerId,f.currentCard,f.old])
    return f
  }
  async function mergePlan(f: Awaited<ReturnType<typeof confirmedFixture>>) {
    const c=await owner.connect()
    try {return await planClientRestore(c,{trainerId:f.trainerId,athleteId:f.athleteId},f.expected,null,f.proof,null,'merge_confirmed_cards')}
    finally {c.release()}
  }
  async function verifyMergeOwner(p: RestorePlan) {
    const c=await owner.connect()
    try {return await verifyConfirmedCardMergeOwner(c,p)}finally {c.release()}
  }
  it('merges only proven card content into the current native card with conserved finance and both actual actors', async () => {
    const f=await mergeFixture(), p=await mergePlan(f)
    await expect(apply(p,false)).rejects.toThrow('backup_required')
    await expect(verify(p)).rejects.toThrow('merge_runtime_history')
    const connections=(await owner.query('select to_jsonb(r) row from public.client_trainer_relationships r where client_id=any($1::uuid[]) order by id',[[f.card,f.currentCard,f.old]])).rows
    expect(await apply(p)).toMatchObject({replayed:false,historyUnchanged:true})
    expect(await verifyMergeOwner(p)).toMatchObject({historyUnchanged:true})
    expect(await verify(p)).toMatchObject({bothCanReadImported:true,athleteCanReadTrainer:true})
    expect(await apply(p)).toMatchObject({replayed:true})
    expect((await owner.query('select to_jsonb(r) row from public.client_trainer_relationships r where client_id=any($1::uuid[]) order by id',[[f.card,f.currentCard,f.old]])).rows).toEqual(connections)
    expect((await owner.query('select id,auth_user_id,merged_into_client_id from public.clients where id=any($1::uuid[]) order by id',[[f.card,f.currentCard,f.old]])).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({id:f.currentCard,auth_user_id:f.current,merged_into_client_id:null}),
      expect.objectContaining({id:f.card,auth_user_id:f.athleteId,merged_into_client_id:f.currentCard}),
      expect.objectContaining({id:f.old,auth_user_id:null,merged_into_client_id:f.currentCard})]))
  })

  it('rejects changed finance, missing proof, stale plans and changed target state before any write', async () => {
    const f=await mergeFixture(), p=await mergePlan(f)
    const clock=vi.spyOn(Date,'now').mockReturnValue(Number(p.createdAt)+3600001)
    try {await expect(apply(p)).rejects.toThrow('merge_plan_expired')}finally {clock.mockRestore()}
    const changed=structuredClone(p);changed.targetId=randomUUID()
    await expect(apply(changed)).rejects.toThrow('merge_plan')
    await owner.query("update public.trainer_finance_packages set price_cents=price_cents+1 where client_id=$1",[f.currentCard])
    await expect(apply(p)).rejects.toThrow('merge_state_changed')
    expect((await owner.query('select merged_into_client_id from public.clients where id=$1',[f.card])).rows[0]).toEqual({merged_into_client_id:null})
    await owner.query('update public.client_invitations set claimed_by=null,claimed_at=null,revoked_at=now() where id=$1',[f.proof.invitationId])
    await expect(mergePlan(f)).rejects.toThrow('confirmed_invitation_binding')
  })
  it('keeps unknown profile-private data, messages, auth and existing connections unchanged', async () => {
    const f=await mergeFixture()
    await owner.query('create table public.synthetic_merge_private(id uuid primary key,owner_id uuid references public.profiles(id),body text not null)')
    try {
      await owner.query("insert into public.synthetic_merge_private values($1,$2,'Private old data'),($3,$4,'Private current data')",[randomUUID(),f.athleteId,randomUUID(),f.current])
      const before=(await owner.query('select * from public.synthetic_merge_private order by id')).rows
      const p=await mergePlan(f);await apply(p);await verifyMergeOwner(p);await verify(p)
      expect((await owner.query('select * from public.synthetic_merge_private order by id')).rows).toEqual(before)
      await owner.query("update public.synthetic_merge_private set body='Changed legitimate private data' where owner_id=$1",[f.current])
      await expect(verifyMergeOwner(p)).rejects.toThrow('merge_protected_state_changed')
    } finally {await owner.query('drop table public.synthetic_merge_private')}
  })
  it('rejects target history, ambiguous authorship, unsupported source data and foreign finance ownership', async () => {
    const f=await mergeFixture()
    await owner.query('update public.workouts set created_by=null where id=$1',[f.expected.workoutIds[0]])
    await expect(mergePlan(f)).rejects.toThrow('merge_history_conflict')
    const g=await mergeFixture()
    await owner.query('create table public.synthetic_merge_client(id uuid primary key,client_id uuid references public.clients(id),body text)')
    try {
      await owner.query("insert into public.synthetic_merge_client values($1,$2,'Preserve unsupported')",[randomUUID(),g.card])
      await expect(mergePlan(g)).rejects.toThrow('merge_unsupported_source_data')
    } finally {await owner.query('drop table public.synthetic_merge_client')}
    const h=await mergeFixture()
    await owner.query("insert into public.trainer_finance_packages(trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,'Foreign owner',3,21000,current_date)",[h.other,h.currentCard])
    await expect(mergePlan(h)).rejects.toThrow('merge_finance_owner')
    const k=await mergeFixture()
    await owner.query("insert into public.workouts(client_id,trainer_id,created_by,workout_date,status) values($1,$2,$2,current_date,'planned')",[k.currentCard,k.trainerId])
    await expect(mergePlan(k)).rejects.toThrow('merge_history_conflict')
  })
  it('rolls back the entire card/history/financial merge on a late error and verifies before replay', async () => {
    const f=await mergeFixture(),p=await mergePlan(f),c=await owner.connect()
    try {
      await expect(applyClientRestore({query:(sql:string,values?:unknown[])=>{
        if(sql.startsWith("update public.client_merge_operations set status='completed'"))return Promise.reject(Error('synthetic merge late failure'))
        return c.query(sql,values)
      }},p,{backupVerified:true})).rejects.toThrow('synthetic merge late failure')
    }finally{c.release()}
    expect((await owner.query('select merged_into_client_id from public.clients where id=$1',[f.card])).rows[0]).toEqual({merged_into_client_id:null})
    await apply(p);await verifyMergeOwner(p);await verify(p)
    await owner.query("update public.workouts set notes='Legitimate subsequent edit' where id=$1",[f.expected.workoutIds[0]])
    await expect(apply(p)).rejects.toThrow('merge_row_changed')
    await expect(verifyMergeOwner(p)).rejects.toThrow('merge_row_changed')
  })
  it('preserves native photos and quick-start receipts without altering workout facts', async () => {
    const f=await mergeFixture()
    const photo={path:f.card+'/'+'a'.repeat(64)+'.jpg',sha256:'a'.repeat(64),sizeBytes:512,version:4}
    await owner.query('update public.clients set profile_photo=$2::jsonb where id=$1',[f.card,JSON.stringify(photo)])
    const operation=randomUUID()
    await owner.query('insert into app_private.quick_start_operations(actor_id,operation_id,client_id,workout_id) values($1,$2,$3,$4)',[f.trainerId,operation,f.card,f.expected.workoutIds[0]])
    const p=await mergePlan(f);await apply(p);await verifyMergeOwner(p);await verify(p)
    expect((await owner.query<{profile_photo:unknown}>('select profile_photo from public.clients where id=$1',[f.currentCard])).rows[0]?.profile_photo).toEqual({...photo,version:1})
    expect((await owner.query('select client_id,workout_id from app_private.quick_start_operations where actor_id=$1 and operation_id=$2',[f.trainerId,operation])).rows[0]).toEqual({client_id:f.currentCard,workout_id:f.expected.workoutIds[0]})
    const g=await mergeFixture(),currentPhoto={...photo,path:g.currentCard+'/'+'b'.repeat(64)+'.jpg',sha256:'b'.repeat(64)}
    await owner.query('update public.clients set profile_photo=$2::jsonb where id=$1',[g.card,JSON.stringify(photo)])
    await owner.query('update public.clients set profile_photo=$2::jsonb where id=$1',[g.currentCard,JSON.stringify(currentPhoto)])
    const q=await mergePlan(g);await apply(q);await verifyMergeOwner(q)
    expect((await owner.query<{profile_photo:unknown}>('select profile_photo from public.clients where id=$1',[g.currentCard])).rows[0]?.profile_photo).toEqual(currentPhoto)
  })

  it('conserves charged sessions and payments across the existing financial owner/workout namespace split', async () => {
    const f=await mergeFixture()
    const pkg=(await owner.query<{id:string}>('select id from public.trainer_finance_packages where client_id=$1',[f.card])).rows[0]!.id
    await owner.query("insert into public.trainer_finance_payments(package_id,trainer_id,client_id,amount_cents,received_on,comment) values($1,$2,$3,23000,current_date,'Keep payment and owner')",[pkg,f.trainerId,f.card])
    await owner.query("insert into public.trainer_finance_sessions(package_id,workout_id,trainer_id,client_id,disposition,source,comment) values($1,$2,$3,$4,'charged','manual','Keep charged allocation')",[pkg,f.expected.workoutIds[0],f.trainerId,f.card])
    const rows=(await owner.query('select id,package_id,workout_id,trainer_id,disposition,source,comment from public.trainer_finance_sessions where client_id=$1 order by id',[f.card])).rows
    const p=await mergePlan(f);await apply(p);await verifyMergeOwner(p);await verify(p)
    expect((await owner.query('select id,package_id,workout_id,trainer_id,disposition,source,comment from public.trainer_finance_sessions where client_id=$1 order by id',[f.currentCard])).rows).toEqual(rows)
    expect((await owner.query<{amount:string}>('select amount_cents::text amount from public.trainer_finance_payments where client_id=$1',[f.currentCard])).rows).toEqual([{amount:'23000'}])
  })
  it('independently resolves an unknown COMMIT outcome instead of applying the merge twice', async () => {
    const f=await mergeFixture(),p=await mergePlan(f),c=await owner.connect()
    try {
      await expect(applyClientRestore({query:async(sql:string,values?:unknown[])=>{
        const result=await c.query(sql,values)
        if(sql==='commit')throw Error('synthetic transport lost after COMMIT')
        return result
      }},p,{backupVerified:true})).rejects.toThrow('synthetic transport lost after COMMIT')
    }finally{c.release()}
    await verifyMergeOwner(p);expect(await verify(p)).toMatchObject({bothCanReadImported:true})
    expect((await owner.query<{n:number}>('select count(*)::int n from public.client_merge_operations where id=$1',[p.mergeId])).rows[0]?.n).toBe(1)
  })

  async function confirmedDiagnosis(f: Awaited<ReturnType<typeof confirmedFixture>>, proof = f.proof) {
    const c = await owner.connect()
    try {
      return await planClientRestore(c, { trainerId: f.trainerId, athleteId: f.athleteId }, f.expected, null, proof)
        .then(() => { throw Error('two-card evidence must not produce an apply plan') }, (error: unknown) => error) as {
          message: string; privateDiagnostic: { confirmedCardEvidence: {
            cards: { id: string; auth_user_id: string }[]
            periods: { client_id: string; trainer_id: string; status: string }[]
            cardData: { table: string; rows: { client_id: string; count: number }[] }[]
          } }
        }
    } finally { c.release() }
  }

  it('reproduces a real accepted invitation on a different card: coach is visible there, imported history is not', async () => {
    const f = await confirmedFixture(), e = await confirmedDiagnosis(f)
    expect(e.message).toBe('client_restore_confirmed_cards_review_required')
    expect(e.privateDiagnostic).toMatchObject({ confirmedCardEvidence: { currentId: f.current, writePlanReady: false,
      importedCounts: { workouts: 21, exercises: 1, sets: 1 } } })
    expect(e.privateDiagnostic.confirmedCardEvidence.cards).toContainEqual(expect.objectContaining({ id: f.card, auth_user_id: f.athleteId }))
    expect(e.privateDiagnostic.confirmedCardEvidence.cards).toContainEqual(expect.objectContaining({ id: f.currentCard, auth_user_id: f.current }))
    const c = await runtime.connect()
    try {
      const view = await readConfirmedRestoreVisibility(c, e.privateDiagnostic)
      expect(view).toMatchObject({ athlete: { ownCards: [{ id: f.currentCard }], trainers: [{ client_id: f.currentCard, trainer_id: f.trainerId }], importedCounts: { workouts: 0, exercises: 0, sets: 0 } } })
    } finally { c.release() }
    expect(JSON.stringify(e.privateDiagnostic)).not.toMatch(/Synthetic|token_sha256|provider_subject_sha256|code_hash/)
    await expect(apply(e.privateDiagnostic as unknown as RestorePlan)).rejects.toThrow('client_restore_plan')
  })

  it('inventories old private ownership references before choosing a two-card recovery', async () => {
    const f = await confirmedFixture()
    await owner.query('create table public.synthetic_recovery_private_notes(id uuid primary key, owner_id uuid references public.profiles(id), body text not null)')
    try {
      await owner.query("insert into public.synthetic_recovery_private_notes values($1,$2,'Private synthetic content never leaves PostgreSQL')", [randomUUID(), f.athleteId])
      await owner.query(`insert into app_private.new_client_invitation_operations(actor_id,operation_id,full_name,client_id,invitation_id,invitation_code,invitation_token,expires_at)
        values($1,$2,'Synthetic private name',$3,$4,$5,'synthetic-private-invitation-token',now()+interval '1 day')`, [f.trainerId, randomUUID(), f.currentCard, f.proof.invitationId, f.code])
      const e = await confirmedDiagnosis(f)
      expect(e.message).toBe('client_restore_confirmed_cards_review_required')
      expect(e.privateDiagnostic).toMatchObject({ confirmedCardEvidence: { profileReferences: expect.any(Array) as unknown } })
      const refs = (e.privateDiagnostic as unknown as { confirmedCardEvidence: { profileReferences: { table: string; privateOwner: boolean; legacy: number }[] } }).confirmedCardEvidence.profileReferences
      expect(refs.find(r => r.table === 'synthetic_recovery_private_notes')).toMatchObject({ privateOwner: true, legacy: 1 })
      expect(e.privateDiagnostic).toMatchObject({ confirmedCardEvidence: { invitationOperations: [{ actor_id: f.trainerId, client_id: f.currentCard, invitation_id: f.proof.invitationId }] } })
      expect(JSON.stringify(e.privateDiagnostic)).not.toContain('Private synthetic content')
      expect(JSON.stringify(e.privateDiagnostic)).not.toMatch(/Synthetic private name|synthetic-private-invitation-token|invitation_token|invitation_code/)
      await expect(apply(e.privateDiagnostic as unknown as RestorePlan)).rejects.toThrow('client_restore_plan')
    } finally { await owner.query('drop table public.synthetic_recovery_private_notes') }
  })

  it('records both cards finance/history and distinguishes a real unlink from a broken normal trainer read', async () => {
    const f = await confirmedFixture()
    await owner.query("insert into public.trainer_finance_packages(trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,'Current private finance',5,10000,current_date)", [f.trainerId, f.currentCard])
    const c = await runtime.connect()
    try {
      await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [f.current])
      await c.query('select public.remove_client_trainer($1,$2)', [f.currentCard, f.trainerId])
      await c.query('commit')
      const e = await confirmedDiagnosis(f)
      expect(e.privateDiagnostic.confirmedCardEvidence.periods).toContainEqual(expect.objectContaining({ client_id: f.currentCard, trainer_id: f.trainerId, status: 'disconnected' }))
      const finance = e.privateDiagnostic.confirmedCardEvidence.cardData.find(t => t.table === 'trainer_finance_packages')
      expect(finance?.rows).toContainEqual(expect.objectContaining({ client_id: f.currentCard, count: 1 }))
      expect(finance?.rows).toContainEqual(expect.objectContaining({ client_id: f.card, count: 1 }))
      expect(await readConfirmedRestoreVisibility(c, e.privateDiagnostic)).toMatchObject({ athlete: { ownCards: [{ id: f.currentCard }], trainers: [], importedCounts: { workouts: 0, exercises: 0, sets: 0 } } })
      await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [f.current])
      await expect(c.query('select public.claim_client_invitation($1)', [f.code])).rejects.toThrow('invitation_connection_ended')
      await c.query('rollback')
    } finally { c.release() }
  })

  it('rejects stale or foreign invitation bindings and changed imported history without creating repair state', async () => {
    const f = await confirmedFixture()
    expect((await confirmedDiagnosis(f, { ...f.proof, invitationId: randomUUID() })).message).toBe('client_restore_confirmed_invitation_binding')
    expect((await confirmedDiagnosis(f, { ...f.proof, claimedAt: new Date(Date.parse(f.proof.claimedAt)-1000).toISOString() })).message).toBe('client_restore_confirmed_invitation_binding')
    await owner.query('update public.client_invitations set created_by=$2 where id=$1', [f.proof.invitationId, f.other])
    expect((await confirmedDiagnosis(f)).message).toBe('client_restore_confirmed_invitation_binding')
    const g = await confirmedFixture()
    await owner.query('delete from public.workout_sets where client_id=$1', [g.card])
    expect((await confirmedDiagnosis(g)).message).toBe('client_restore_imported_history_changed')
  })

  it('audits all seventeen original destinations without treating a legacy owner read as a current native login', async () => {
    const f = await confirmedFixture()
    const scope: ImportedAccessAuditTarget[] = [{ code: 'F01', profileId: f.athleteId, journalKind: 'athlete', expectedHistory: f.expected }]
    for (let i = 2; i <= 17; i++) {
      const profileId = i === 17 ? f.trainerId : randomUUID(), card = randomUUID()
      if (i !== 17) {
        await owner.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic audit athlete','client')", [profileId])
        if (i === 2) await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')", [createHash('sha256').update(profileId).digest('hex'), profileId])
      }
      const partition = i === 5 ? f.trainerId : profileId
      await owner.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$3,$4)", [card, partition, i === 5 ? null : profileId, `Synthetic roster ${i}`])
      if (i !== 17) {
        await owner.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2) on conflict do nothing', [card, f.trainerId])
        if (i !== 5) await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [card, i === 3 ? f.other : f.trainerId, profileId])
      }
      const workout = (await owner.query<{ id: string }>(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,completed_at)
        values($1,$2,$3,current_date,'done',now()) returning id`, [card, partition, f.trainerId])).rows[0]!.id
      const exercise = (await owner.query<{ id: string }>(`insert into public.workout_exercises(workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
        values($1,$2,$3,0,'system','fixture:roster','Synthetic audit exercise','back','strength') returning id`, [workout, partition, card])).rows[0]!.id
      await owner.query('insert into public.workout_sets(workout_exercise_id,trainer_id,client_id,position) values($1,$2,$3,0)', [exercise, partition, card])
      scope.push({ code: `F${String(i).padStart(2, '0')}`, profileId: i === 5 ? null : profileId, journalKind: i === 17 ? 'trainer_self' : 'athlete', expectedHistory: { clientId: card, workoutIds: [workout], workouts: 1, exercises: 1, sets: 1 } })
    }
    const c = await owner.connect()
    let failure: { message: string; privateDiagnostic: { importedAccessAudit: { code: string; nativeOwnerPresent: boolean; importedHistoryMatches: boolean; actorSelected: boolean; writePlanReady: boolean;
      workoutDetails?: {id:string;reason:string;status?:string;updated_by?:string}[];
      identityTrace?: {actorSelected:boolean;absentSessionIsNotProofOfNoPriorLogin:boolean;pilotSessions:{retained:number;active:number};appSessions:{retained:number;active:number};rollout:{target_backend:string;access_mode:string}}
    }[] } }
    try {
      failure = await planClientRestore(c, { trainerId: f.trainerId, athleteId: f.athleteId }, f.expected, null, f.proof, scope)
        .then(() => { throw Error('audit must not produce an apply plan') }, (error: unknown) => error) as typeof failure
    } finally { c.release() }
    expect(failure.message).toBe('client_restore_imported_access_audit_complete')
    expect(failure.privateDiagnostic.importedAccessAudit).toHaveLength(17)
    expect(failure.privateDiagnostic.importedAccessAudit.every(v => v.importedHistoryMatches && !v.actorSelected && !v.writePlanReady)).toBe(true)
    expect(failure.privateDiagnostic.importedAccessAudit.find(v => v.code === 'F02')?.nativeOwnerPresent).toBe(true)
    expect(failure.privateDiagnostic.importedAccessAudit.find(v => v.code === 'F04')?.nativeOwnerPresent).toBe(false)
    const api = await runtime.connect()
    try {
      const view = await readImportedAccessVisibility(api, failure.privateDiagnostic)
      expect(view).toHaveLength(17)
      expect(view.find(v => v.code === 'F03')).toMatchObject({ actors: { trainer: { allImportedReadable: false } } })
      expect(view.find(v => v.code === 'F04')).toMatchObject({ actors: { trainer: { allImportedReadable: true }, recordedOwner: { allImportedReadable: true } }, recordedOwnerIsNotIndependentlyConfirmedCurrentLogin: true })
      expect(view.find(v => v.code === 'F17')).toMatchObject({ trainerOwnJournal: true, recordedOwnerHasNativeIdentity: true })
      expect(view.find(v => v.code === 'F05')).toMatchObject({ cardUnclaimed: true, currentAccountRelevant: false, recordedOwnerIsNotIndependentlyConfirmedCurrentLogin: false, actors: { trainer: { allImportedReadable: true }, recordedOwner: { missing: true } } })
    } finally { api.release() }
    expect(JSON.stringify(failure.privateDiagnostic)).not.toMatch(/Synthetic|token_sha256|provider_subject_sha256|code_hash/)
    await expect(apply(failure.privateDiagnostic as unknown as RestorePlan)).rejects.toThrow('client_restore_plan')
    const missing = structuredClone(scope)
    missing[5]!.expectedHistory.clientId = randomUUID()
    const reader = await owner.connect()
    try {
      failure = await planClientRestore(reader, { trainerId: f.trainerId, athleteId: f.athleteId }, f.expected, null, null, missing)
        .then(() => { throw Error('incomplete audit must not produce a plan') }, (error: unknown) => error) as typeof failure
    } finally { reader.release() }
    expect(failure.message).toBe('client_restore_imported_access_audit_complete')
    expect(failure.privateDiagnostic.importedAccessAudit).toHaveLength(17)
    expect(failure.privateDiagnostic.importedAccessAudit.find(v => v.code === 'F06')).toMatchObject({ issue: 'missing_card', importedHistoryMatches: false, actorSelected: false, writePlanReady: false })
    expect(failure.privateDiagnostic.importedAccessAudit.filter(v => v.code !== 'F06').every(v => v.importedHistoryMatches)).toBe(true)
    const verifier = await runtime.connect()
    try {
      expect((await readImportedAccessVisibility(verifier, failure.privateDiagnostic)).find(v => v.code === 'F06'))
        .toMatchObject({ issue: 'missing_card', resolved: false, writePlanReady: false })
    } finally { verifier.release() }
    // Reconcile a hidden imported result separately from a visible changed status.
    const hidden=scope[4]!,changed=scope[5]!,legacy=scope[3]!
    await owner.query('update public.workouts set deleted_at=now(),updated_by=$2,version=version+1 where id=$1',[hidden.expectedHistory.workoutIds[0],f.trainerId])
    await owner.query("update public.workouts set status='cancelled',completed_at=null,updated_by=$2,version=version+1 where id=$1",[changed.expectedHistory.workoutIds[0],f.trainerId])
    const pilotHash=createHash('sha256').update('private synthetic retained pilot '+randomUUID()).digest('hex')
    await owner.query("insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled) values($1,'yandex','read_only',true)",[legacy.profileId])
    await owner.query("insert into app_private.yandex_pilot_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '30 minutes')",[pilotHash,legacy.profileId])
    const detailReader=await owner.connect()
    try {
      failure=await planClientRestore(detailReader,{trainerId:f.trainerId,athleteId:f.athleteId},f.expected,null,null,scope,null,['F05','F04'])
        .then(()=>{throw Error('cause audit cannot produce a write plan')},(error:unknown)=>error) as typeof failure
    }finally{detailReader.release()}
    expect(failure.message).toBe('client_restore_imported_access_audit_complete')
    expect(failure.privateDiagnostic.importedAccessAudit.find(v=>v.code===hidden.code)?.workoutDetails)
      .toEqual([expect.objectContaining({id:hidden.expectedHistory.workoutIds[0],reason:'soft_deleted',status:'done',updated_by:f.trainerId})])
    expect(failure.privateDiagnostic.importedAccessAudit.find(v=>v.code===legacy.code)?.identityTrace).toMatchObject({
      actorSelected:false,absentSessionIsNotProofOfNoPriorLogin:true,appSessions:{retained:0,active:0},
      pilotSessions:{retained:1,active:1},rollout:{target_backend:'yandex',access_mode:'read_only'}})
    expect(JSON.stringify(failure.privateDiagnostic)).not.toContain(pilotHash)
    expect(JSON.stringify(failure.privateDiagnostic)).not.toMatch(/Synthetic|token_sha256|provider_subject_sha256|code_hash/)
    const detailRuntime=await runtime.connect()
    try {
      const view=await readImportedAccessVisibility(detailRuntime,failure.privateDiagnostic)
      expect(view.find(v=>v.code===hidden.code)).toMatchObject({actors:{trainer:{readableImportedIds:[],allImportedReadable:false}}})
    }finally{detailRuntime.release()}
    await expect(apply(failure.privateDiagnostic as unknown as RestorePlan)).rejects.toThrow('client_restore_plan')
    const statusReader=await owner.connect()
    try {
      failure=await planClientRestore(statusReader,{trainerId:f.trainerId,athleteId:f.athleteId},f.expected,null,null,scope,null,['F06'])
        .then(()=>{throw Error('status audit cannot produce a write plan')},(error:unknown)=>error) as typeof failure
    }finally{statusReader.release()}
    expect(failure.privateDiagnostic.importedAccessAudit.find(v=>v.code===changed.code)?.workoutDetails)
      .toEqual([expect.objectContaining({id:changed.expectedHistory.workoutIds[0],reason:'status_changed',status:'cancelled',updated_by:f.trainerId})])
    expect(failure.privateDiagnostic.importedAccessAudit.filter(v=>v.code!==changed.code).every(v=>v.workoutDetails===undefined&&v.identityTrace===undefined)).toBe(true)
    const statusRuntime=await runtime.connect()
    try {
      const view=await readImportedAccessVisibility(statusRuntime,failure.privateDiagnostic)
      expect(view.find(v=>v.code===changed.code)).toMatchObject({actors:{trainer:{readableImportedIds:changed.expectedHistory.workoutIds,allImportedReadable:false}}})
    }finally{statusRuntime.release()}
  }, 30000)

})
