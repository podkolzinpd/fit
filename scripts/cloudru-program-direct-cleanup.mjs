import {lstatSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {createPublicKey} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {hostname} from 'node:os'
import {pathToFileURL} from 'node:url'

const reject=()=>{throw Error('prechannel_cleanup_rejected')}
const stat=path=>{try{return lstatSync(path)}catch(e){if(e.code==='ENOENT')return null;throw e}}
export function prechannelCleanup({parent,uid,sessions,publicKey,unitStatus}) {
  if(!Array.isArray(sessions)||sessions.length<1||sessions.length>2||new Set(sessions).size!==sessions.length
    ||sessions.some(s=>typeof s!=='string'||! /^[0-9]{1,20}-[0-9]{1,4}$/u.test(s)))reject()
  if(typeof publicKey!=='string'||publicKey.length>8192||!publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))reject()
  const key=createPublicKey(publicKey)
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072)reject()
  const directory=path=>{const s=stat(path);if(!s?.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o777)!==0o700)reject();return s}
  directory(parent)
  const roots=[]
  // Validate every requested lease before removing any. No directory discovery.
  for(const session of sessions) {
    for(const prefix of ['fit-program-direct-','fit-program-direct-bootstrap-']) {
      const status=unitStatus(prefix+session)
      if(!['not-found','loaded'].includes(status.LoadState)||!['inactive','failed'].includes(status.ActiveState)||status.MainPID!=='0')reject()
    }
    const root=parent+'/program-direct-'+session
    if(!stat(root))continue
    const before=directory(root)
    for(const name of ['server.private.pem','server.private.pem.pending','state.json','state.json.pending','operation.env','operation.json'])
      if(stat(root+'/'+name))reject()
    for(const name of ['capabilities','responses','bootstrap']) {
      const s=stat(root+'/'+name)
      if(s&&(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||readdirSync(root+'/'+name).length))reject()
    }
    const pub=stat(root+'/operator.public.pem')
    if(!pub?.isFile()||pub.isSymbolicLink()||pub.uid!==uid||(pub.mode&0o777)!==0o600||pub.nlink!==1||pub.size>8192
      ||readFileSync(root+'/operator.public.pem','utf8')!==publicKey)reject()
    roots.push({root,dev:before.dev,ino:before.ino})
  }
  for(const item of roots) {
    const now=directory(item.root)
    if(now.dev!==item.dev||now.ino!==item.ino)reject()
    rmSync(item.root,{recursive:true,force:false})
    if(stat(item.root))reject()
  }
  if(sessions.some(s=>stat(parent+'/program-direct-'+s)))reject()
  return {event:'prechannel_cleanup_verified',requested:sessions.length,removed:roots.length,absent:sessions.length}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.getuid()!==0||hostname()!=='fit-stage-app'||process.argv.length!==3)reject()
    const result=prechannelCleanup({parent:'/opt/fit/secrets',uid:0,sessions:process.argv[2].split(','),publicKey:readFileSync(0,'utf8'),
      unitStatus:unit=>{
        const p=spawnSync('/usr/bin/systemctl',['show',unit,'--property=LoadState,ActiveState,MainPID'],{encoding:'utf8',timeout:10000,maxBuffer:8192})
        if(p.error||![0,1,4].includes(p.status))reject()
        const entries=p.stdout.trim().split('\n').map(line=>line.split('='))
        if(entries.length!==3||entries.some(v=>v.length!==2)||new Set(entries.map(v=>v[0])).size!==3)reject()
        return Object.fromEntries(entries)
      }})
    console.log(JSON.stringify(result))
  } catch {console.error(JSON.stringify({event:'prechannel_cleanup_rejected'}));process.exitCode=1}
}
