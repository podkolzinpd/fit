import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

interface TestResult { incoming: boolean; id: string; code: string; status: string; expectedRelationshipId: string | null; expectedRevision: string | null }
const source = process.env.TEST_DATABASE_URL
describe.skipIf(!source)('connection directory with real PostgreSQL and runtime role', () => {
  let admin: Pool, pool: Pool
  const database = `fit_directory_${process.pid}`
  beforeAll(async () => {
    const url = new URL(source!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_test_database_required')
    admin = new Pool({ connectionString: url.href })
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$;`)
    await admin.query(`create database ${database}`)
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)), direction: 'up',
      migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href })
  }, 60000)
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`drop database if exists ${database}`); await admin.end() } })
  const hash = (s: string) => createHash('sha256').update(s).digest('hex')
  async function actor(id: string, action: string, data = {}) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
      await db.query('set local role fit_api')
      const result = (await db.query<{ result: TestResult }>('select app_private.connection_directory($1,$2::jsonb) result', [action, JSON.stringify(data)])).rows[0]!.result
      await db.query('commit'); return result
    } catch (e) { await db.query('rollback'); throw e } finally { db.release() }
  }
  async function legacyActor(id: string, sql: string, params: unknown[] = []) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
      await db.query('set local role fit_api')
      const result = await db.query<{ invitation_token: string }>(sql, params)
      await db.query('commit')
      return result.rows
    } catch (error) { await db.query('rollback'); throw error } finally { db.release() }
  }
  async function fixture(withCard = true) {
    const athlete = randomUUID(), trainer = randomUUID(), outsider = randomUUID(), card = randomUUID()
    await pool.query("insert into public.profiles(id,account_role,first_name) values($1,'client','Synthetic Athlete'),($2,'trainer','Synthetic Trainer'),($3,'trainer','Synthetic Other')", [athlete, trainer, outsider])
    await pool.query('insert into public.trainers(profile_id) values($1),($2)', [trainer, outsider])
    if (withCard) await pool.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic Athlete')", [card, athlete])
    return { athlete, trainer, outsider, card }
  }
  it('finds only provider-observed email, excludes ambiguity, and rotates locators without creating cards', async () => {
    const f = await fixture(), subject = hash(randomUUID()), email = hash('athlete@example.test')
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)", [subject, f.athlete])
    await expect(actor(f.trainer, 'resolve', { kind: 'email', value: email })).resolves.toBeNull()
    await pool.query('select app_private.observe_connection_emails($1,$2)', [subject, [email]])
    expect((await actor(f.trainer, 'resolve', { kind: 'email', value: email })).id).toBe(f.athlete)
    const initial = await actor(f.athlete, 'self'), next = await actor(f.athlete, 'rotate')
    expect(initial.code).not.toBe(next.code)
    await expect(actor(f.trainer, 'resolve', { kind: 'code', value: initial.code })).resolves.toBeNull()
    expect((await pool.query<{n:number}>('select count(*)::int n from public.clients where auth_user_id=$1', [f.athlete])).rows[0]!.n).toBe(1)
    const other = await fixture(), otherSubject = hash(randomUUID())
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)", [otherSubject, other.athlete])
    await pool.query('select app_private.observe_connection_emails($1,$2)', [otherSubject, [email]])
    await expect(actor(f.trainer, 'resolve', { kind: 'email', value: email })).resolves.toBeNull()
  })
  it.each(['athlete', 'trainer'] as const)('requires the other party to accept: initiated by %s', async initiator => {
    const f = await fixture(), sender = f[initiator], recipient = initiator === 'athlete' ? f.trainer : f.athlete
    const peer = await actor(sender, 'preview', { peerId: recipient })
    const request = await actor(sender, 'send', { peerId: recipient, expectedRelationshipId: peer.expectedRelationshipId, expectedRevision: peer.expectedRevision })
    expect((await pool.query<{n:number}>('select count(*)::int n from public.client_trainer_relationships where client_id=$1', [f.card])).rows[0]!.n).toBe(0)
    await expect(actor(sender, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_forbidden' })
    await expect(actor(f.outsider, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_forbidden' })
    const consent = await actor(recipient, 'preview', { peerId: sender })
    expect((await actor(recipient, 'accept', { requestId: request.id, expectedRelationshipId: consent.expectedRelationshipId, expectedRevision: consent.expectedRevision })).status).toBe('accepted')
    expect((await actor(recipient, 'accept', { requestId: request.id, expectedRelationshipId: consent.expectedRelationshipId, expectedRevision: consent.expectedRevision })).status).toBe('accepted')
    expect((await pool.query<{n:number}>("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]!.n).toBe(1)
  })
  it('keeps first-login QR lookup free of cards and creates a self-owned card only on athlete consent', async () => {
    const f = await fixture(false)
    const code = (await actor(f.athlete, 'self')).code
    const preview = await actor(f.trainer, 'resolve', { kind: 'code', value: code })
    expect(preview.id).toBe(f.athlete)
    expect((await pool.query<{n:number}>('select count(*)::int n from public.clients where auth_user_id=$1', [f.athlete])).rows[0]!.n).toBe(0)
    const request = await actor(f.trainer, 'send', { peerId: f.athlete, expectedRelationshipId: null, expectedRevision: null })
    expect((await pool.query<{n:number}>('select count(*)::int n from public.clients where auth_user_id=$1', [f.athlete])).rows[0]!.n).toBe(0)
    await actor(f.athlete, 'accept', { requestId: request.id, expectedRelationshipId: null, expectedRevision: null })
    expect((await pool.query<{n:number}>('select count(*)::int n from public.clients where auth_user_id=$1', [f.athlete])).rows[0]!.n).toBe(1)
  })
  it('invalidates athlete consent after an intervening connect/disconnect, even with no current coach', async () => {
    const f = await fixture()
    const request = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    await pool.query("insert into public.client_trainer_relationships(client_id,trainer_id,connected_by,status,disconnected_at,disconnected_by) values($1,$2,$3,'disconnected',now(),$3)", [f.card, f.outsider, f.athlete])
    await expect(actor(f.trainer, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_changed' })
    expect((await pool.query<{n:number}>("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]!.n).toBe(0)
  })
  it('lets only the athlete explicitly refresh stale consent and keeps both sides informed', async () => {
    const f = await fixture()
    const request = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    await pool.query("insert into public.client_trainer_relationships(client_id,trainer_id,connected_by,status,disconnected_at,disconnected_by) values($1,$2,$3,'disconnected',now(),$3)", [f.card, f.outsider, f.athlete])
    expect((await actor(f.athlete, 'status', { requestId: request.id })).status).toBe('needs_confirmation')
    expect((await actor(f.trainer, 'send', { peerId: f.athlete })).status).toBe('needs_confirmation')
    await expect(actor(f.trainer, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_changed' })
    const preview = await actor(f.athlete, 'preview', { peerId: f.trainer })
    const renewed = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: preview.expectedRelationshipId, expectedRevision: preview.expectedRevision })
    expect(renewed).toMatchObject({ id: request.id, status: 'pending', incoming: false })
    expect((await actor(f.trainer, 'status', { requestId: request.id })).status).toBe('pending')
    await actor(f.trainer, 'accept', { requestId: request.id })
    expect((await pool.query("select event from app_private.connection_audit where request_id=$1 and event='consent_renewed'", [request.id])).rowCount).toBe(1)
    expect((await actor(f.athlete, 'list') as unknown as TestResult[]).find(r => r.id === request.id)?.status).toBe('accepted')
  })
  it('returns an incoming request on an opposite-direction send without silently accepting', async () => {
    const f = await fixture()
    const sent = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    const opposite = await actor(f.trainer, 'send', { peerId: f.athlete })
    expect(opposite).toMatchObject({ id: sent.id, status: 'pending', incoming: true })
    expect((await pool.query("select id from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rowCount).toBe(0)
  })
  it('retains outcomes across reload and reports disconnection instead of a stale success', async () => {
    const f = await fixture()
    const body = { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null }
    const declined = await actor(f.athlete, 'send', body)
    await actor(f.trainer, 'decline', { requestId: declined.id })
    const cancelled = await actor(f.athlete, 'send', body)
    await actor(f.athlete, 'cancel', { requestId: cancelled.id })
    const expired = await actor(f.athlete, 'send', body)
    await pool.query("update app_private.connection_requests set expires_at=now()-interval '1 second' where id=$1", [expired.id])
    const accepted = await actor(f.athlete, 'send', body)
    await actor(f.trainer, 'accept', { requestId: accepted.id })
    for (const participant of [f.athlete, f.trainer]) {
      const rows = await actor(participant, 'list') as unknown as TestResult[]
      expect(rows.find(r => r.id === declined.id)?.status).toBe('declined')
      expect(rows.find(r => r.id === cancelled.id)?.status).toBe('cancelled')
      expect(rows.find(r => r.id === expired.id)?.status).toBe('expired')
      expect(rows.find(r => r.id === accepted.id)?.status).toBe('accepted')
    }
    expect(await actor(f.outsider, 'list')).toEqual([])
    await pool.query("update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2 where client_id=$1 and status='active'", [f.card, f.athlete])
    expect((await actor(f.trainer, 'status', { requestId: accepted.id })).status).toBe('disconnected')
    expect((await actor(f.athlete, 'list') as unknown as TestResult[]).find(r => r.id === accepted.id)?.status).toBe('disconnected')
    await expect(actor(f.trainer, 'accept', { requestId: accepted.id })).rejects.toMatchObject({ message: 'connection_changed' })
    await pool.query("update app_private.connection_requests set decided_at=now()-interval '31 days',expires_at=now()-interval '32 days' where id=$1", [declined.id])
    expect((await actor(f.athlete, 'list') as unknown as TestResult[]).find(r => r.id === declined.id)).toBeUndefined()
  })
  it('never hides pending requests behind the terminal history limit', async () => {
    const f = await fixture()
    const athletes = Array.from({ length: 52 }, () => randomUUID())
    await pool.query("insert into public.profiles(id,account_role,first_name) select id,'client','Synthetic Applicant' from unnest($1::uuid[]) id", [athletes])
    await pool.query("insert into app_private.connection_requests(trainer_id,athlete_id,initiated_by) select $1,id,id from unnest($2::uuid[]) id", [f.trainer, athletes])
    await pool.query("insert into app_private.connection_requests(trainer_id,athlete_id,initiated_by,status,decided_at) select $1,$2,$2,'declined',now() from generate_series(1,60)", [f.trainer, f.athlete])
    const requests = await actor(f.trainer, 'list') as unknown as TestResult[]
    expect(requests.filter(r => r.status === 'pending')).toHaveLength(52)
    expect(requests.filter(r => r.status === 'declined')).toHaveLength(50)
    expect(requests.slice(0, 52).every(r => r.status === 'pending')).toBe(true)
  })
  it('completes the same pending request through a legacy invitation and never revives its old period', async () => {
    const f = await fixture()
    const request = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    const [share] = await legacyActor(f.athlete, "select * from public.create_client_invitation_share($1,'trainer')", [f.card])
    await legacyActor(f.trainer, 'select public.claim_client_invitation_link($1)', [share!.invitation_token])
    expect((await actor(f.trainer, 'status', { requestId: request.id })).status).toBe('accepted')
    expect((await actor(f.athlete, 'list') as unknown as TestResult[]).find(r => r.id === request.id)?.status).toBe('accepted')
    expect((await pool.query("select event from app_private.connection_audit where request_id=$1 and event='accepted'", [request.id])).rowCount).toBe(1)
    await pool.query("update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2 where client_id=$1 and status='active'", [f.card, f.athlete])
    expect((await actor(f.athlete, 'status', { requestId: request.id })).status).toBe('disconnected')
    await expect(actor(f.trainer, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_changed' })
    const preview = await actor(f.athlete, 'preview', { peerId: f.trainer })
    const next = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: preview.expectedRelationshipId, expectedRevision: preview.expectedRevision })
    expect(next.id).not.toBe(request.id)
    await actor(f.trainer, 'accept', { requestId: next.id })
    expect((await actor(f.athlete, 'status', { requestId: next.id })).status).toBe('accepted')
    expect((await actor(f.athlete, 'status', { requestId: request.id })).status).toBe('disconnected')
    await expect(actor(f.trainer, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_changed' })
    expect((await pool.query("select event from app_private.connection_audit where request_id=$1 and event='accepted'", [next.id])).rowCount).toBe(1)
  })
  it('switches atomically with athlete consent and preserves existing workout facts', async () => {
    const f = await fixture(), workout = randomUUID()
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)', [f.card, f.outsider, f.athlete])
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date) values($1,$2,$3,$2,current_date)", [workout, f.athlete, f.card])
    const preview = await actor(f.athlete, 'preview', { peerId: f.trainer })
    const request = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: preview.expectedRelationshipId, expectedRevision: preview.expectedRevision })
    await actor(f.trainer, 'accept', { requestId: request.id })
    expect((await pool.query("select trainer_id from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows).toEqual([{ trainer_id: f.trainer }])
    expect((await pool.query('select trainer_id,deleted_at from public.workouts where id=$1', [workout])).rows).toEqual([{ trainer_id: f.athlete, deleted_at: null }])
  })
  it('expires requests, authorizes cancellation, and refuses revoked consent', async () => {
    const f = await fixture()
    const request = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    await expect(actor(f.trainer, 'cancel', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_forbidden' })
    await actor(f.athlete, 'cancel', { requestId: request.id })
    expect((await actor(f.trainer, 'status', { requestId: request.id })).status).toBe('cancelled')
    await expect(actor(f.outsider, 'status', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_forbidden' })
    await expect(actor(f.trainer, 'accept', { requestId: request.id })).rejects.toMatchObject({ message: 'connection_offer_unavailable' })
    const next = await actor(f.athlete, 'send', { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null })
    await pool.query("update app_private.connection_requests set expires_at=now()-interval '1 second' where id=$1", [next.id])
    expect((await actor(f.athlete, 'status', { requestId: next.id })).status).toBe('expired')
    await expect(actor(f.trainer, 'accept', { requestId: next.id })).rejects.toMatchObject({ message: 'connection_offer_unavailable' })
    expect((await pool.query<{n:number}>("select count(*)::int n from public.client_trainer_relationships where client_id=$1 and status='active'", [f.card])).rows[0]!.n).toBe(0)
  })
  it('coalesces concurrent sends and denies direct runtime reads of email bindings', async () => {
    const f = await fixture()
    const body = { peerId: f.trainer, expectedRelationshipId: null, expectedRevision: null }
    const [a,b] = await Promise.all([actor(f.athlete, 'send', body), actor(f.athlete, 'send', body)])
    expect(a.id).toBe(b.id)
    const db = await pool.connect()
    try {
      await db.query('begin'); await db.query('set local role fit_api')
      await expect(db.query('select * from app_private.connection_email_bindings')).rejects.toMatchObject({ code: '42501' })
    } finally { await db.query('rollback'); db.release() }
  })
  it('limits mailbox enumeration and removes discovery data when the identity is unlinked', async () => {
    const f = await fixture(), subject = hash(randomUUID()), email = hash('unlink@example.test')
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)", [subject,f.athlete])
    await pool.query('select app_private.observe_connection_emails($1,$2)', [subject,[email]])
    await pool.query("delete from app_private.auth_identities where provider='yandex' and provider_subject_sha256=$1", [subject])
    expect((await pool.query<{n:number}>('select count(*)::int n from app_private.connection_email_bindings where subject_sha256=$1', [subject])).rows[0]!.n).toBe(0)
    for (let i=0;i<30;i++) await actor(f.trainer, 'resolve', { kind: 'email', value: email })
    await expect(actor(f.trainer, 'resolve', { kind: 'email', value: email })).rejects.toMatchObject({ message: 'connection_rate_limited' })
  })
})
