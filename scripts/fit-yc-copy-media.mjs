import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand}=createRequire('/app/package.json')('@aws-sdk/client-s3');
const config=JSON.parse(process.env.COPY_CONFIG_JSON);
if(config.folder!=='b1gt7dfqg9sht9slnno5'||config.bucket!=='fit-copy-media-b1gt7dfqg9sht9slnno5') throw Error('target_rejected');
const sourceBucket=process.env.CLOUDRU_MEDIA_BUCKET;
if(sourceBucket!=='fit-cloudru-stage-media-c2ad3760') throw Error('source_rejected');
const source=new S3Client({endpoint:'https://s3.cloud.ru',region:'ru-central-1',forcePathStyle:true,maxAttempts:3,credentials:{accessKeyId:process.env.CLOUDRU_TENANT_ID+':'+process.env.CLOUDRU_MEDIA_KEY_ID,secretAccessKey:process.env.CLOUDRU_MEDIA_KEY_SECRET}});
const target=new S3Client({endpoint:'https://storage.yandexcloud.net',region:'ru-central1',maxAttempts:3,credentials:{accessKeyId:config.s3.access_key,secretAccessKey:config.s3.secret}});
let token,objects=0,bytes=0;
const hashes=[];
try{
 do{
  const page=await source.send(new ListObjectsV2Command({Bucket:sourceBucket,ContinuationToken:token}));
  const items=page.Contents??[];
  for(let start=0;start<items.length;start+=5){
   await Promise.all(items.slice(start,start+5).map(async item=>{
    const original=await source.send(new GetObjectCommand({Bucket:sourceBucket,Key:item.Key}));
    const body=await original.Body.transformToByteArray();
    const digest=createHash('sha256').update(body).digest('hex');
    await target.send(new PutObjectCommand({Bucket:config.bucket,Key:item.Key,Body:body,ContentType:original.ContentType,CacheControl:original.CacheControl,ContentDisposition:original.ContentDisposition,ContentEncoding:original.ContentEncoding,Metadata:original.Metadata}));
    const copied=await target.send(new GetObjectCommand({Bucket:config.bucket,Key:item.Key}));
    const readback=await copied.Body.transformToByteArray();
    if(readback.length!==body.length||createHash('sha256').update(readback).digest('hex')!==digest) throw Error('object_mismatch');
    hashes.push(createHash('sha256').update(item.Key+'\0'+digest).digest('hex'));objects++;bytes+=body.length;
   }));
  }
  console.log(JSON.stringify({event:'media_copy_progress',objects,bytes}));
  token=page.IsTruncated?page.NextContinuationToken:undefined;
 }while(token);
 let targetCount=0,targetBytes=0;token=undefined;
 do{const page=await target.send(new ListObjectsV2Command({Bucket:config.bucket,ContinuationToken:token}));for(const x of page.Contents??[]){targetCount++;targetBytes+=Number(x.Size??0);}token=page.IsTruncated?page.NextContinuationToken:undefined;}while(token);
 if(targetCount!==objects||targetBytes!==bytes) throw Error('inventory_mismatch');
 console.log(JSON.stringify({event:'media_copy_verified',objects,bytes,sha256:createHash('sha256').update(hashes.sort().join('\n')).digest('hex')}));
}catch(e){console.log(JSON.stringify({event:'media_copy_failed',status:e.$metadata?.httpStatusCode??0,stage:['object_mismatch','inventory_mismatch'].includes(e.message)?e.message:'storage_request'}));process.exitCode=1;}
