import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {Pool,type QueryResultRow} from 'pg'
import {runner} from 'node-pg-migrate'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'
import {CorporateServicesStore} from '../corporate-services.js'
import {PgDatabasePool} from './pg-pool.js'

const source=process.env.TEST_DATABASE_URL,database=`fit_corporate_services_${process.pid}`
describe.skipIf(!source)('corporate services on actual actor/RLS and transactions',()=>{
 let owner:Pool,pool:Pool,created=false,connectionString=''
 const admin=randomUUID(),coach=randomUUID(),other=randomUUID(),ordinary=randomUUID(),athlete=randomUUID(),office=randomUUID(),secondOffice=randomUUID()
 let at:string,from:string,until:string
 beforeAll(async()=>{
  const url=new URL(source??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/fit_actor_test')throw Error('local_fit_actor_test_database_required')
  owner=new Pool({connectionString:url.href});await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login;end if;end $$`)
  await owner.query(`create database ${database}`);created=true;url.pathname=`/${database}`;connectionString=url.href
  await runner({databaseUrl:connectionString,dir:fileURLToPath(new URL('../../db/migrations',import.meta.url)),direction:'up',migrationsTable:'fit_migrations',migrationsSchema:'app_private',createMigrationsSchema:true,verbose:false,log:()=>{}})
  pool=new Pool({connectionString,max:6})
  for(const [id,role] of [[admin,'client'],[coach,'trainer'],[other,'trainer'],[ordinary,'trainer'],[athlete,'client']])await pool.query(`insert into public.profiles(id,first_name,account_role,timezone)values($1,'Synthetic',$2,'Europe/Moscow')`,[id,role])
  for(const id of [coach,other,ordinary,athlete])await pool.query('insert into public.trainers(profile_id)values($1)',[id])
  await pool.query('insert into app_private.corporate_admins(profile_id)values($1)',[admin])
  for(const [id,name] of [[office,'Первый'],[secondOffice,'Второй']])await pool.query(`insert into public.corporate_offices(id,city,name,address)values($1,'Тестовый город',$2,'Синтетический адрес')`,[id,name])
  for(const id of [coach,other,ordinary,athlete]){
   await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex)values($1,true)',[id])
   await pool.query('insert into public.corporate_trainer_offices(trainer_id,office_id)values($1,$2),($1,$3)',[id,office,secondOffice])
  }
  const dates=(await pool.query<{at:string;from:string;until:string}>(`select (now()-interval '1 minute')::text at,
   ((now() at time zone 'Europe/Moscow')::date)::text as "from",
   ((now() at time zone 'Europe/Moscow')::date+1)::text until`)).rows[0]
  if(!dates)throw Error('test_dates_missing')
  at=new Date(dates.at).toISOString();from=dates.from;until=dates.until
 },90_000)
 beforeEach(async()=>{
  await pool.query('delete from app_private.corporate_service_commands');await pool.query('delete from app_private.corporate_services')
  await pool.query('delete from app_private.corporate_service_pilot_trainers')
  await pool.query('insert into app_private.corporate_service_pilot_trainers(profile_id,enabled)values($1,true),($2,true),($3,true)',[coach,ordinary,athlete])
  await pool.query('update public.corporate_trainers set is_yandex=true');await pool.query('update public.corporate_trainers set is_yandex=false where trainer_id=$1',[ordinary])
  await pool.query('update public.corporate_offices set archived=false')
  await pool.query("update public.profiles set timezone='Europe/Moscow' where id=$1",[admin])
 })
 afterAll(async()=>{if(pool)await pool.end();if(created)await owner.query(`drop database ${database}`);if(owner)await owner.end()})
 async function actor<Row extends QueryResultRow=QueryResultRow>(id:string,sql:string,args:unknown[]=[]){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await c.query('set local role fit_api');const r=await c.query<Row>(sql,args);await c.query('commit');return r.rows}catch(e){await c.query('rollback');throw e}finally{c.release()}}
 const save=(who:string=coach,id:string=randomUUID(),command:string=randomUUID(),version=0,kind='consultation',officeId:string=office,time=at)=>actor<{result:{saved:boolean;id:string;version:number}}>(who,'select app_private.save_corporate_service($1,$2,$3,$4,$5,$6,false) result',[command,id,kind,officeId,time,version])
 const list=(who=coach,cursorAt:string|null=null,cursorId:string|null=null)=>actor<{data:{records:Array<{id:string;version:number;voidedAt:string|null}>;nextCursor:{at:string;id:string}|null;offices:unknown[]}}>(who,'select app_private.read_corporate_services($1,$2,$3,$4) data',[from,until,cursorAt,cursorId])
 const stats=()=>actor<{data:{counts:Record<string,number>}}>(admin,'select app_private.corporate_service_statistics($1,$2) data',[from,until])
 it('requires all independent gates and denies tables, self-grants and every outsider command',async()=>{
  for(const id of [other,ordinary,athlete,admin]){
   expect(await actor(id,'select app_private.corporate_services_allowed() allowed')).toEqual([{allowed:false}])
   await expect(save(id)).rejects.toMatchObject({code:'PT403'})
   await expect(list(id)).rejects.toMatchObject({code:'PT403'})
   await expect(actor(id,'select app_private.read_corporate_service_audit($1)',[randomUUID()])).rejects.toMatchObject({code:'PT403'})
  }
  for(const table of ['corporate_service_pilot_trainers','corporate_services','corporate_service_commands'])await expect(actor(coach,`select * from app_private.${table}`)).rejects.toMatchObject({code:'42501'})
  await expect(actor(coach,'insert into app_private.corporate_service_pilot_trainers(profile_id,enabled)values($1,true)',[other])).rejects.toMatchObject({code:'42501'})
  await expect(actor(coach,'select app_private.corporate_service_statistics($1,$2)',[from,until])).rejects.toMatchObject({code:'PT403'})
 })
 it('creates once under a lost response and does not collapse distinct real services',async()=>{
  const id=randomUUID(),command=randomUUID();const a=await save(coach,id,command);expect(await save(coach,id,command)).toEqual(a)
  await save();expect((await stats())[0]!.data.counts.consultation).toBe(2)
  expect((await actor<{data:{counts:{consultation:number}}}>(admin,'select app_private.corporate_service_statistics($1,$2,$3,$4) data',[from,until,coach,secondOffice]))[0]!.data.counts.consultation).toBe(0)
  expect((await pool.query<{n:number}>('select count(*)::int n from app_private.corporate_service_commands')).rows[0]!.n).toBe(2)
  await expect(save(coach,id,command,0,'tour')).rejects.toMatchObject({code:'PT409'})
  await expect(save(coach,id,randomUUID())).rejects.toMatchObject({code:'PT409'})
 })
 it('corrects and voids an existing record without extra counts and preserves every audit version',async()=>{
  const id=randomUUID();await save(coach,id);await save(coach,id,randomUUID(),1,'tour')
  expect((await stats())[0]!.data.counts).toMatchObject({consultation:0,tour:1})
  await expect(save(coach,id,randomUUID(),1)).rejects.toMatchObject({code:'PT409'})
  const command=randomUUID(),sql='select app_private.save_corporate_service($1,$2,null,null,null,2,true) result'
  const result=await actor(coach,sql,[command,id]);expect(await actor(coach,sql,[command,id])).toEqual(result)
  expect((await stats())[0]!.data.counts.tour).toBe(0)
  const records=(await list())[0]!.data.records;expect(records).toHaveLength(1);expect(records[0]).toMatchObject({id,version:3});expect(typeof records[0]?.voidedAt).toBe('string')
  expect((await actor<{data:{events:unknown[]}}>(coach,'select app_private.read_corporate_service_audit($1) data',[id]))[0]!.data.events).toHaveLength(3)
  await expect(save(coach,id,randomUUID(),3)).rejects.toMatchObject({code:'PT409'})
 })
 it('never allows another eligible trainer to edit, void or read the audit of a foreign record',async()=>{
  const id=randomUUID();await save(coach,id);await pool.query('insert into app_private.corporate_service_pilot_trainers(profile_id,enabled)values($1,true)',[other])
  await expect(save(other,id,randomUUID(),1)).rejects.toMatchObject({code:'PT404'})
  await expect(actor(other,'select app_private.save_corporate_service($1,$2,null,null,null,1,true)',[randomUUID(),id])).rejects.toMatchObject({code:'PT404'})
  await expect(actor(other,'select app_private.read_corporate_service_audit($1)',[id])).rejects.toMatchObject({code:'PT404'})
  await expect(actor(other,'select app_private.read_corporate_service($1)',[id])).rejects.toMatchObject({code:'PT404'})
  expect((await actor<{data:{id:string}}>(coach,'select app_private.read_corporate_service($1) data',[id]))[0]!.data.id).toBe(id)
  expect((await list(other))[0]!.data.records).toEqual([])
 })
 it('checks actual active assignments, real service kinds, finite past time and bounded ranges',async()=>{
  for(const [kind,officeId,time] of [['personal',office,at],['tour',randomUUID(),at],['tour',office,'infinity'],['tour',office,new Date(Date.now()+86400000).toISOString()]])await expect(save(coach,randomUUID(),randomUUID(),0,kind,officeId,time)).rejects.toMatchObject({code:'PT422'})
  await pool.query('update public.corporate_offices set archived=true where id=$1',[office]);await expect(save()).rejects.toMatchObject({code:'PT422'})
  await save(coach,randomUUID(),randomUUID(),0,'intro',secondOffice)
  await expect(actor(coach,'select app_private.read_corporate_services($1,$2)',[until,from])).rejects.toMatchObject({code:'PT422'})
 })
 it('uses viewer local date boundaries and actual DST rather than UTC date slicing',async()=>{
  await expect(actor(coach,'select * from app_private.corporate_service_bounds($1,$2)',['2026-11-01','2026-11-02'])).rejects.toMatchObject({code:'42501'})
  // Helper functions themselves are not exposed to fit_api; inspect through the owner below.
  const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[coach]);const b=(await c.query<{start_at:Date}>(`select start_at from app_private.corporate_service_bounds('2026-11-01','2026-11-02')`)).rows[0];expect(new Date(b!.start_at).toISOString()).toBe('2026-10-31T21:00:00.000Z');await c.query('commit')}finally{c.release()}
  await pool.query("update public.profiles set timezone='America/New_York' where id=$1",[admin])
  const d=await pool.connect();try{await d.query('begin');await d.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);expect(Number((await d.query<{hours:string}>(`select extract(epoch from(end_at-start_at))/3600 hours from app_private.corporate_service_bounds('2026-11-01','2026-11-02')`)).rows[0]!.hours)).toBe(25);await d.query('commit')}finally{d.release()}
 })
 it('paginates same-time records deterministically and does not bury history',async()=>{
  for(let n=0;n<51;n++)await save()
  const first=(await list())[0]!.data;expect(first.records).toHaveLength(50);expect(first.nextCursor).not.toBeNull()
  const second=(await list(coach,first.nextCursor!.at,first.nextCursor!.id))[0]!.data;expect(second.records).toHaveLength(1);expect(second.nextCursor).toBeNull()
  expect(new Set([...first.records,...second.records].map(r=>r.id)).size).toBe(51)
 })
 it('paginates audit versions without truncating stored change history',async()=>{
  const id=randomUUID();await save(coach,id);for(let v=1;v<33;v++)await save(coach,id,randomUUID(),v,v%2?'tour':'consultation')
  const first=(await actor<{data:{events:Array<{version:number}>;nextBeforeVersion:number}}>(coach,'select app_private.read_corporate_service_audit($1) data',[id]))[0]!.data
  expect(first.events).toHaveLength(30);expect(first.nextBeforeVersion).toBe(4)
  const second=(await actor<{data:{events:unknown[];nextBeforeVersion:null}}>(coach,'select app_private.read_corporate_service_audit($1,$2) data',[id,first.nextBeforeVersion]))[0]!.data
  expect(second.events).toHaveLength(3);expect(second.nextBeforeVersion).toBeNull()
 })
 it('retains statistics after corporate access is removed, while own data access closes',async()=>{
  await save();await pool.query('update public.corporate_trainers set is_yandex=false where trainer_id=$1',[coach])
  await expect(list()).rejects.toMatchObject({code:'PT403'});expect((await stats())[0]!.data.counts.consultation).toBe(1)
 })
 it('retains anonymous aggregate history when a trainer account is deleted',async()=>{
  const retired=randomUUID();await pool.query(`insert into public.profiles(id,first_name,account_role,timezone)values($1,'Synthetic retired','trainer','Europe/Moscow')`,[retired])
  await pool.query('insert into public.trainers(profile_id)values($1)',[retired]);await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex)values($1,true)',[retired])
  await pool.query('insert into public.corporate_trainer_offices(trainer_id,office_id)values($1,$2)',[retired,office]);await pool.query('insert into app_private.corporate_service_pilot_trainers(profile_id,enabled)values($1,true)',[retired])
  await save(retired);await pool.query('delete from public.trainers where profile_id=$1',[retired]);await pool.query('delete from public.profiles where id=$1',[retired])
  expect((await stats())[0]!.data.counts.consultation).toBe(1)
  expect((await pool.query<{trainer_id:string|null}>('select trainer_id from app_private.corporate_services')).rows).toEqual([{trainer_id:null}])
  expect((await pool.query<{actor_id:string|null}>('select actor_id from app_private.corporate_service_commands')).rows).toEqual([{actor_id:null}])
 })
 it.each(['pilot','office'] as const)('rechecks %s after waiting for concurrent owner changes',async change=>{
  const blocker=await pool.connect(),waiting=await pool.connect();let pending:Promise<unknown>|undefined
  try{
   await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(159,1)')
   await waiting.query('begin');await waiting.query("select set_config('request.jwt.claim.sub',$1,true)",[coach]);await waiting.query('set local role fit_api')
   const pid=(await waiting.query<{pid:number}>('select pg_backend_pid() pid')).rows[0]!.pid
   pending=waiting.query('select app_private.save_corporate_service($1,$2,\'tour\',$3,$4,0,false)',[randomUUID(),randomUUID(),office,at]);const outcome=pending.catch((error:unknown)=>error)
   let blocked=false;for(let n=0;n<50;n++){blocked=(await pool.query<{blocked:boolean}>("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) blocked",[pid])).rows[0]!.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10))}expect(blocked).toBe(true)
   if(change==='pilot')await blocker.query('update app_private.corporate_service_pilot_trainers set enabled=false where profile_id=$1',[coach]);else await blocker.query('update public.corporate_offices set archived=true where id=$1',[office])
   await blocker.query('commit');expect(await outcome).toMatchObject({code:change==='pilot'?'PT403':'PT422'});await waiting.query('rollback')
   expect((await pool.query<{n:number}>('select count(*)::int n from app_private.corporate_services')).rows[0]!.n).toBe(0)
  }finally{await blocker.query('rollback');if(pending)await pending.catch(()=>{});await waiting.query('rollback');blocker.release();waiting.release()}
 })
 it('resolves the genuine app session and leaves workout/finance/business tables untouched',async()=>{
  const token='k'.repeat(43);await pool.query(`insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled)values($1,'yandex','read_write',true)`,[coach]);await pool.query(`insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at)values($1,$2,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),coach])
  const runtime=new PgDatabasePool({connectionString,max:1});try{const store=new CorporateServicesStore(runtime);expect(await store.access({accessMode:'read_write',token})).toEqual({allowed:true});await store.save({accessMode:'read_write',token},{commandId:randomUUID(),id:randomUUID(),officeId:office,kind:'instruction',occurredAt:at,version:0})}finally{await runtime.end()}
  for(const table of ['workouts','client_trainers','client_trainer_relationships','trainer_finance_sessions'])expect((await pool.query<{n:number}>(`select count(*)::int n from public.${table}`)).rows[0]!.n).toBe(0)
 })
})
