import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
const expected='2874d3dfbe7ed9f2bb6ee670d47c2df48192df83';
const address='89.169.148.38';
const mode=process.argv[2]??'standby';
if(!['standby','production'].includes(mode))throw Error('acceptance_mode_rejected');
const cases=[['fit-training.ru','/auth',200],['www.fit-training.ru','/auth',200],['api.fit-training.ru','/health',200],['api.fit-training.ru','/ready',200],['api.fit-training.ru','/v1/clients',401],['api.fit-training.ru','/v1/trainers/catalog',200],['fit-training.ru','/api/health',200],['fit-training.ru','/api/ready',200],['fit-training.ru','/api/v1/clients',401],['api.fit-training.ru','/libs/lib-jitsi-meet.min.js',200]];
const probe=(host,path,status)=>new Promise(resolve=>{
 let done=false;const finish=x=>{if(!done){done=true;clearTimeout(timer);resolve(x);}};
 const req=request({hostname:host,servername:host,path,method:'GET',family:4,lookup:(_host,_options,callback)=>callback(null,address,4),rejectUnauthorized:true,agent:false},res=>{
  const expires=Date.parse(res.socket.getPeerCertificate().valid_to);const chunks=[];let bytes=0;
  res.on('data',b=>{bytes+=b.length;if(bytes>5*1024*1024)req.destroy();else if(path.endsWith('/health'))chunks.push(b);});
  res.on('end',()=>{let release;if(path.endsWith('/health')){try{release=JSON.parse(Buffer.concat(chunks)).releaseId;}catch{}}
   const passed=res.statusCode===status&&expires>Date.now()+86400000&&(!path.endsWith('/health')||release===expected);
   finish({host,path,status:res.statusCode,certificateValidDays:Math.floor((expires-Date.now())/86400000),...(release?{release}:{}),passed});});
  res.on('error',()=>finish({host,path,passed:false,error:'response'}));
 });
 const timer=setTimeout(()=>req.destroy(),15000);req.on('error',()=>finish({host,path,passed:false,error:'request'}));req.end();
});
const checks=await Promise.all(cases.map(x=>probe(...x)));
const expectedAddress=mode==='standby'?'87.242.117.210':address;
const dns=[];for(const host of ['fit-training.ru','www.fit-training.ru','api.fit-training.ru']){const addresses=[...new Set((await lookup(host,{all:true})).map(x=>x.address))].sort();dns.push({host,addresses,passed:addresses.length===1&&addresses[0]===expectedAddress});}
const passed=checks.every(x=>x.passed)&&dns.every(x=>x.passed);
console.log(JSON.stringify({event:mode+'_public_acceptance',target:address,checkedAt:new Date().toISOString(),passed,checks,dns}));
if(!passed)process.exitCode=1;
