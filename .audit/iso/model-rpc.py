import sys,json,subprocess,base64,time,pathlib,hashlib
root=pathlib.Path(__file__).resolve().parent
request=json.load(sys.stdin)
request['functionName']='trainer-audit'
request['operationId']='trainer-audit-'+str(time.time_ns())
request={k:v for k,v in request.items() if k in ['instruction','data','schema','maxTokens','functionName','operationId']}
b=json.dumps(request,ensure_ascii=False,separators=(',',':')).encode()
if len(base64.b64encode(b))>60000:
 (root/'rpc-oversize.json').write_text(json.dumps({'inputBytes':len(b),'base64Bytes':len(base64.b64encode(b)),'maxTokens':request.get('maxTokens')}));raise RuntimeError('audit_request_too_large')
run=lambda args,**kw:subprocess.run(['gh',*args],capture_output=True,text=True,check=True,**kw)
query=['run','list','--repo','podkolzinpd/fit','--workflow','configure-cloudru-ai.yml','--branch','audit/trainer-real-generator-20261107','--limit','20','--json','databaseId,status,conclusion']
old={r['databaseId'] for r in json.loads(run(query).stdout)}
started=time.time();run(['workflow','run','configure-cloudru-ai.yml','--repo','podkolzinpd/fit','--ref','audit/trainer-real-generator-20261107','--json'],input=json.dumps({'request_base64':base64.b64encode(b).decode()}))
runid=None
for i in range(60):
 rows=json.loads(run(query).stdout)
 candidates=[r for r in rows if r['databaseId'] not in old]
 if candidates:
  if len(candidates)!=1:raise RuntimeError('ambiguous_audit_run')
  row=candidates[0];runid=row['databaseId']
  if row['status']=='completed':break
 time.sleep(10)
else:raise RuntimeError('audit_action_timeout')
dest=root/'model-runs'/str(runid);dest.mkdir(parents=True,exist_ok=False)
for delivery in range(4):
 try:
  run(['run','download',str(runid),'--repo','podkolzinpd/fit','-n','trainer-model-result-'+str(runid),'-D',str(dest)])
  break
 except subprocess.CalledProcessError as error:
  import re
  safe=re.sub(r'https?://[^\s]+','<url omitted>',error.stderr or '')[:500]
  with (root/'artifact-delivery.jsonl').open('a') as f:f.write(json.dumps({'runId':runid,'attempt':delivery+1,'error':safe})+'\n')
  if delivery==3:raise
  time.sleep(5)

result=json.loads((dest/'trainer-model-result.json').read_text())
record={'runId':runid,'operationId':request['operationId'],'functionName':'trainer-audit','requestHash':hashlib.sha256(b).hexdigest(),'resultHash':hashlib.sha256((dest/'trainer-model-result.json').read_bytes()).hexdigest(),'workflowConclusion':row['conclusion'],'transportMs':round((time.time()-started)*1000),'ok':result.get('ok'),'metric':result.get('metric'),'durationMs':result.get('durationMs')}
with (root/'model-rpc-events.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
(dest/'request.json').write_bytes(b)
if not result.get('ok'):raise RuntimeError('real_model_failure:'+str(result.get('error')))
print(json.dumps(result))
