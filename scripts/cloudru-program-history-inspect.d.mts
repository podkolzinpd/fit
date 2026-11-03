interface Connection {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
interface Scope {code:string;sha256:string;workouts:number;exercises:number;sets:number;from:string;to:string;trainingFormat:string}
export function inspectProgramHistory(options:{
  owner:Connection;runtime:Connection;
  target:{trainerLoginSha256:string;trainerEmailSha256:string;clientNameSha256:string};legacyId?:string|null;
  parts:string[];approvedSha256:string;
  readRequest:(...args:never[])=>{draft:object;expectedVersion:number|null}|undefined;
  persistInspection:(receipt:Record<string,unknown>)=>Promise<void>;
  scopes?:Scope[];
}):Promise<{event:string;code:string;status:string;readOnly:boolean;productionMutated:boolean;trainerVerified:boolean;exactCards:number;potentialCards:number;existingWorkouts:number;newWorkouts:number;duplicates:number;conflicts:number}>
