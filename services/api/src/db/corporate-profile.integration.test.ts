import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDatabasePool } from './pg-pool.js'
import { hashPilotSessionToken } from '../auth/pilot-session-token.js'
import { DatabasePilotTrainerProfiles, type ProfileWriteContext, type TrainerProfessionalProfileResponse } from '../trainer-profile.js'
import { CorporateAdminStore } from '../corporate-admin.js'
import { CorporateProfilesStore } from '../corporate-profile.js'
import { buildApp } from '../app.js'
import type { MediaObjectStorage } from '../object-storage-media.js'

const source = process.env.TEST_DATABASE_URL
const database = `fit_corporate_profile_${process.pid}`
const draft = { displayName: 'Synthetic coach', bio: 'Draft', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [], experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: false, avatarDataUrl: null, certificates: [], photos: [] }

describe.skipIf(!source)('corporate professional profiles — PostgreSQL17, real actor and RLS', () => {
  let owner: Pool, pool: Pool, runtime: PgDatabasePool, created = false
  let profiles: DatabasePilotTrainerProfiles, store: CorporateProfilesStore
  const coach = randomUUID(), second = randomUUID(), ordinary = randomUUID(), admin = randomUUID(), athlete = randomUUID(), office = randomUUID()
  const tokens = new Map<string,string>([coach, second, ordinary, admin, athlete].map(id => [id, randomBytes(32).toString('base64url')]))
  const session = (id: string) => ({ accessMode: 'read_write' as const, token: tokens.get(id)! })
  const storage = { read: vi.fn(), sign: vi.fn((_ns, path: string) => Promise.resolve(`https://synthetic.invalid/${path}`)), write: vi.fn().mockResolvedValue(undefined), remove: vi.fn<MediaObjectStorage['remove']>().mockResolvedValue(undefined), stat: vi.fn() } satisfies MediaObjectStorage
  async function actor<Row extends QueryResultRow = QueryResultRow>(id: string, sql: string, args: unknown[] = []) {
    const c = await pool.connect()
    try {
      await c.query('begin'); await c.query('set local role fit_api')
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
      const result = await c.query<Row>(sql,args); await c.query('commit'); return result.rows
    } catch (error) { await c.query('rollback'); throw error } finally { c.release() }
  }
  const context = (version = 1, managementVersion = 0, asAdmin = true): ProfileWriteContext => ({ version, managementVersion, commandId: randomUUID(), ...(asAdmin ? { adminTarget: coach } : {}) })
  const mode = (managed: boolean, version = 0) => store.setManagement(session(admin), coach, managed, version, randomUUID())
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_fit_actor_test_database_required')
    owner = new Pool({ connectionString: url.href })
    await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1); if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$`)
    await owner.query(`create database ${database}`); created = true; url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: fileURLToPath(new URL('../../db/migrations',import.meta.url)), direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    pool = new Pool({ connectionString: url.href, max: 8 })
    runtime = new PgDatabasePool({ connectionString: url.href, options: '-c role=fit_api', max: 6 })
    for (const id of [coach,second,ordinary,admin,athlete]) {
      await pool.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic',$2)",[id,[admin,athlete].includes(id)?'client':'trainer'])
      if (![admin,athlete].includes(id)) await pool.query('insert into public.trainers(profile_id) values($1)',[id])
      await pool.query("insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled) values($1,'yandex','read_write',true)",[id])
      await pool.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '2 hours')",[hashPilotSessionToken(tokens.get(id)!),id])
    }
    await pool.query('insert into app_private.corporate_admins(profile_id) values($1)',[admin])
    await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex) values($1,true),($2,true)',[coach,second])
    await pool.query("insert into public.corporate_offices(id,city,name,address) values($1,'Synthetic','One','Test')",[office])
    await pool.query('insert into public.corporate_trainer_offices(trainer_id,office_id) values($1,$2),($3,$2)',[coach,office,second])
    profiles = new DatabasePilotTrainerProfiles(runtime,storage); store = new CorporateProfilesStore(runtime,profiles)
  },90_000)
  beforeEach(async () => {
    await pool.query('delete from app_private.corporate_profile_audit'); await pool.query('delete from app_private.corporate_profile_commands')
    await pool.query('delete from app_private.corporate_profile_management'); await pool.query('delete from app_private.corporate_profile_pilot_trainers')
    await pool.query('delete from public.trainer_professional_profiles')
    await pool.query('update public.corporate_trainers set is_yandex=true,version=1')
    await pool.query('update app_private.corporate_admins set enabled=true')
    for (const id of [coach,second,ordinary]) await pool.query('insert into public.trainer_professional_profiles(trainer_id,draft_data) values($1,$2)',[id,draft])
    vi.clearAllMocks()
  })
  afterAll(async () => { if(runtime) await runtime.end(); if(pool) await pool.end(); if(created) await owner.query(`drop database ${database}`); if(owner) await owner.end() })
  const enable = () => pool.query('insert into app_private.corporate_profile_pilot_trainers values($1,true)',[coach])

  it('keeps the pilot empty and existing nonpilot/ordinary owner edits compatible', async () => {
    expect(await profiles.management(session(coach))).toEqual({ available:false, managedByAdmin:false, version:0 })
    for(const id of [coach,ordinary]) expect((await profiles.saveDraft(session(id),draft)).draft.displayName).toBe(draft.displayName)
    await expect(profiles.getAdmin(session(admin),coach)).rejects.toMatchObject({code:'PT403'})
    expect((await pool.query<{n:number}>('select count(*)::int n from app_private.corporate_profile_audit')).rows[0]!.n).toBe(0)
  })
  it('admits only actual corporate capability AND confirmed target AND its own pilot', async () => {
    await enable()
    expect((await profiles.getAdmin(session(admin),coach)).profile?.draft).toMatchObject(draft)
    const bundle=await new CorporateAdminStore(runtime).bundle(session(admin))
    expect(bundle.trainers.find(t=>t.id===coach)?.profileEditingAvailable).toBe(true)
    expect(bundle.trainers.find(t=>t.id===second)?.profileEditingAvailable).toBe(false)
    for(const id of [second,ordinary,athlete,coach]) await expect(profiles.getAdmin(session(id),coach)).rejects.toMatchObject({code:'PT403'})
    for(const target of [second,ordinary,athlete]) await expect(profiles.getAdmin(session(admin),target)).rejects.toMatchObject({code:'PT403'})
    await expect(actor(admin,'select * from app_private.corporate_profile_pilot_trainers')).rejects.toMatchObject({code:'42501'})
    await expect(actor(admin,'update public.trainer_professional_profiles set draft_data=$2 where trainer_id=$1',[ordinary,{...draft,bio:'Attack'}])).resolves.toEqual([])
    expect((await profiles.getOwn(session(ordinary)))?.draft.bio).toBe('Draft')
  })
  it('OFF permits both authors; stale or missing versions cannot overwrite corrections', async () => {
    await enable()
    const saved=await profiles.saveDraft(session(admin),{...draft,bio:'Admin'},context())
    expect(saved.version).toBe(2)
    await expect(profiles.saveDraft(session(coach),{...draft,bio:'Stale'},context(1,0,false))).rejects.toMatchObject({code:'PT409'})
    await expect(profiles.saveDraft(session(coach),draft)).rejects.toMatchObject({message:'trainer_profile_refresh_required'})
    expect((await profiles.saveDraft(session(coach),{...draft,bio:'Owner'},context(2,0,false))).version).toBe(3)
    const audit=await store.history(session(admin),coach,0)
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({actor_id:coach,action:'save',before_data:{draft_data:{bio:'Admin'}},after_data:{draft_data:{bio:'Owner'}}})
  })
  it('ON denies every old/new owner mutation while leaving reads and unrelated profiles intact', async () => {
    await enable(); await mode(true)
    expect(await profiles.management(session(coach))).toEqual({available:true,managedByAdmin:true,version:1})
    expect((await profiles.getOwn(session(coach)))?.draft).toMatchObject(draft)
    const bytes=Buffer.from([255,216,255,0]);const part={bytes,mimeType:'image/jpeg' as const,width:1,height:1,sizeBytes:4}
    for(const write of [()=>profiles.saveDraft(session(coach),draft),()=>profiles.uploadPhoto(session(coach),draft,{image:part,thumbnail:part},false),()=>profiles.reorderPhotos(session(coach),[]),()=>profiles.deletePhoto(session(coach),randomUUID()),()=>profiles.publish(session(coach)),()=>profiles.unpublish(session(coach)),()=>profiles.setCatalogListing(session(coach),false)]) {
      await expect(write()).rejects.toMatchObject({message:'trainer_profile_managed'})
    }
    expect(storage.write).not.toHaveBeenCalled()
    await expect(actor(coach,'update public.trainer_professional_profiles set draft_data=$2 where trainer_id=$1',[coach,{...draft,bio:'Direct'}])).resolves.toEqual([])
    expect((await profiles.saveDraft(session(ordinary),draft)).version).toBe(2)
    expect((await profiles.saveDraft(session(admin),{...draft,bio:'Allowed'},context(1,1))).version).toBe(2)
  })
  it('switching without a profile never creates or publishes one; OFF restores ordinary editing', async () => {
    await enable(); await pool.query('delete from public.trainer_professional_profiles where trainer_id=$1',[coach])
    await mode(true)
    expect((await profiles.getAdmin(session(admin),coach)).profile).toBeNull()
    expect((await profiles.saveDraft(session(admin),draft,context(0,1))).published).toBeNull()
    await mode(false,1)
    expect((await profiles.saveDraft(session(coach),draft,context(1,2,false))).published).toBeNull()
  })
  it('replays the exact lost-response command once and rejects a reused id with changed intent/actor/versions', async () => {
    await enable();const command=context()
    const { adminTarget: _adminTarget, ...ownerCommand } = command
    void _adminTarget
    const first=await profiles.saveDraft(session(admin),{...draft,bio:'Once'},command)
    expect(await profiles.saveDraft(session(admin),{...draft,bio:'Once'},command)).toEqual(first)
    for(const [who,value,ctx] of [[admin,'Different',command],[coach,'Once',ownerCommand],[admin,'Once',{...command,version:0}]] as const)
      await expect(profiles.saveDraft(session(who),{...draft,bio:value},ctx)).rejects.toMatchObject({code:'PT409'})
    expect(await store.history(session(admin),coach,0)).toHaveLength(1)
  })
  it('serializes simultaneous admin and owner writes and never silently picks a last writer', async () => {
    await enable()
    const outcomes=await Promise.allSettled([profiles.saveDraft(session(admin),{...draft,bio:'Admin'},context()),profiles.saveDraft(session(coach),{...draft,bio:'Owner'},context(1,0,false))])
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1)
    expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1)
    expect(await store.history(session(admin),coach,0)).toHaveLength(1)
  })
  it('status removal atomically resets control, revokes admin, invalidates stale forms; reassignment never restores ON', async () => {
    await enable();await mode(true)
    await actor(admin,'select app_private.save_corporate_trainer($1,false,$2,1)',[coach,[office]])
    expect(await profiles.management(session(coach))).toEqual({available:false,managedByAdmin:false,version:2})
    await expect(profiles.saveDraft(session(admin),draft,context(1,1))).rejects.toMatchObject({code:'PT403'})
    expect((await profiles.saveDraft(session(coach),draft)).version).toBe(2)
    await actor(admin,'select app_private.save_corporate_trainer($1,true,$2,2)',[coach,[office]])
    expect(await profiles.management(session(coach))).toEqual({available:true,managedByAdmin:false,version:2})
    await expect(profiles.saveDraft(session(admin),draft,context(2,1))).rejects.toMatchObject({code:'PT409'})
    const audit=await store.history(session(admin),coach,0)
    expect(audit).toHaveLength(2);expect(audit[0]).toMatchObject({action:'status_removed',actor_id:admin})
  })
  it('keeps stable public identity and snapshots; never deletes a published photo during draft editing', async () => {
    await enable();const bytes=Buffer.from([255,216,255,0]);const part={bytes,mimeType:'image/jpeg' as const,width:1,height:1,sizeBytes:4}
    const uploaded=await profiles.uploadPhoto(session(admin),draft,{image:part,thumbnail:part},false,context())
    const published=await profiles.publish(session(admin),context(uploaded.version))
    const removed=await profiles.deletePhoto(session(admin),published.draft.photos[0]!.id,context(published.version))
    expect(removed.publicId).toBe(published.publicId);expect(removed.published?.photos).toHaveLength(1);expect(removed.draft.photos).toHaveLength(0)
    expect(storage.remove).not.toHaveBeenCalled()
    await profiles.publish(session(admin),context(removed.version))
    expect(storage.remove).toHaveBeenCalledTimes(2)
  })
  it('HTTP denies anonymous/read-only/ordinary actors and forwards validated owner CAS, without trusting target in the body', async () => {
    await enable();const app=buildApp({pilotTrainerProfiles:profiles,corporateProfiles:store,logger:false})
    try {
      const url=`/v1/admin/trainers/${coach}/profile`
      for(const headers of [{},{'x-fit-pilot-session':tokens.get(admin)!},{'x-fit-session':tokens.get(athlete)!}]){
        const res=await app.inject({method:'GET',url,headers});expect([401,403]).toContain(res.statusCode);expect(res.headers['cache-control']).toBe('no-store')
      }
      const saved=await app.inject({method:'PUT',url:'/v1/trainer-profile',headers:{'x-fit-session':tokens.get(coach)!},payload:{...draft,...context(1,0,false),adminTarget:ordinary,email:'injected'}})
      expect(saved.statusCode).toBe(200);expect(saved.json<TrainerProfessionalProfileResponse>().draft).not.toHaveProperty('adminTarget')
      await mode(true)
      const denied=await app.inject({method:'POST',url:'/v1/trainer-profile/publish',headers:{'x-fit-session':tokens.get(coach)!}})
      expect(denied.statusCode).toBe(403);expect(denied.json()).toEqual({error:'trainer_profile_managed'})
      const result=await app.inject({method:'POST',url:url+'/command',headers:{'x-fit-session':tokens.get(admin)!},payload:{action:'save',draft:{...draft,bio:'HTTP'},...context(2,1)}})
      expect(result.statusCode).toBe(200)
    } finally { await app.close() }
  })
  it('rechecks revocation after waiting on the same lock as the status writer', async () => {
    await enable()
    const blocker=await pool.connect(),waiter=await pool.connect()
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(159,1)')
      await waiter.query('begin');await waiter.query('set local role fit_api');await waiter.query("select set_config('request.jwt.claim.sub',$1,true)",[admin])
      const pid=(await waiter.query<{pid:number}>('select pg_backend_pid() pid')).rows[0]!.pid
      pending=waiter.query('select app_private.begin_corporate_profile_write($1,true,1,0,$2,$3)',[coach,randomUUID(),{action:'save',draft}]).then(()=>null,(e:unknown)=>e)
      let waiting=false
      for(let i=0;i<100;i++) {
        waiting=(await blocker.query('select 1 from pg_locks where pid=$1 and not granted',[pid])).rowCount===1
        if(waiting)break
        await new Promise(resolve=>setTimeout(resolve,10))
      }
      expect(waiting).toBe(true)
      await blocker.query('update app_private.corporate_admins set enabled=false where profile_id=$1',[admin]);await blocker.query('commit')
      expect(await pending).toMatchObject({code:'PT403'})
      expect((await pool.query('select id from app_private.corporate_profile_commands')).rows).toEqual([])
    } finally { await blocker.query('rollback');if(pending)await pending;await waiter.query('rollback');blocker.release();waiter.release() }
  })
  it('keeps a committed photo when signing fails, and safely replays a full-gallery upload', async () => {
    await enable()
    const bytes=Buffer.from([255,216,255,0]);const part={bytes,mimeType:'image/jpeg' as const,width:1,height:1,sizeBytes:4}
    const command=context()
    storage.sign.mockRejectedValueOnce(Error('Synthetic signing failure'))
    await expect(profiles.uploadPhoto(session(admin),draft,{image:part,thumbnail:part},false,command)).rejects.toThrow('Synthetic signing failure')
    expect(storage.remove).not.toHaveBeenCalled()
    const first=(await profiles.getAdmin(session(admin),coach)).profile!
    expect(first.draft.photos).toHaveLength(1)
    await profiles.uploadPhoto(session(admin),draft,{image:part,thumbnail:part},false,context(2))
    const full=await profiles.uploadPhoto(session(admin),draft,{image:part,thumbnail:part},false,context(3))
    expect(full.draft.photos).toHaveLength(3)
    const replay=await profiles.uploadPhoto(session(admin),draft,{image:part,thumbnail:part},false,command)
    expect(replay.version).toBe(first.version)
    expect((await profiles.getAdmin(session(admin),coach)).profile!.draft.photos).toHaveLength(3)
    expect(await store.history(session(admin),coach,0)).toHaveLength(3)
    // Only the fresh duplicate objects are cleaned, never a referenced object.
    const removedPaths=storage.remove.mock.calls.map(call=>call[1])
    for(const photo of full.draft.photos) expect(removedPaths.some(path=>path.includes(photo.id))).toBe(false)
  })
  it('rejects an upload if control changes while objects are in flight, and removes its new objects', async () => {
    await enable()
    storage.write.mockImplementationOnce(async()=>{await mode(true)})
    const bytes=Buffer.from([255,216,255,0]);const part={bytes,mimeType:'image/jpeg' as const,width:1,height:1,sizeBytes:4}
    await expect(profiles.uploadPhoto(session(coach),draft,{image:part,thumbnail:part},false,context(1,0,false))).rejects.toMatchObject({message:'trainer_profile_managed'})
    expect(storage.remove).toHaveBeenCalledTimes(2)
    expect((await profiles.getOwn(session(coach)))!.draft.photos).toEqual([])
    expect(await store.history(session(admin),coach,0)).toHaveLength(1)
  })
  it('keeps all independent pilot flags, account details, office assignments and existing business rows unchanged', async () => {
    await enable()
    for(const table of ['corporate_service_pilot_trainers','corporate_personal_pilot_trainers','corporate_duty_pilot_trainers']) {
      await pool.query(`insert into app_private.${table}(profile_id,enabled) values($1,true),($2,false) on conflict(profile_id) do update set enabled=excluded.enabled`,[coach,second])
    }
    const card=randomUUID(),workout=randomUUID()
    await pool.query("insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic client')",[card,coach])
    await pool.query("insert into public.workouts(id,client_id,trainer_id,created_by,workout_date,status,completed_at,training_format) values($1,$2,$3,$3,current_date,'done',now(),'with_trainer')",[workout,card,coach])
    const tables=['public.profiles','public.trainers','public.clients','public.workouts','public.trainer_finance_sessions','public.corporate_trainers','public.corporate_trainer_offices','public.corporate_offices','app_private.corporate_service_pilot_trainers','app_private.corporate_personal_pilot_trainers','app_private.corporate_duty_pilot_trainers']
    const snapshot=async()=>Promise.all(tables.map(table=>pool.query<{data:unknown}>(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from ${table} t`).then(r=>r.rows[0]!.data)))
    const before=await snapshot()
    await mode(true);await profiles.saveDraft(session(admin),{...draft,bio:'Changed professional only'},context(1,1))
    await profiles.publish(session(admin),context(2,1));await profiles.setCatalogListing(session(admin),false,context(3,1))
    await profiles.unpublish(session(admin),context(4,1));await mode(false,1)
    expect(await snapshot()).toEqual(before)
  })
  it('deduplicates mode changes and never reactivates control by replay after status removal/reassignment', async () => {
    await enable();const command=randomUUID()
    await store.setManagement(session(admin),coach,true,0,command)
    expect(await store.setManagement(session(admin),coach,true,0,command)).toMatchObject({managedByAdmin:true,version:1})
    expect(await store.history(session(admin),coach,0)).toHaveLength(1)
    await actor(admin,'select app_private.save_corporate_trainer($1,false,$2,1)',[coach,[office]])
    await actor(admin,'select app_private.save_corporate_trainer($1,true,$2,2)',[coach,[office]])
    expect(await store.setManagement(session(admin),coach,true,0,command)).toMatchObject({managedByAdmin:false,version:2})
    expect(await store.history(session(admin),coach,0)).toHaveLength(2)
  })
  it('refuses rollback once pilot or history exists', async () => {
    await enable()
    const {readFileSync}=await import('node:fs')
    const down=readFileSync(new URL('../../db/migrations/000206_corporate_profile_management.sql',import.meta.url),'utf8').split('-- Down Migration')[1]!
    await expect(pool.query(down)).rejects.toMatchObject({message:'corporate_profile_history_in_use'})
    expect((await profiles.management(session(coach))).available).toBe(true)
  })

})
