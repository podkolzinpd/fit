interface Connection { query(text: string, values?: unknown[]): Promise<{rows: Record<string, unknown>[]}> }
export interface AthletePair {legacyId: string; currentId: string; trainerId: string}
export interface AthletePlan {
 schema: number; ticket: string; createdAt: number; pair: AthletePair; ready: boolean; fingerprint: string
 state: {card: {id: string; auth_user_id: string; version: string}; history: Record<string,{count: number; ids: string[]}>}
 report: Record<string,unknown>
}
export function planAthleteRestore(client: Connection, pair: AthletePair): Promise<AthletePlan>
export function applyAthleteRestore(client: Connection, plan: AthletePlan, options?: {backupVerified: boolean}): Promise<Record<string,unknown>>
export function verifyAthleteRestore(client: Connection, plan: AthletePlan, options?: {readProfile: ()=>Promise<{profile:{id:string;client?:{id:string}|null}}|undefined>}): Promise<Record<string,unknown>>
export function profileReferences(client: Connection, ids: string[], cardIds: string[]): Promise<Record<string,unknown>[]>
