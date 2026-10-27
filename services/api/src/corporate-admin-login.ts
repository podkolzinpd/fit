import type { DatabasePool } from './db/types.js'
export interface CorporateAdminLoginObserver { observe(subjectHash:string,loginHash:string):Promise<void> }
export class DatabaseCorporateAdminLoginObserver implements CorporateAdminLoginObserver {
  constructor(private readonly pool:DatabasePool) {}
  async observe(subjectHash:string,loginHash:string):Promise<void> {
    const connection=await this.pool.connect()
    try { await connection.query('select app_private.bind_corporate_admin_login($1,$2)',[subjectHash,loginHash]) }
    finally {connection.release()}
  }
}
