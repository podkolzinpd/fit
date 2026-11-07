import { aiStudioUsage, reportAiStudioMetric } from '../../ai-studio-usage-metrics.js';
import { signLlmGatewayRequest } from '../../yandex-llm-gateway-auth.js';
import { buildYandexAiAuthorization, MetadataYandexAiAuthorization } from '../../yandex-ai-authorization.js';
export async function programModelAuthorization() { return {header:'audit-workflow-transport',iamToken:null}; }

export async function programIamToken() {
    const response = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
        throw new Error('program_auth_unavailable');
    const value = await response.json();
    if (!value || typeof value !== 'object' || !('access_token' in value) || typeof value.access_token !== 'string')
        throw new Error('program_auth_unavailable');
    return value.access_token;
}
export async function programModelJson(input) {
 const {spawn}=await import('node:child_process');
 const result=await new Promise((resolve,reject)=>{
  const child=spawn('python3',[process.env.FIT_AUDIT_RPC_SCRIPT],{stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>{if(code!==0){import('node:fs').then(fs=>fs.appendFileSync(process.env.FIT_AUDIT_RPC_ERROR_FILE,JSON.stringify({at:new Date().toISOString(),error:err.slice(0,2500),inputBytes:JSON.stringify(input).length,maxTokens:input.maxTokens})+'\n'));reject(new Error('audit_real_model_rpc_failed'));}else{try{resolve(JSON.parse(out))}catch{reject(new Error('audit_real_model_rpc_invalid_json'))}}});
  child.stdin.end(JSON.stringify(input));
 });
 input.onResponse?.(result.value);
 return result.value;
}

export function isProgramEnabled(userId) {
    // Role and client ownership are checked by the authenticated orchestrator.
    // The generator remains private to its service account.
    return process.env.ASSISTANT_PROGRAM_ENABLED === 'true' && userId.trim().length > 0;
}
