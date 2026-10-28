import {createCipheriv,createDecipheriv,createHash,createPublicKey,createPrivateKey,generateKeyPairSync,randomBytes,publicEncrypt,privateDecrypt,constants} from 'node:crypto'
import {readFileSync,writeFileSync,chmodSync,lstatSync,unlinkSync,readdirSync,fsyncSync,openSync,closeSync} from 'node:fs'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {planMediaAclReadRepair} from './repair-cloudru-media-acl.mjs'

const bucket='fit-cloudru-stage-media-c2ad3760',tenant='f071c7d5-cf0f-4538-9415-bbf9a9c94338'
export const uploadBytes=131072
const fail=()=>{throw new Error('journal_upload_rejected')}
export function journalSession(value) {
 if(typeof value!=='string'||!/^\d{1,20}-\d{1,4}$/.test(value))fail()
 return value
}
export function journalObject(session,name) {
 journalSession(session)
 if(!['payload','prepared','committed','readback'].includes(name))fail()
 return `operations/private-journal-import/${session}/${name}.encrypted.json`
}
const context=session=>Buffer.from(`fit-cloudru-private-journal-v1:${journalSession(session)}`)
export function sealUpload(value,publicPem,session) {
 if(typeof publicPem!=='string'||publicPem.length>8192||!publicPem.startsWith('-----BEGIN PUBLIC KEY-----\n')||publicPem.includes('PRIVATE KEY'))fail()
 const keyObject=createPublicKey(publicPem)
 if(keyObject.asymmetricKeyType!=='rsa'||keyObject.asymmetricKeyDetails.modulusLength<3072)fail()
 const plain=Buffer.from(JSON.stringify(value))
 if(plain.length>2*1024*1024)fail()
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(context(session))
 const data=Buffer.concat([cipher.update(plain),cipher.final()])
 return {version:1,session,wrappedKey:publicEncrypt({key:keyObject,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}
}
export function openUpload(envelope,privatePem,session) {
 if(!envelope||envelope.version!==1||envelope.session!==journalSession(session))fail()
 const fields=[envelope.wrappedKey,envelope.iv,envelope.tag,envelope.data]
 if(fields.some(s=>typeof s!=='string'||s.length>3*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(s)))fail()
 const key=privateDecrypt({key:createPrivateKey(privatePem),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.wrappedKey,'base64'))
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'))
 decipher.setAAD(context(session));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'))
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'))
}
export function validateUploadCapability(cap,session,digest,now=Date.now()) {
 if(!cap||cap.session!==journalSession(session)||cap.digest!==digest||!/^[a-f0-9]{64}$/.test(digest??'')
  ||!Number.isSafeInteger(cap.expiresAt)||cap.expiresAt<=now||cap.expiresAt>now+11*60*1000||cap.bytes!==uploadBytes)fail()
 const url=new URL(cap.url)
 if(url.protocol!=='https:'||url.hostname!=='s3.cloud.ru'||url.port||url.username||url.password||url.hash
  ||decodeURIComponent(url.pathname)!==`/${bucket}/${journalObject(session,'payload')}`
  ||url.searchParams.get('X-Amz-Expires')!=='600'||url.searchParams.get('X-Amz-Algorithm')!=='AWS4-HMAC-SHA256'
  ||url.searchParams.get('X-Amz-SignedHeaders')!=='content-length;host;if-none-match'
  ||!/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature')??''))fail()
 return cap
}
function durableFile(path,body) {
 writeFileSync(path,body,{mode:0o600,flag:'wx'})
 const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
 const dir=openSync('/session','r');try{fsyncSync(dir)}finally{closeSync(dir)}
}
const digestTarget=target=>createHash('sha256').update(JSON.stringify([
 target.trainerLoginSha256,target.trainerEmailSha256,target.clientNameSha256])).digest('hex')
async function storage() {
 const env=process.env,keyId=env.CLOUDRU_MEDIA_KEY_ID,secretAccessKey=env.CLOUDRU_MEDIA_KEY_SECRET
 if(!keyId||!secretAccessKey||keyId.includes(':')||/[\r\n]/.test(keyId+secretAccessKey))fail()
 const requireApi=createRequire('/app/package.json'),sdk=requireApi('@aws-sdk/client-s3')
 const {getSignedUrl}=requireApi('@aws-sdk/s3-request-presigner')
 const client=new sdk.S3Client({endpoint:'https://s3.cloud.ru',forcePathStyle:true,region:'ru-central-1',maxAttempts:2,requestChecksumCalculation:'WHEN_REQUIRED',
  requestHandler:{connectionTimeout:5000,requestTimeout:15000},credentials:{accessKeyId:`${tenant}:${keyId}`,secretAccessKey}})
 try {
  try{await client.send(new sdk.GetBucketPolicyCommand({Bucket:bucket}));fail()}catch(e){if(e?.name!=='NoSuchBucketPolicy')throw e}
  planMediaAclReadRepair(await client.send(new sdk.GetBucketAclCommand({Bucket:bucket}))) // read only: never apply ACL repair
 }catch(e){client.destroy();throw e}
 return {client,sdk,getSignedUrl}
}
function sessionDirectory() {
 const s=lstatSync('/session')
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o700)fail()
}
function readManifest(target,digest,session,{allowExpired=false}={}) {
 sessionDirectory()
 for(const name of ['manifest.json','server.private.pem']) {
  const f=lstatSync(`/session/${name}`)
  if(!f.isFile()||f.isSymbolicLink()||f.uid!==0||(f.mode&0o777)!==0o600||f.size>12000)fail()
 }
 const m=JSON.parse(readFileSync('/session/manifest.json','utf8'))
 if(m.session!==session||m.digest!==digest||m.target!==digestTarget(target)||!Number.isSafeInteger(m.expiresAt)
  ||(!allowExpired&&m.expiresAt<Date.now()))fail()
 return m
}
function capability(value,key,session) {
 // GitHub receives only a short-lived, encrypted single-object capability. Never journal/receipt bytes.
 writeFileSync('/capability/capability.encrypted.json',JSON.stringify(sealUpload(value,key,session)),{mode:0o644,flag:'wx'})
 chmodSync('/capability/capability.encrypted.json',0o644) // independent of a restrictive process umask; ciphertext metadata only
}
export async function prepareCloudruUpload(target,digest,session,operatorPublicPem) {
 journalSession(session);if(!/^[a-f0-9]{64}$/.test(digest??''))fail()
 sealUpload({validation:true},operatorPublicPem,session)
 sessionDirectory()
 const {client,sdk,getSignedUrl}=await storage()
 try {
  const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const manifest={version:1,session,digest,target:digestTarget(target),operatorPublicPem,expiresAt:Date.now()+2*60*60*1000}
  durableFile('/session/server.private.pem',keys.privateKey)
  durableFile('/session/manifest.json',JSON.stringify(manifest))
  const url=await getSignedUrl(client,new sdk.PutObjectCommand({Bucket:bucket,Key:journalObject(session,'payload'),
   ContentType:'application/octet-stream',ContentLength:uploadBytes,IfNoneMatch:'*'}),{expiresIn:600})
  capability({session,digest,url,bytes:uploadBytes,publicKey:keys.publicKey,expiresAt:Date.now()+600000},operatorPublicPem,session)
  return {status:'upload_prepared'}
 }finally{client.destroy()}
}
export async function loadCloudruUpload(target,digest,session) {
 journalSession(process.env.FIT_JOURNAL_ATTEMPT)
 const manifest=readManifest(target,digest,journalSession(session)),{client,sdk,getSignedUrl}=await storage()
 try {
  const object=await client.send(new sdk.GetObjectCommand({Bucket:bucket,Key:journalObject(session,'payload')}))
  if(object.ContentLength!==uploadBytes)fail()
  let size=0;const chunks=[]
  for await(const chunk of object.Body){size+=chunk.length;if(size>uploadBytes)fail();chunks.push(chunk)}
  if(size!==uploadBytes)fail()
  const plain=openUpload(JSON.parse(Buffer.concat(chunks).toString('utf8')),readFileSync('/session/server.private.pem','utf8'),session)
  if(plain.session!==session||plain.digest!==digest||!Array.isArray(plain.parts)||plain.parts.length!==2)fail()
  return {parts:plain.parts,publicPem:manifest.operatorPublicPem,
   persistReceipt:async(state,receipt,sealReceipt)=>{
    const key=journalObject(session,state),bytes=JSON.stringify(sealReceipt({...receipt,state},manifest.operatorPublicPem))
    // Both primary-provider disk and S3 must hold the receipt before a database commit.
    durableFile(`/session/${state}-${process.env.FIT_JOURNAL_ATTEMPT}.encrypted.json`,bytes)
    await client.send(new sdk.PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'application/octet-stream'}))
    if(state==='readback') {
     const url=await getSignedUrl(client,new sdk.GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:600})
     capability({session,digest,url,kind:'readback',expiresAt:Date.now()+600000},manifest.operatorPublicPem,session)
    }
   },close:()=>client.destroy()}
 }catch(e){client.destroy();throw e}
}
export async function cleanupCloudruUpload(target,digest,session) {
 readManifest(target,digest,journalSession(session),{allowExpired:true})
 const {client,sdk}=await storage()
 try {
  // Cleanup is an explicit post-readback action; never run on a failed/uncertain import.
  await client.send(new sdk.HeadObjectCommand({Bucket:bucket,Key:journalObject(session,'readback')}))
  for(const name of ['payload','prepared','committed','readback'])await client.send(new sdk.DeleteObjectCommand({Bucket:bucket,Key:journalObject(session,name)}))
  for(const file of readdirSync('/session')) {
   if(!['manifest.json','server.private.pem'].includes(file)&&! /^(prepared|committed|readback)-\d{1,20}-\d{1,4}\.encrypted\.json$/.test(file))fail()
  }
  for(const file of readdirSync('/session'))unlinkSync(`/session/${file}`)
  return {status:'temporary_upload_removed'}
 }finally{client.destroy()}
}
async function main() {
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit')fail()
 const {readWorkoutHistoryTarget}=await import('./cloudru-account-history-audit.mjs')
 const target=readWorkoutHistoryTarget(process.env.FIT_WORKOUT_HISTORY_TARGET),digest=process.env.FIT_JOURNAL_IMPORT_SHA256
 const session=journalSession(process.env.FIT_JOURNAL_UPLOAD_SESSION),mode=process.env.FIT_JOURNAL_IMPORT_MODE
 const result=mode==='prepare'?await prepareCloudruUpload(target,digest,session,Buffer.from(process.env.FIT_JOURNAL_RECEIPT_PUBLIC_KEY_B64??'','base64').toString('utf8'))
  :mode==='cleanup'?await cleanupCloudruUpload(target,digest,session):fail()
 console.log(JSON.stringify({event:'private_journal_upload',...result}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
 console.error(JSON.stringify({event:'private_journal_upload_failed',code:'upload_rejected'}));process.exitCode=1
})
