// Executed only inside the existing source image with protected owner credentials.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
const {Client}=createRequire('/app/package.json')('pg');
const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE');
if(config?.host!=='10.70.10.67'||config.user!=='fit_owner'||config.database!=='fit') throw Error('source_rejected');
const client=new Client({...config,connectionTimeoutMillis:5000,query_timeout:30000});
try {
  await client.connect();
  await client.query('begin isolation level repeatable read read only');
  const snapshot=(await client.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
  const tables=(await client.query("select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname<>'information_schema' order by 1,2")).rows;
  const quote=x=>'"'+x.replaceAll('"','""')+'"';
  await client.query("set local timezone='UTC'");
  for(const table of tables){
    const result=(await client.query(`select count(*)::text n,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' order by row_to_json(t)::text collate "C"),'')) digest from ${quote(table.schemaname)}.${quote(table.tablename)} t`)).rows[0];
    table.rows=result.n;table.digest=result.digest;
  }
  const roles=(await client.query("select rolname from pg_roles where rolname like 'fit_%' order by 1")).rows;
  const manifest={snapshot,at:new Date().toISOString(),tables,roles};
  await writeFile('/copy/source-manifest.json',JSON.stringify(manifest),{mode:0o600});
  const args=['--format=custom','--snapshot='+snapshot,'--host='+config.host,'--port='+config.port,'--username='+config.user,'--dbname='+config.database,'--file=/copy/source.dump'];
  const dump=spawn('pg_dump',args,{env:{...process.env,PGPASSWORD:config.password,PGSSLMODE:'require'},stdio:['ignore','ignore','pipe']});
  dump.stderr.resume();
  const code=await new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('close',resolve);});
  if(code!==0) throw Error('dump_failed');
  await client.query('rollback');
  console.log(JSON.stringify({event:'consistent_database_snapshot_exported',tables:tables.length,rows:tables.reduce((n,t)=>n+Number(t.rows),0),roles:roles.map(r=>r.rolname)}));
}catch(e){console.log(JSON.stringify({event:'database_copy_export_failed',code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:'unknown',stage:['dump_failed','source_rejected'].includes(e.message)?e.message:'query'}));process.exitCode=1;}
finally{await client.end();}
