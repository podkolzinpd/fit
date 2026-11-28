import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
const {Client}=createRequire('/app/package.json')('pg');
const manifest=JSON.parse(await readFile('/copy/source-manifest.json','utf8'));
const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE');
if(config?.host!=='rc1a-ps1pjrrchshmr1nd.mdb.yandexcloud.net'||config.database!=='fit'||config.user!=='fit_owner') throw Error('target_rejected');
const client=new Client({...config,connectionTimeoutMillis:10000,query_timeout:30000});
try{
 await client.connect();await client.query('begin isolation level repeatable read read only');await client.query("set local timezone='UTC'");
 let rows=0;const hashes=[];
 const quote=x=>'"'+x.replaceAll('"','""')+'"';
 for(const table of manifest.tables){
  const result=(await client.query(`select count(*)::text n,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' order by row_to_json(t)::text collate "C"),'')) digest from ${quote(table.schemaname)}.${quote(table.tablename)} t`)).rows[0];
  if(result.n!==table.rows||result.digest!==table.digest) throw Error('table_mismatch');
  rows+=Number(result.n);hashes.push(table.schemaname+'.'+table.tablename+':'+result.digest);
 }
 const security=(await client.query("select c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','workouts','workout_sets') order by 1")).rows;
 if(security.length!==3||security.some(x=>!x.relrowsecurity||x.owner!=='fit_owner')) throw Error('security_mismatch');
 const grants=(await client.query("select has_table_privilege('fit_api','public.workouts','select') can_read,has_table_privilege('fit_api','public.workouts','update') can_update")).rows[0];
 // Source migration 000008 deliberately denies direct UPDATE; mutations use secured RPCs.
 if(!grants.can_read||grants.can_update) throw Error('grants_mismatch');
 await client.query('rollback');
 console.log(JSON.stringify({event:'database_copy_verified',tables:manifest.tables.length,rows,sha256:createHash('sha256').update(hashes.join('\n')).digest('hex'),rlsTables:security,grants}));
}catch(e){console.log(JSON.stringify({event:'database_copy_verification_failed',code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:'unknown',stage:['table_mismatch','security_mismatch','grants_mismatch'].includes(e.message)?e.message:'query'}));process.exitCode=1;}
finally{await client.end();}
