import os,subprocess,pathlib,json,time,urllib.request,secrets,signal
root=pathlib.Path(__file__).resolve().parent
source=root/'source'
cfg={k:v for k,v in os.environ.items() if k in ['PATH','HOME','TMPDIR','LANG','LC_ALL','SHELL','USER','LOGNAME','GH_TOKEN','GITHUB_REPOSITORY']}
name=f'fit_frontend_e2e_{os.getpid()}_{secrets.token_hex(6)}'
cfg.update({'FIT_AUDIT_RPC_SCRIPT':str(root/'model-rpc.py'),'FIT_AUDIT_RPC_ERROR_FILE':str(root/'rpc-errors.jsonl'),'FIT_AUDIT_DATABASE_NAME':name,'FIT_E2E_FRONTEND_URL':'http://127.0.0.1:18479','FIT_E2E_POSTGRES_URL':'postgresql://postgres:postgres@127.0.0.1:5432/postgres'})
(root/'owned-database.json').write_text(json.dumps({'databaseName':name,'generatedBeforeLaunch':True,'purpose':'program audit synthetic disposable fixture'},indent=2)+'\n')
api=None;front=None
try:
 api=subprocess.Popen(['node',str(root/'program-api-audit-harness.mjs')],cwd=root,env=cfg,stdout=subprocess.PIPE,stderr=(root/'api-stderr.log').open('w'),text=True)
 while True:
  line=api.stdout.readline()
  if not line:raise RuntimeError('audit API exited before ready')
  if line.startswith('{"event":"native_fixture_ready"'):
   origin=json.loads(line)['origin'];break
 print('native audit API ready; disposable database recorded',flush=True)
 cfg.update({'FIT_AUDIT_API_ORIGIN':origin,'VITE_YANDEX_API_BASE_URL':origin,'VITE_YANDEX_OAUTH_CLIENT_ID':'fixture-client-id','VITE_YANDEX_APP_SESSION_ENABLED':'true','VITE_YANDEX_MAIN_ROUTING_ENABLED':'true','VITE_YANDEX_ONLY_AUTH_ENABLED':'true','VITE_YANDEX_NATIVE_REGISTRATION_ENABLED':'true','VITE_ASSISTANT_NAV_ENABLED':'true','VITE_ASSISTANT_NAV_PILOT_USER_IDS':'90000000-0000-4000-8000-000000000009,92000000-0000-4000-8000-000000000029','VITE_ASSISTANT_PROGRAM_ENABLED':'true'})
 front=subprocess.Popen(['node','node_modules/vite/bin/vite.js','--mode','native-e2e','--host','127.0.0.1','--port','18479'],cwd=source,env=cfg,stdout=(root/'frontend.log').open('w'),stderr=subprocess.STDOUT)
 for attempt in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:18479/auth',timeout=2) as response:
    if response.status==200:break
  except Exception:time.sleep(.5)
 else:raise RuntimeError('audit frontend did not become ready')
 print('running one native program browser scenario',flush=True)
 r=subprocess.run(['node','source/node_modules/playwright/cli.js','test','--config','audit-playwright.config.mjs'],cwd=root,env=cfg,stdout=(root/'playwright-stdout.log').open('w'),stderr=(root/'playwright-stderr.log').open('w'))
 print('browser exit',r.returncode,flush=True)
 if (root/'program-playwright.json').exists():
  d=json.loads((root/'program-playwright.json').read_text());print(d.get('stats'),flush=True)
  for suite in d.get('suites',[]):
   for spec in suite.get('specs',[]):
    for test in spec.get('tests',[]):
     for result in test.get('results',[]):
      if result.get('error'):print(result['error'].get('message','')[:2800],flush=True)
finally:
 if front and front.poll() is None:front.terminate();front.wait(timeout=20)
 if api and api.poll() is None:api.terminate();api.wait(timeout=45)
 script="""import {createRequire} from 'node:module';const require=createRequire(new URL('./source/services/api/package.json',import.meta.url));const {Pool}=require('pg');const p=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:5432/postgres'});try{const r=await p.query('select datname from pg_database where datname=$1',[process.env.FIT_AUDIT_DATABASE_NAME]);console.log(JSON.stringify({databaseName:process.env.FIT_AUDIT_DATABASE_NAME,remaining:r.rows.length}));}finally{await p.end()}"""
 check=subprocess.run(['node','--input-type=module','-e',script],cwd=root,env=cfg,capture_output=True,text=True)
 (root/'cleanup-readback.json').write_text(check.stdout)
 print('cleanup',check.stdout.strip(),flush=True)
 if check.returncode:print('cleanup readback failed',flush=True)

if r.returncode:raise SystemExit(r.returncode)
