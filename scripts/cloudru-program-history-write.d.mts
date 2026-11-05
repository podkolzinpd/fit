interface Connection {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
interface Scope {code:string;sha256:string;workouts:number;exercises:number;sets:number;from:string;to:string;trainingFormat:string}
export function runProgramImport(options:{
  mode:'inspect'|'apply'|'verify';owner:Connection;runtime:Connection;
  target:{trainerLoginSha256:string;trainerEmailSha256:string;clientNameSha256:string};legacyId?:string|null;trainerEvidence?:{version:number;targetBinding:string;rosterNameHashes:string[];programAlias?:{code:string;sourceNameSha256:string;rosterNameSha256:string}}|null;
  parts:string[];approvedSha256:string;
  readRequest:(...args:never[])=>{draft:object;expectedVersion:number|null}|undefined;
  saveCompleted:(...args:never[])=>Promise<{id:string;version:number}>;
  createCard:(...args:never[])=>Promise<{id:string;version:number;membershipVersion:number}>;
  persistReceipt:(state:'prepared'|'committed'|'readback',receipt:Record<string,unknown>)=>Promise<void>;
  selectionBinding:(mode:'inspect'|'apply',value:string)=>Promise<void>;
  beginSingleApply:()=>void|Promise<void>;
  persistProof:(receipt:Record<string,unknown>)=>void|Promise<void>;
  readProof:()=>Record<string,unknown>|null|Promise<Record<string,unknown>|null>;
  markVerified:(status:'complete'|'not_present'|'no_commit')=>void|Promise<void>;
  preparedReceiptCapability?:()=>Promise<void>;
  scopes?:Scope[];
}):Promise<{status:string;code:string;workouts:number;readOnly?:boolean;createdCard?:boolean;contentVerified?:boolean;previousStateVerified?:boolean}>
