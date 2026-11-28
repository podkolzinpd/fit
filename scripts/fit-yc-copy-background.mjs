// Same dispatch/session cleanup implementation; the boundary identifies the new DB.
import {BackgroundDispatcher} from '/app/dist/background-dispatcher.js';
import {backgroundDispatchDiagnostics} from '/app/dist/background-dispatch-error.js';
import {DirectPushNotificationSender} from '/app/dist/push-notifications/direct-sender.js';
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
import {PgDatabasePool} from '/app/dist/db/pg-pool.js';
import {PushDispatcher} from '/app/dist/push-dispatcher.js';
import {DatabaseSessionCleanup} from '/app/dist/session-cleanup.js';
if(process.env.DATABASE_HOST!=='rc1a-ps1pjrrchshmr1nd.mdb.yandexcloud.net'||process.env.DATABASE_PORT!=='6432'||process.env.DATABASE_NAME!=='fit'||process.env.DATABASE_USER!=='fit_api'||process.env.FIT_MEDIA_STORAGE_PROVIDER!=='yandex') throw Error('copy_background_target_rejected');
const config=buildDatabaseConnectionConfig('DATABASE');
const {VAPID_PUBLIC_KEY:publicKey,VAPID_PRIVATE_KEY:privateKey,VAPID_SUBJECT:subject}=process.env;
if(!config||!publicKey||!privateKey||!subject) throw Error('copy_background_config_missing');
const pool=new PgDatabasePool({...config,max:1,query_timeout:10000},'dispatcher');
try{
 const dispatcher=new BackgroundDispatcher(new PushDispatcher(pool,new DirectPushNotificationSender({publicKey,privateKey,subject})),undefined,new DatabaseSessionCleanup(pool));
 const result=await dispatcher.run();
 console.log(JSON.stringify({event:'copy_background_completed',...result}));
 if(result.sessionCleanup.status==='failed') throw Error('copy_session_cleanup_failed');
}catch(e){console.log(JSON.stringify({event:'copy_background_failed',...backgroundDispatchDiagnostics(e)}));process.exitCode=1;}
finally{await pool.end();}
