import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import {Pool,type QueryResultRow} from 'pg'
import {runner} from 'node-pg-migrate'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'
const source=process.env.TEST_DATABASE_URL,database=`fit_corporate_duty_${process.pid}`
type Duty={id:string;trainerId:string;officeId:string;timeZone:string;startedAt:string;endedAt:string|null;status:string;seconds:number|null;version:number}
type Stats={seconds:number;days:number;completed:number;open:number;review:number;records:Duty[];nextCursor:{at:string;id:string}|null}
describe.skipIf(!source)('corporate duties native PostgreSQL17/RLS',()=>{
 let owner:Pool,pool:Pool,created=false
 const coach=randomUUID(),other=randomUUID(),admin=randomUUID(),athlete=randomUUID(),office=randomUUID(),second=randomUUID()
 beforeAll(async()=>{
  const url=new URL(source??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/fit_actor_test')throw Error('local_fit_actor_test_database_required')
  owner=new Pool({connectionString:url.href});await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);if not exists(select 1 from pg_roles where rolname='fit_api')then create role fit_api login;end if;end $$`)
  await owner.query(`create database ${database}`);created=true;url.pathname=`/${database}`
  await runner({databaseUrl:url.href,dir:fileURLToPath(new URL('../../db/migrations',import.meta.url)),direction:'up',migrationsTable:'fit_migrations',migrationsSchema:'app_private',createMigrationsSchema:true,verbose:false,log:()=>{}})
  pool=new Pool({connectionString:url.href,max:6})
  for(const [id,role]of [[coach,'trainer'],[other,'trainer'],[admin,'client'],[athlete,'client']])await pool.query("insert into public.profiles(id,first_name,account_role)values($1,'Synthetic',$2)",[id,role])
  for(const id of [coach,other])await pool.query('insert into public.trainers(profile_id)values($1)',[id])
  await pool.query('insert into app_private.corporate_admins(profile_id)values($1)',[admin])
  await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex)values($1,true),($2,true)',[coach,other])
  for(const [id,name]of [[office,'One'],[second,'Two']])await pool.query("insert into public.corporate_offices(id,city,name,address)values($1,'Synthetic',$2,'Test')",[id,name])
  for(const who of [coach,other])for(const id of [office,second])await pool.query('insert into public.corporate_trainer_offices(trainer_id,office_id)values($1,$2)',[who,id])
 },90_000)
 beforeEach(async()=>{
  await pool.query('delete from app_private.corporate_duty_audit');await pool.query('delete from app_private.corporate_duty_commands');await pool.query('delete from app_private.corporate_duties')
  await pool.query('delete from app_private.corporate_duty_pilot_trainers');await pool.query('insert into app_private.corporate_duty_pilot_trainers values($1,true)',[coach])
  await pool.query('update public.corporate_trainers set is_yandex=true');await pool.query('update public.corporate_offices set archived=false')
  await pool.query('delete from app_private.corporate_office_time_zones');await pool.query("insert into app_private.corporate_office_time_zones values($1,'Europe/Moscow',1),($2,'America/New_York',1)",[office,second])
 })
 afterAll(async()=>{if(pool)await pool.end();if(created)await owner.query(`drop database ${database}`);if(owner)await owner.end()})
 async function actor<Row extends QueryResultRow=QueryResultRow>(who:string,sql:string,args:unknown[]=[]){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[who]);await c.query('set local role fit_api');const r=await c.query<Row>(sql,args);await c.query('commit');return r.rows}catch(e){await c.query('rollback');throw e}finally{c.release()}}
 const cmd=async(who:string=coach,action='start',id:string=randomUUID(),version=0,off:string|null=office,start:string|null=null,end:string|null=null,reason:string|null=null,command:string=randomUUID())=>(await actor<{data:Duty}>(who,'select app_private.command_corporate_duty($1,$2,$3,$4,$5,$6,$7,$8) data',[command,id,action,off,version,start,end,reason]))[0]!.data
 const stats=async(who=admin,from='2026-11-01',until='2026-12-01',trainer:string|null=null,off:string|null=null,cursor:Stats['nextCursor']=null,adminMode=true)=>(await actor<{data:Stats}>(who,'select app_private.read_corporate_duties($1,$2,$3,$4,$5,$6,$7) data',[from,until,trainer,off,cursor?.at??null,cursor?.id??null,adminMode]))[0]!.data
 const access=async(who=coach)=>(await actor<{data:{allowed:boolean;hasHistory:boolean;active:Duty|null;offices:unknown[]}}>(who,'select app_private.corporate_duty_access() data'))[0]!.data
 const audit=async(id:string)=>(await actor<{data:{records:unknown[]}}>(admin,'select app_private.read_corporate_duty_audit($1) data',[id]))[0]!.data.records
 async function interval(start:string,end:string,off:string=office){const d=await cmd();return cmd(admin,'correct',d.id,d.version,off,start,end,'Synthetic correction')}
 it('requires a separate confirmed pilot, denies self-grants and private table reads',async()=>{
  for(const who of [other,athlete,admin]){expect((await access(who)).allowed).toBe(false);await expect(cmd(who)).rejects.toMatchObject({code:'PT403'})}
  await pool.query('update public.corporate_trainers set is_yandex=false where trainer_id=$1',[coach]);expect((await access()).allowed).toBe(false)
  for(const name of ['corporate_duty_pilot_trainers','corporate_duties','corporate_duty_audit','corporate_office_time_zones','corporate_duty_commands'])await expect(actor(coach,`select * from app_private.${name}`)).rejects.toMatchObject({code:'42501'})
  await expect(actor(coach,'insert into app_private.corporate_duty_pilot_trainers values($1,true)',[other])).rejects.toMatchObject({code:'42501'})
  await expect(stats(coach)).rejects.toMatchObject({code:'PT403'})
 })
 it('timestamps on the server, replays lost start/stop, checks whole intent and stale versions',async()=>{
  const id=randomUUID(),command=randomUUID(),d=await cmd(coach,'start',id,0,office,null,null,null,command)
  expect(d.status).toBe('open');expect(Math.abs(Date.parse(d.startedAt)-Date.now())).toBeLessThan(10000)
  expect(await cmd(coach,'start',id,0,office,null,null,null,command)).toEqual(d)
  await expect(cmd(coach,'start',id,0,second,null,null,null,command)).rejects.toMatchObject({code:'PT409'})
  await expect(cmd(coach,'stop',id,0,null)).rejects.toMatchObject({code:'PT409'})
  const stopId=randomUUID(),stopped=await cmd(coach,'stop',id,1,null,null,null,null,stopId)
  expect(stopped.status).toBe('completed');expect(stopped.seconds).toBeGreaterThan(0)
  expect(await cmd(coach,'stop',id,1,null,null,null,null,stopId)).toEqual(stopped)
  expect(await audit(id)).toHaveLength(2)
 })
 it('serializes starts in different offices/devices into a single active duty',async()=>{
  const r=await Promise.allSettled([cmd(),cmd(coach,'start',randomUUID(),0,second)])
  expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(r.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'PT409'}})
  expect((await access()).active).not.toBeNull()
 })
 it('requires an explicit zone, assigned active office; old office saves cannot clear the sidecar',async()=>{
  await pool.query('delete from app_private.corporate_office_time_zones where office_id=$1',[office])
  await expect(cmd()).rejects.toMatchObject({message:'corporate_duty_timezone_required'})
  await actor(admin,"select app_private.save_corporate_duty_zone($1,'Europe/Moscow',0)",[office])
  const old=(await pool.query<{version:number}>('select version from public.corporate_offices where id=$1',[office])).rows[0]!
  await actor(admin,"select app_private.save_corporate_office($1,'Synthetic','One','Changed',false,$2)",[office,old.version])
  expect((await cmd()).timeZone).toBe('Europe/Moscow')
  await expect(actor(coach,"select app_private.save_corporate_duty_zone($1,'UTC',1)",[office])).rejects.toMatchObject({code:'PT403'})
  await expect(actor(admin,"select app_private.save_corporate_duty_zone($1,'guess',1)",[office])).rejects.toMatchObject({code:'PT422'})
 })
 it('allows finishing and history after pilot/confirmation revoke and office archive',async()=>{
  const d=await cmd();await pool.query('update app_private.corporate_duty_pilot_trainers set enabled=false');await pool.query('update public.corporate_trainers set is_yandex=false');await pool.query('update public.corporate_offices set archived=true')
  const a=await access();expect(a.allowed).toBe(false);expect(a.hasHistory).toBe(true);expect(a.active?.id).toBe(d.id)
  await expect(cmd()).rejects.toMatchObject({code:'PT403'})
  await expect(cmd(other,'stop',d.id,1,null)).rejects.toMatchObject({code:'PT404'})
  expect((await cmd(coach,'stop',d.id,1,null)).status).toBe('completed')
  expect((await stats(coach,'2020-01-01','2020-02-01',other,null,null,false)).seconds).toBe(0)
 })
 it('splits midnight/month boundaries in office timezone and counts a day once across offices',async()=>{
  await interval('2026-10-31T19:00:00Z','2026-10-31T23:00:00Z')
  expect(await stats(admin,'2026-10-01','2026-11-01')).toMatchObject({seconds:7200,days:1,completed:1})
  expect(await stats()).toMatchObject({seconds:7200,days:1,completed:1})
  await interval('2026-11-01T10:00:00Z','2026-11-01T11:00:00Z',second)
  expect(await stats()).toMatchObject({seconds:10800,days:1,completed:2})
  expect(await stats(admin,'2026-11-01','2026-12-01',null,second)).toMatchObject({seconds:3600,days:1,completed:1})
 })
 it('uses real DST elapsed seconds and snapshots timezone for later same-office corrections',async()=>{
  const d=await interval('2026-11-01T04:00:00Z','2026-11-01T08:00:00Z',second)
  expect(await stats()).toMatchObject({seconds:14400,days:1})
  await actor(admin,"select app_private.save_corporate_duty_zone($1,'Pacific/Kiritimati',1)",[second])
  const x=await cmd(admin,'correct',d.id,d.version,second,'2026-11-01T04:00:00Z','2026-11-01T09:00:00Z','Keep old timezone')
  expect(x.timeZone).toBe('America/New_York');expect((await stats()).seconds).toBe(18000)
 })
 it('separates open and >24h anomalies, accepts only reasoned admin confirmation',async()=>{
  const d=await interval('2026-11-01T00:00:00Z','2026-11-02T01:00:00Z');await cmd()
  expect(await stats()).toMatchObject({seconds:0,days:0,completed:0,open:1,review:1})
  await expect(cmd(coach,'confirm',d.id,d.version,null,null,null,'Reason')).rejects.toMatchObject({code:'PT403'})
  await expect(cmd(admin,'confirm',d.id,d.version,null,null,null,' ')).rejects.toMatchObject({code:'PT422'})
  await cmd(admin,'confirm',d.id,d.version,null,null,null,'Confirmed actual interval')
  expect(await stats()).toMatchObject({seconds:90000,days:2,completed:1,review:0})
 })
 it('preserves original audit, handles correction/void/restore with CAS and forbids overlap across offices',async()=>{
  const a=await interval('2026-11-01T10:00:00Z','2026-11-01T11:00:00Z'),b=await interval('2026-11-01T12:00:00Z','2026-11-01T13:00:00Z',second)
  await expect(cmd(admin,'correct',b.id,b.version,second,'2026-11-01T10:30:00Z','2026-11-01T12:30:00Z','Overlap')).rejects.toMatchObject({message:'corporate_duty_overlap'})
  const before=await audit(a.id);expect(before).toHaveLength(2)
  const voided=await cmd(admin,'void',a.id,a.version,null,null,null,'Wrong entry')
  expect((await stats()).seconds).toBe(3600)
  await expect(cmd(admin,'restore',a.id,a.version,office,'2026-11-01T10:00:00Z','2026-11-01T11:00:00Z','Stale')).rejects.toMatchObject({code:'PT409'})
  await cmd(admin,'restore',a.id,voided.version,office,'2026-11-01T10:00:00Z','2026-11-01T11:00:00Z','Restored')
  expect((await stats()).seconds).toBe(7200)
  const after=await audit(a.id);expect(after).toHaveLength(4);expect(after.slice(2)).toEqual(before)
 })
 it('counts person-days separately for different trainers, never twice across offices for one trainer',async()=>{
  await interval('2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')
  await pool.query('insert into app_private.corporate_duty_pilot_trainers values($1,true)',[other])
  const d=await cmd(other)
  await cmd(admin,'correct',d.id,d.version,office,'2026-11-01T10:00:00Z','2026-11-01T11:00:00Z','Other trainer interval')
  expect(await stats()).toMatchObject({seconds:7200,days:2,completed:2})
  expect(await stats(admin,'2026-11-01','2026-12-01',coach)).toMatchObject({seconds:3600,days:1,completed:1})
 })
 it('never projects a currently open duty into a future report period',async()=>{
  await cmd()
  const dates=(await pool.query<{from:string;until:string}>("select ((clock_timestamp() at time zone 'Europe/Moscow')::date+1)::text \"from\",((clock_timestamp() at time zone 'Europe/Moscow')::date+2)::text until")).rows[0]!
  expect(await stats(admin,dates.from,dates.until)).toMatchObject({seconds:0,days:0,completed:0,open:0,records:[]})
 })
 it('paginates detail while totals stay complete and rejects destructive rollback of history',async()=>{
  for(let n=0;n<51;n++){const start=new Date(Date.UTC(2026,10,1,0,n)).toISOString(),end=new Date(Date.UTC(2026,10,1,0,n,30)).toISOString();await interval(start,end)}
  const a=await stats();expect(a.records).toHaveLength(50);expect(a).toMatchObject({seconds:1530,days:1,completed:51});expect(a.nextCursor).not.toBeNull()
  const b=await stats(admin,'2026-11-01','2026-12-01',null,null,a.nextCursor);expect(b.records).toHaveLength(1);expect(b.seconds).toBe(a.seconds)
  expect(new Set([...a.records,...b.records].map(x=>x.id)).size).toBe(51)
  const down=readFileSync(new URL('../../db/migrations/000198_corporate_duties.sql',import.meta.url),'utf8').split('-- Down Migration')[1]!
  await expect(pool.query(down)).rejects.toMatchObject({message:'corporate_duty_history_in_use'})
 })
})
