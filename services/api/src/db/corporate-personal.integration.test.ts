import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {Pool,type QueryResultRow} from 'pg'
import {runner} from 'node-pg-migrate'
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'

const source=process.env.TEST_DATABASE_URL,database=`fit_corporate_personal_${process.pid}`
type Mark={marked:boolean;version:number;fromDate:string|null}
type Statistics={count:number;trainers:unknown[];records:Array<{id:string;date:string;trainerId:string;trainerName:string;status:string}>;nextCursor:{date:string;id:string}|null}
describe.skipIf(!source)('corporate personal training on native PostgreSQL/RLS',()=>{
  let owner:Pool,pool:Pool,created=false,today:string,yesterday:string,tomorrow:string
  const coach=randomUUID(),other=randomUUID(),ordinary=randomUUID(),athlete=randomUUID(),admin=randomUUID(),card=randomUUID(),foreign=randomUUID()
  beforeAll(async()=>{
    const url=new URL(source??'')
    if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/fit_actor_test')throw Error('local_fit_actor_test_database_required')
    owner=new Pool({connectionString:url.href})
    await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login;end if;end $$`)
    await owner.query(`create database ${database}`);created=true;url.pathname=`/${database}`
    await runner({databaseUrl:url.href,dir:fileURLToPath(new URL('../../db/migrations',import.meta.url)),direction:'up',migrationsTable:'fit_migrations',migrationsSchema:'app_private',createMigrationsSchema:true,verbose:false,log:()=>{}})
    pool=new Pool({connectionString:url.href,max:6})
    for(const [id,role] of [[coach,'trainer'],[other,'trainer'],[ordinary,'trainer'],[athlete,'client'],[admin,'client']]){
      await pool.query("insert into public.profiles(id,first_name,account_role,timezone)values($1,'Synthetic',$2,'Europe/Moscow')",[id,role])
    }
    for(const id of [coach,other,ordinary])await pool.query('insert into public.trainers(profile_id)values($1)',[id])
    await pool.query("insert into public.clients(id,trainer_id,full_name)values($1,$2,'Private synthetic athlete'),($3,$4,'Foreign synthetic athlete')",[card,coach,foreign,other])
    await pool.query('insert into app_private.corporate_admins(profile_id)values($1)',[admin])
    await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex)values($1,true),($2,true),($3,false)',[coach,other,ordinary])
    const dates=(await pool.query<{today:string;yesterday:string;tomorrow:string}>("select ((now() at time zone 'Europe/Moscow')::date)::text today,((now() at time zone 'Europe/Moscow')::date-1)::text yesterday,((now() at time zone 'Europe/Moscow')::date+1)::text tomorrow")).rows[0]!
    ;({today,yesterday,tomorrow}=dates)
  },90_000)
  beforeEach(async()=>{
    await pool.query('delete from app_private.corporate_personal_workouts')
    await pool.query('delete from app_private.corporate_employee_commands')
    await pool.query('delete from app_private.corporate_employee_marks')
    await pool.query('delete from app_private.corporate_employee_periods')
    await pool.query('delete from public.trainer_finance_sessions')
    await pool.query('delete from public.workouts')
    await pool.query('delete from app_private.corporate_personal_pilot_trainers')
    await pool.query('insert into app_private.corporate_personal_pilot_trainers(profile_id,enabled)values($1,true),($2,true)',[coach,ordinary])
    await pool.query('update public.corporate_trainers set is_yandex=true where trainer_id=$1',[coach])
    await pool.query('delete from public.client_trainer_relationships where client_id=$1',[card])
    await pool.query('update public.clients set auth_user_id=null,archived_at=null where id=$1',[card])
    await pool.query("update public.profiles set timezone='Europe/Moscow' where id=$1",[coach])
  })
  afterAll(async()=>{if(pool)await pool.end();if(created)await owner.query(`drop database ${database}`);if(owner)await owner.end()})
  async function actor<Row extends QueryResultRow=QueryResultRow>(id:string,sql:string,args:unknown[]=[]){
    const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await c.query('set local role fit_api');const r=await c.query<Row>(sql,args);await c.query('commit');return r.rows}catch(e){await c.query('rollback');throw e}finally{c.release()}
  }
  const mark=(who=coach,client=card,marked=true,version=0,command=randomUUID())=>actor<{data:Mark}>(who,
    'select app_private.save_corporate_employee_mark($1,$2,$3,$4) data',[command,client,marked,version])
  const read=(who=coach,client=card)=>actor<{data:Mark}>(who,'select app_private.read_corporate_employee_mark($1) data',[client])
  const stats=(who=admin,trainer:string|null=null,cursor:Statistics['nextCursor']=null)=>actor<{data:Statistics}>(who,
    'select app_private.corporate_personal_statistics($1,$2,$3,$4,$5) data',[yesterday,tomorrow,trainer,cursor?.date??null,cursor?.id??null])
  async function workout(status='done',format='with_trainer',date=today,completed=true,author=coach){
    const id=randomUUID();await pool.query(`insert into public.workouts(id,client_id,trainer_id,created_by,workout_date,status,training_format,completed_at,started_at)
      values($1,$2,$3,$8,$4,$5,$6,case when $5='done' then case when $7 then clock_timestamp() else clock_timestamp()-interval '1 day' end else null end,case when $5='in_progress' then clock_timestamp() else null end)`,[id,card,coach,date,status,format,completed,author]);return id
  }
  it('requires confirmed trainer AND the independent pilot, denies own grants and other people',async()=>{
    for(const who of [other,ordinary,athlete,admin]){
      expect(await actor(who,'select app_private.corporate_personal_allowed() allowed')).toEqual([{allowed:false}])
      await expect(mark(who)).rejects.toMatchObject({code:'PT403'})
      await expect(read(who)).rejects.toMatchObject({code:'PT403'})
    }
    for(const table of ['corporate_personal_pilot_trainers','corporate_employee_marks','corporate_employee_periods','corporate_employee_commands','corporate_personal_workouts','corporate_personal_counted']){
      await expect(actor(coach,`select * from app_private.${table}`)).rejects.toMatchObject({code:'42501'})
    }
    await expect(actor(coach,'insert into app_private.corporate_personal_pilot_trainers(profile_id,enabled)values($1,true)',[coach])).rejects.toMatchObject({code:'42501'})
    await expect(mark(coach,foreign)).rejects.toMatchObject({code:'PT404'})
    await expect(stats(coach)).rejects.toMatchObject({code:'PT403'})
  })
  it('sets today on server, replays a lost response, rejects stale/conflicting commands and keeps periods',async()=>{
    const command=randomUUID(),a=await mark(coach,card,true,0,command)
    expect(a[0]!.data).toEqual({marked:true,version:1,fromDate:today})
    expect(await mark(coach,card,true,0,command)).toEqual(a)
    expect((await pool.query('select * from app_private.corporate_employee_periods')).rows).toHaveLength(1)
    await expect(mark(coach,card,false,1,command)).rejects.toMatchObject({code:'PT409'})
    await expect(mark(coach,card,false,0)).rejects.toMatchObject({code:'PT409'})
    await mark(coach,card,false,1)
    expect((await read())[0]!.data).toEqual({marked:false,version:2,fromDate:null})
    await mark(coach,card,true,2)
    expect((await pool.query('select * from app_private.corporate_employee_periods')).rows).toHaveLength(2)
  })
  it('serializes competing mark commands without duplicate open periods',async()=>{
    const results=await Promise.allSettled([mark(),mark()])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'PT409'}})
    expect((await pool.query('select * from app_private.corporate_employee_periods where ended_at is null')).rows).toHaveLength(1)
  })
  it('never backfills completed history or first completions dated before the mark',async()=>{
    const old=await workout();await workout('done','with_trainer',today,false);await mark()
    await pool.query('update public.workouts set version=version+1 where id=$1',[old])
    await workout('done','with_trainer',yesterday)
    expect((await stats())[0]!.data.count).toBe(0)
    expect((await pool.query('select * from app_private.corporate_personal_workouts')).rows).toHaveLength(0)
  })
  it('counts one conducted workout without exercises or price, never self/planned/in-progress',async()=>{
    await mark();const id=await workout();await workout('done','self');await workout('planned');await workout('in_progress')
    expect((await stats())[0]!.data.count).toBe(1)
    await pool.query('update public.workouts set version=version+1 where id=$1',[id])
    expect((await stats())[0]!.data.count).toBe(1)
    expect((await stats(admin,other))[0]!.data.count).toBe(0)
    const data=(await stats())[0]!.data
    expect(data.records[0]).toEqual({id,date:today,trainerId:coach,trainerName:'Synthetic',status:'done'})
    expect(JSON.stringify(data)).not.toMatch(/Private synthetic|clientId|client_id|price|exercise|payment/)
  })
  it('captures the real planned-to-done transition once and recalculates format/date/deletion',async()=>{
    await pool.query('update public.clients set auth_user_id=$1 where id=$2',[athlete,card])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[card,coach,athlete])
    await mark();const id=await workout('planned','with_trainer',today,false)
    const operation=randomUUID(),version=(await pool.query<{version:string}>('select version from public.workouts where id=$1',[id])).rows[0]!.version
    const finish=()=>actor(coach,"select * from public.finish_live_workout($1,$2,$3,true,'unassigned',null)",[id,version,operation])
    await finish();expect((await finish())[0]!.replayed).toBe(true)
    expect((await stats())[0]!.data.count).toBe(1)
    await pool.query("update public.workouts set training_format='self' where id=$1",[id]);expect((await stats())[0]!.data.count).toBe(0)
    await pool.query("update public.workouts set training_format='with_trainer',workout_date=$2 where id=$1",[id,yesterday]);expect((await stats())[0]!.data.count).toBe(0)
    await pool.query('update public.workouts set workout_date=$2 where id=$1',[id,today]);expect((await stats())[0]!.data.count).toBe(1)
    await pool.query('update public.workouts set deleted_at=clock_timestamp() where id=$1',[id]);expect((await stats())[0]!.data.count).toBe(0)
  })
  it('preserves past eligibility after unmark/revoke/archive/reassignment and does not count new completions',async()=>{
    await mark();await workout();await mark(coach,card,false,1);await workout()
    expect((await stats())[0]!.data.count).toBe(1)
    await pool.query('update public.corporate_trainers set is_yandex=false where trainer_id=$1',[coach])
    await expect(mark(coach,card,true,2)).rejects.toMatchObject({code:'PT403'})
    await pool.query('update public.clients set auth_user_id=$1,archived_at=clock_timestamp() where id=$2',[athlete,card])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by)values($1,$2,$3)',[card,other,athlete])
    expect((await stats())[0]!.data.count).toBe(1)
    expect((await stats(admin,other))[0]!.data.count).toBe(0)
    await workout();expect((await stats())[0]!.data.count).toBe(1)
  })
  it('stops new facts on confirmation or personal-pilot revoke while retaining earlier facts',async()=>{
    await mark();await workout()
    await pool.query('update public.corporate_trainers set is_yandex=false where trainer_id=$1',[coach])
    await workout();expect((await stats())[0]!.data.count).toBe(1)
    await pool.query('update public.corporate_trainers set is_yandex=true where trainer_id=$1',[coach])
    await pool.query('update app_private.corporate_personal_pilot_trainers set enabled=false where profile_id=$1',[coach])
    await workout();expect((await stats())[0]!.data.count).toBe(1)
    await expect(mark(coach,card,false,1)).rejects.toMatchObject({code:'PT403'})
  })
  it('counts a client-authored with-trainer workout for the current eligible trainer without transferring older facts',async()=>{
    await pool.query('update public.clients set auth_user_id=$1 where id=$2',[athlete,card])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by)values($1,$2,$3)',[card,coach,athlete])
    await mark();await workout('done','with_trainer',today,true,athlete)
    expect((await stats())[0]!.data.count).toBe(1)
    await pool.query("update public.client_trainer_relationships set status='disconnected',disconnected_at=clock_timestamp(),disconnected_by=$2 where client_id=$1",[card,athlete])
    await pool.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by)values($1,$2,$3)',[card,other,athlete])
    expect((await stats(admin,coach))[0]!.data.count).toBe(1)
    expect((await stats(admin,other))[0]!.data.count).toBe(0)
  })
  it('uses trainer calendar date and never derives access from service or invitation pilot',async()=>{
    await pool.query("update public.profiles set timezone='Pacific/Kiritimati' where id=$1",[coach])
    const expected=(await pool.query<{date:string}>("select ((clock_timestamp() at time zone 'Pacific/Kiritimati')::date)::text date")).rows[0]!.date
    expect((await mark())[0]!.data.fromDate).toBe(expected)
    await pool.query('update app_private.corporate_personal_pilot_trainers set enabled=false where profile_id=$1',[coach])
    await pool.query('insert into app_private.corporate_service_pilot_trainers(profile_id,enabled)values($1,true)',[coach])
    expect(await actor(coach,'select app_private.corporate_personal_allowed() allowed')).toEqual([{allowed:false}])
  })
  it('keeps financial rows unchanged when marking/unmarking and paginates detail without losing totals',async()=>{
    const old=await workout();const before=(await pool.query('select to_jsonb(s) data from public.trainer_finance_sessions s where workout_id=$1',[old])).rows
    await mark();await mark(coach,card,false,1)
    expect((await pool.query('select to_jsonb(s) data from public.trainer_finance_sessions s where workout_id=$1',[old])).rows).toEqual(before)
    await mark(coach,card,true,2)
    for(let n=0;n<51;n++)await workout()
    const a=(await stats())[0]!.data;expect(a.count).toBe(51);expect(a.records).toHaveLength(50);expect(a.nextCursor).not.toBeNull()
    const b=(await stats(admin,null,a.nextCursor))[0]!.data;expect(b.count).toBe(51);expect(b.records).toHaveLength(1)
    expect(new Set([...a.records,...b.records].map(x=>x.id)).size).toBe(51)
  })
  it('does not allow down migration to discard recorded history',async()=>{
    await mark()
    const {readFileSync}=await import('node:fs')
    const down=readFileSync(new URL('../../db/migrations/000197_corporate_personal_training.sql',import.meta.url),'utf8').split('-- Down Migration')[1]!
    await expect(pool.query(down)).rejects.toMatchObject({message:'corporate_personal_history_in_use'})
    expect((await read())[0]!.data.marked).toBe(true)
  })
})
