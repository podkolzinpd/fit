// Transactional replacement of the disposable standby, with its own saved dump.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const {Client}=createRequire('/app/package.json')('pg');
const c=JSON.parse(readFileSync('/copy/target.json','utf8'));
if(c.folder!=='b1gt7dfqg9sht9slnno5'||c.db_id!=='c9q5ic9v0500c217e71n')throw Error('target_rejected');
const root='/copy/cutover-20261128/';
const env={...process.env,PGPASSWORD:process.env.MIGRATION_DATABASE_PASSWORD,PGSSLMODE:'verify-full',PGSSLROOTCERT:'/app/certs/yandex-cloud-ca.pem'};
const connection=['--host='+c.db_host,'--port=6432','--username=fit_owner','--dbname=fit'];
function run(command,args){const r=spawnSync(command,args,{env,encoding:'utf8',maxBuffer:4*1024*1024});if(r.status!==0){writeFileSync(root+'restore-private-error.txt',r.stderr??'',{mode:0o600});throw Error(command+'_failed');}return r.stdout;}
try{
 if(!existsSync(root+'standby-before.dump'))run('pg_dump',[...connection,'--format=custom','--file='+root+'standby-before.dump']);
 const db=new Client({host:c.db_host,port:6432,database:'fit',user:'fit_owner',password:env.PGPASSWORD,ssl:{ca:readFileSync(env.PGSSLROOTCERT,'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:10000});
 try{await db.connect();await db.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and usename in ('fit_api','fit_datalens') and pid<>pg_backend_pid()");}finally{await db.end();}
 const list=run('pg_restore',['--list','/copy/source.dump']).split('\n').map(line=>((line.includes(' EXTENSION ')||line.includes(' COMMENT - EXTENSION '))&&!line.startsWith(';')?';'+line:line)).join('\n');
 writeFileSync(root+'restore.list',list,{mode:0o600});
 run('pg_restore',[...connection,'--clean','--if-exists','--single-transaction','--exit-on-error','--no-owner','--use-list='+root+'restore.list','/copy/source.dump']);
 console.log(JSON.stringify({event:'cutover_database_restored_atomically',previousStandbyBackupSaved:true}));
}catch(e){console.log(JSON.stringify({event:'cutover_restore_failed',stage:['pg_dump_failed','pg_restore_failed'].includes(e.message)?e.message:'database'}));process.exitCode=1;}
