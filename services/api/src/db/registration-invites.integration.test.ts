import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

interface TestResult { invitationCode: string; incoming: boolean; id: string; code: string; status: string; expectedRelationshipId: string | null; expectedRevision: string | null }
const source = process.env.TEST_DATABASE_URL
describe.skipIf(!source)('registration-first invitations', () => {
  let admin: Pool, pool: Pool
  const database = `fit_registration_invites_${process.pid}`
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
  async function fixture(withCard = true) {
    const athlete = randomUUID(), trainer = randomUUID(), outsider = randomUUID(), card = randomUUID()
    await pool.query("insert into public.profiles(id,account_role,first_name) values($1,'client','Synthetic Athlete'),($2,'trainer','Synthetic Trainer'),($3,'trainer','Synthetic Other')", [athlete, trainer, outsider])
    await pool.query('insert into public.trainers(profile_id) values($1),($2)', [trainer, outsider])
    if (withCard) await pool.query("insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic Athlete')", [card, athlete])
    return { athlete, trainer, outsider, card }
  }
  const body = (trainer: string, code: string, preview?: TestResult) => ({peerId:trainer,invitationCode:code,expectedRelationshipId:preview?.expectedRelationshipId??null,expectedRevision:preview?.expectedRevision??null})
  it('creates no placeholder and connects only after registered athlete consent, including retry', async () => {
    const f=await fixture(false), invite=await actor(f.trainer,'create_invitation')
    expect(invite.code).toMatch(/^[A-F0-9]{32}$/)
    const preview=await actor(f.athlete,'resolve',{kind:'code',value:invite.code})
    expect(preview.id).toBe(f.trainer)
    expect(preview.invitationCode).toBe(invite.code)
    expect((await pool.query('select id from public.clients where auth_user_id=$1 or trainer_id=$2',[f.athlete,f.trainer])).rowCount).toBe(0)
    const accepted=await actor(f.athlete,'send',body(f.trainer,invite.code,preview))
    expect(accepted.status).toBe('accepted')
    expect((await actor(f.trainer,'status',{requestId:accepted.id})).status).toBe('accepted')
    expect((await pool.query('select id from public.clients where auth_user_id=$1',[f.athlete])).rowCount).toBe(1)
    expect((await actor(f.athlete,'send',body(f.trainer,invite.code))).id).toBe(accepted.id)
  })
  it('keeps the personal QR separate from private preconsent', async () => {
    const f=await fixture(false), own=await actor(f.trainer,'self')
    expect((await actor(f.athlete,'resolve',{kind:'code',value:own.code})).invitationCode).toBeUndefined()
    expect((await actor(f.athlete,'send',{peerId:f.trainer,expectedRelationshipId:null,expectedRevision:null})).status).toBe('pending')
    expect((await pool.query('select id from public.client_trainer_relationships where trainer_id=$1',[f.trainer])).rowCount).toBe(0)
  })
  it('requires fresh switch consent and preserves workout ownership on success', async () => {
    const f=await fixture(), invite=await actor(f.trainer,'create_invitation'), workout=randomUUID()
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[f.card,f.outsider,f.athlete])
    await pool.query("insert into public.workouts(id,trainer_id,client_id,created_by,workout_date) values($1,$2,$3,$2,current_date)",[workout,f.athlete,f.card])
    await expect(actor(f.athlete,'send',body(f.trainer,invite.code))).rejects.toMatchObject({message:'connection_changed'})
    expect((await pool.query<{claimed_at:Date|null}>('select claimed_at from app_private.registration_invites where id=$1',[invite.id])).rows[0]!.claimed_at).toBeNull()
    expect((await pool.query('select id from app_private.connection_requests where athlete_id=$1',[f.athlete])).rowCount).toBe(0)
    const preview=await actor(f.athlete,'resolve',{kind:'code',value:invite.code})
    expect((await actor(f.athlete,'send',body(f.trainer,invite.code,preview))).status).toBe('accepted')
    expect((await pool.query('select trainer_id,client_id,deleted_at from public.workouts where id=$1',[workout])).rows).toEqual([{trainer_id:f.athlete,client_id:f.card,deleted_at:null}])
  })
  it('refuses another claimant and cannot replay a consumed invite after disconnect/reconnect', async () => {
    const f=await fixture(), second=await fixture(false), invite=await actor(f.trainer,'create_invitation')
    const accepted=await actor(f.athlete,'send',body(f.trainer,invite.code))
    await expect(actor(second.athlete,'send',body(f.trainer,invite.code))).rejects.toMatchObject({message:'connection_offer_unavailable'})
    await expect(actor(second.athlete,'resolve',{kind:'code',value:invite.code})).resolves.toBeNull()
    await pool.query("update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by=$2,updated_at=now() where client_id=$1 and status='active'",[f.card,f.athlete])
    await expect(actor(f.athlete,'send',body(f.trainer,invite.code))).rejects.toMatchObject({message:'connection_changed'})
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[f.card,f.trainer,f.athlete])
    await expect(actor(f.athlete,'send',body(f.trainer,invite.code))).rejects.toMatchObject({message:'connection_changed'})
    expect((await actor(f.athlete,'status',{requestId:accepted.id})).status).toBe('disconnected')
  })
  it('authorizes creation/revoke and respects expiry without creating a client', async () => {
    const f=await fixture(false), invite=await actor(f.trainer,'create_invitation')
    await expect(actor(f.athlete,'create_invitation')).rejects.toMatchObject({message:'connection_forbidden'})
    await expect(actor(f.outsider,'revoke_invitation',{code:invite.code})).rejects.toMatchObject({message:'connection_forbidden'})
    await actor(f.trainer,'revoke_invitation',{code:invite.code})
    await expect(actor(f.athlete,'send',body(f.trainer,invite.code))).rejects.toMatchObject({message:'connection_offer_unavailable'})
    const expired=await actor(f.trainer,'create_invitation')
    await pool.query("update app_private.registration_invites set expires_at=now()-interval '1 second' where id=$1",[expired.id])
    await expect(actor(f.athlete,'send',body(f.trainer,expired.code))).rejects.toMatchObject({message:'connection_offer_unavailable'})
    expect((await pool.query('select id from public.clients where auth_user_id=$1',[f.athlete])).rowCount).toBe(0)
  })
  it('serializes competing claimants and denies direct access to the private delegate', async () => {
    const f=await fixture(false), second=await fixture(false), invite=await actor(f.trainer,'create_invitation')
    const results=await Promise.allSettled([actor(f.athlete,'send',body(f.trainer,invite.code)),actor(second.athlete,'send',body(f.trainer,invite.code))])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
    const db=await pool.connect()
    try {
      await db.query('begin');await db.query('set local role fit_api')
      await expect(db.query("select app_private.connection_directory_before_registration_invites('self','{}')")).rejects.toMatchObject({code:'42501'})
    } finally {await db.query('rollback');db.release()}
  })
})
