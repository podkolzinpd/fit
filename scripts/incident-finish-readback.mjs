import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { buildDatabaseConnectionConfig } from '/app/dist/db/connection-config.js'
const target=JSON.parse(readFileSync(0,'utf8'))
if(!/^[a-f0-9-]{36}$/.test(target.workoutId??'')) throw Error('invalid reviewed target')
const db=new Client({...buildDatabaseConnectionConfig('MIGRATION_DATABASE'),connectionTimeoutMillis:5000,query_timeout:10000})
try{
 await db.connect(); await db.query('begin read only'); await db.query("set local statement_timeout='5s'")
 const guard=await db.query("select current_user='fit_owner' as owner,current_setting('transaction_read_only')='on' as readonly")
 if(!guard.rows[0]?.owner||!guard.rows[0]?.readonly) throw Error('readonly guard failed')
 const result=await db.query(`select
  w.status='done' as completed,
  w.workout_date=date '2026-11-11' as workout_date_matches,
  count(distinct s.id)::integer as active_finance_sessions,
  count(distinct p.id) filter(where p.single_session)::integer as active_single_packages,
  coalesce(bool_or(p.single_session and p.price_cents=370000),false) as screenshot_price_matches,
  coalesce(bool_or(pay.amount_cents=370000 and pay.received_on=date '2026-11-11'),false) as screenshot_payment_matches,
  count(distinct pay.id)::integer as active_payments
 from public.workouts w
 left join public.trainer_finance_sessions s on s.workout_id=w.id and s.voided_at is null
 left join public.trainer_finance_packages p on p.id=s.package_id
 left join public.trainer_finance_payments pay on pay.package_id=p.id and pay.voided_at is null
 where w.id=$1 group by w.id,w.status,w.workout_date`,[target.workoutId])
 await db.query('rollback')
 console.log(JSON.stringify({event:'reviewed_finish_readback',matchedWorkout:result.rows.length===1,checks:result.rows[0]??null}))
}catch(error){console.log(JSON.stringify({event:'reviewed_finish_readback',failed:true,code:/^[A-Z0-9_]{2,40}$/.test(error.code??'')?error.code:'unknown'}));process.exitCode=1}
finally{await db.end()}
