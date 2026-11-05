import {createHash,timingSafeEqual} from 'node:crypto'
import {resolveJournalTrainer} from './cloudru-journal-import.mjs'
import {readRosterTargets,rosterOwnerQuery,readRetainedLoginBindings} from './cloudru-account-links-audit.mjs'

const digest=/^[a-f0-9]{64}$/u
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const fail=code=>{throw Error(`program_trainer_evidence_${code}`)}
function validate(value,target) {
  if(!value||!['rosterNameHashes,targetBinding,version','programAlias,rosterNameHashes,targetBinding,version'].includes(Object.keys(value).sort().join(','))
    ||value.version!==1||!digest.test(value.targetBinding??'')
    ||![target?.trainerEmailSha256,target?.trainerLoginSha256,target?.clientNameSha256].every(h=>digest.test(h??'')))fail('invalid')
  try {readRosterTargets({rosterNameHashes:value.rosterNameHashes})} catch {fail('invalid')}
  // This evidence belongs only to the reviewed seventeen-source operation.
  if(value.rosterNameHashes.length!==17)fail('invalid')
  if(value.programAlias!==undefined) {
    const a=value.programAlias
    if(!a||Object.keys(a).sort().join(',')!=='code,rosterNameSha256,sourceNameSha256'||a.code!=='F13'
      ||![a.sourceNameSha256,a.rosterNameSha256].every(h=>digest.test(h??''))
      ||a.sourceNameSha256===a.rosterNameSha256||!value.rosterNameHashes.includes(a.rosterNameSha256))fail('invalid')
  }
  const binding=createHash('sha256').update(JSON.stringify([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])).digest()
  if(!timingSafeEqual(binding,Buffer.from(value.targetBinding,'hex')))fail('target_mismatch')
  return value
}

// Separate private input: never extend the original session-bound target or
// accept a profile ID, actor override, SQL text or an unreviewed fallback.
export function readProgramTrainerEvidence(raw,target) {
  if(raw===undefined||raw==='')return null
  if(typeof raw!=='string'||raw.length>4096)fail('invalid')
  let value
  try {value=JSON.parse(raw)} catch {fail('invalid')}
  return validate(value,target)
}

// A separately reviewed source/screenshot spelling difference never edits the
// SHA-approved packet. It can name only F13 and one member of the full roster.
export function programMatchNameHash(evidence,payload) {
  const alias=evidence?.programAlias
  if(!alias||payload.code!==alias.code)return null
  const name=payload.clientName.toLowerCase().replaceAll('ё','е').trim().replace(/\s+/gu,' ')
  if(createHash('sha256').update(name).digest('hex')!==alias.sourceNameSha256)fail('alias_source_mismatch')
  return alias.rosterNameSha256
}

export async function resolveProgramTrainer(owner,target,legacyId=null,evidence=null) {
  if(evidence===null)return resolveJournalTrainer(owner,target,legacyId)
  validate(evidence,target)
  if(legacyId!==null&&!uuid.test(legacyId))fail('invalid')
  await owner.query('begin transaction isolation level repeatable read read only')
  try {
    await owner.query("set local statement_timeout='10s'")
    await owner.query("set local lock_timeout='2s'")
    const state=(await owner.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
    if(state?.username!=='fit_owner'||state.readonly!=='on')fail('readonly_required')
    const rows=(await owner.query(rosterOwnerQuery,[evidence.rosterNameHashes,17])).rows
    if(rows.length!==1)fail('trainer_ambiguous')
    const row=rows[0]
    if(!uuid.test(row.trainer_id??'')||row.account_role!=='trainer'||row.yandex_linked!==true
      ||row.matched_names!==17||row.matched_cards!==17||row.ambiguous_names!==0
      ||!Number.isInteger(row.active_clients)||row.active_clients<17||row.active_clients>1000
      ||!Array.isArray(row.matched_ordinals)||row.matched_ordinals.length!==17
      ||new Set(row.matched_ordinals).size!==17||row.matched_ordinals.some(n=>!Number.isInteger(n)||n<1||n>17))fail('roster_changed')
    const {tables,bindings}=await readRetainedLoginBindings(owner,[target.trainerEmailSha256,target.trainerLoginSha256])
    if((legacyId!==null&&legacyId!==row.trainer_id)||bindings.some(b=>b.profile_id!==row.trainer_id))fail('sources_disagree')
    await owner.query('commit')
    return {trainerId:row.trainer_id,retainedLoginBinding:bindings.length>0,yandexIdentityLinked:true,
      identityEvidence:{method:'current_roster',targetNames:17,matchedCards:17,activeClients:row.active_clients,
        retainedSourcesChecked:tables.length,legacyRegistryMatched:legacyId!==null,sourcesAgree:true}}
  } catch(error){await owner.query('rollback');throw error}
}
