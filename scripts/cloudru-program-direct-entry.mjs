import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {assertOutsideActions,validateDirectRequest} from './cloudru-program-direct-protocol.mjs'
import {prepareCloudruUpload,loadCloudruUpload,cleanupCloudruUpload} from './cloudru-journal-upload.mjs'
import {executeProgramHistoryWrite} from './cloudru-program-history-write.mjs'
import {executeProgramHistoryInspection} from './cloudru-program-history-inspect.mjs'

export async function executeDirectEntry(request,{main,operatorPublicPem,
  prepare=prepareCloudruUpload,load=loadCloudruUpload,cleanup=cleanupCloudruUpload,
  write=executeProgramHistoryWrite,inspect=executeProgramHistoryInspection,env=process.env}={}) {
  assertOutsideActions(env)
  const r=validateDirectRequest(request,main)
  env.FIT_JOURNAL_IMPORT_MODE=r.mode
  env.FIT_JOURNAL_IMPORT_SHA256=r.digest
  env.FIT_JOURNAL_UPLOAD_SESSION=r.session
  env.FIT_JOURNAL_ATTEMPT=r.attempt
  if(r.mode==='prepare')return prepare(r.target,r.digest,r.session,operatorPublicPem)
  if(r.mode==='cleanup')return cleanup(r.target,r.digest,r.session)
  const upload=await load(r.target,r.digest,r.session,{recoveryReadOnly:r.mode==='verify'})
  const args={mode:r.mode,target:r.target,trainerEvidence:r.trainerEvidence,upload}
  return r.stage==='review'?inspect(args):write(args)
}
async function main() {
  assertOutsideActions()
  if(process.getuid()!==0)throw Error('program_direct_rejected')
  // This pipe belongs to the Cloud.ru system service, never an Actions step.
  const raw=readFileSync(0)
  if(raw.length>16384)throw Error('program_direct_rejected')
  const result=await executeDirectEntry(JSON.parse(raw),{
    main:process.env.FIT_DIRECT_MAIN,operatorPublicPem:readFileSync('/direct/operator.public.pem','utf8')})
  process.stdout.write(JSON.stringify(result))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  process.stderr.write('{"event":"direct_operation_failed"}\n');process.exitCode=1
})
