import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg'

import type { DatabaseConnection, DatabasePool } from './types.js'
import { safeDatabaseErrorDiagnostics } from './database-readiness.js'

class PgDatabaseConnection implements DatabaseConnection {
  constructor(
    private readonly client: PoolClient,
    private readonly onRelease: () => void,
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    const result = await this.client.query<Row>(text, [...values])
    return result.rows
  }

  release(): void {
    this.client.release()
    this.onRelease()
  }
}

type PoolRole = 'api' | 'dispatcher' | 'migration-owner' | 'migration-runtime' | 'function' | 'unspecified'
const REPORT_INTERVAL_MS = 60_000

function writePoolDiagnostic(record: Readonly<Record<string, unknown>>, failed: boolean): void {
  // A failed diagnostic sink must not strand a client or replace a DB error.
  // DB/query errors are still propagated by the caller, without retries.
  try {
    if (failed) console.warn(JSON.stringify(record))
    else console.info(JSON.stringify(record))
  } catch {
    // Best-effort diagnostic sink; not a database/query error handler.
  }
}

function emptyWindow() {
  return {
    acquired: 0,
    acquireErrors: 0,
    capacityErrors: 0,
    idleErrors: 0,
    acquireTotalMs: 0,
    acquireMaxMs: 0,
    failedAcquireMaxMs: 0,
    waitingMax: 0,
    occupiedMax: 0,
    totalMax: 0,
  }
}

export class PgDatabasePool implements DatabasePool {
  private readonly pool: Pool
  private window = emptyWindow()
  private windowStartedAt = performance.now()
  private lastReportAt = Number.NEGATIVE_INFINITY
  private lastErrorReportAt = Number.NEGATIVE_INFINITY
  private lastError: Readonly<{ category: string; code: string }> | undefined

  constructor(config: PoolConfig, private readonly role: PoolRole = 'unspecified') {
    this.pool = new Pool({
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ...config,
    })
    // pg removes the failed idle client before emitting this event. Without a
    // listener EventEmitter throws outside the request's query try/catch.
    this.pool.on('error', (error: Error) => {
      const diagnostics = safeDatabaseErrorDiagnostics(error)
      writePoolDiagnostic({
        level: 'WARN',
        event: 'database_pool_idle_error',
        poolRole: this.role,
        databaseErrorCategory: diagnostics.category,
        databaseErrorCode: diagnostics.code,
      }, true)
      this.window.idleErrors += 1
      this.lastError = diagnostics
      this.sample()
      this.report(true)
    })
  }

  async connect(): Promise<DatabaseConnection> {
    const startedAt = performance.now()
    this.sample()
    let client: PoolClient
    try {
      // connect() queues synchronously when all clients are occupied. Sample
      // after calling it as well, before waiting for the promise to resolve.
      const pending = this.pool.connect()
      this.sample()
      client = await pending
    } catch (error) {
      this.window.acquireErrors += 1
      this.window.failedAcquireMaxMs = Math.max(
        this.window.failedAcquireMaxMs, performance.now() - startedAt,
      )
      const diagnostics = safeDatabaseErrorDiagnostics(error)
      if (diagnostics.code === '53300') this.window.capacityErrors += 1
      this.lastError = {
        ...diagnostics,
        category: diagnostics.code === '53300' ? 'capacity' : diagnostics.category,
      }
      this.sample()
      this.report(true)
      throw error
    }
    const durationMs = performance.now() - startedAt
    this.window.acquired += 1
    this.window.acquireTotalMs += durationMs
    this.window.acquireMaxMs = Math.max(this.window.acquireMaxMs, durationMs)
    this.sample()
    this.report()
    return new PgDatabaseConnection(client, () => this.sample())
  }

  async end(): Promise<void> {
    await this.pool.end()
    this.report(false, true)
  }

  private sample(): void {
    this.window.waitingMax = Math.max(this.window.waitingMax, this.pool.waitingCount)
    this.window.occupiedMax = Math.max(
      this.window.occupiedMax, this.pool.totalCount - this.pool.idleCount,
    )
    this.window.totalMax = Math.max(this.window.totalMax, this.pool.totalCount)
  }

  private report(failed = false, closing = false): void {
    const now = performance.now()
    const hasObservations = this.window.acquired + this.window.acquireErrors + this.window.idleErrors > 0
    if (!hasObservations) return
    if (!closing && now - this.lastReportAt < REPORT_INTERVAL_MS
      && (!failed || now - this.lastErrorReportAt < REPORT_INTERVAL_MS)) return

    const hasErrors = this.window.acquireErrors + this.window.idleErrors > 0
    const record = {
      level: hasErrors ? 'WARN' : 'INFO',
      event: 'database_pool_window',
      poolRole: this.role,
      windowMs: Math.round(now - this.windowStartedAt),
      poolMax: this.pool.options.max,
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      occupied: this.pool.totalCount - this.pool.idleCount,
      waiting: this.pool.waitingCount,
      ...this.window,
      acquireTotalMs: Math.round(this.window.acquireTotalMs),
      acquireMaxMs: Math.round(this.window.acquireMaxMs),
      failedAcquireMaxMs: Math.round(this.window.failedAcquireMaxMs),
      databaseErrorCategory: this.lastError?.category,
      databaseErrorCode: this.lastError?.code,
    }
    writePoolDiagnostic(record, hasErrors)
    this.lastReportAt = now
    if (hasErrors) this.lastErrorReportAt = now
    this.windowStartedAt = now
    this.window = emptyWindow()
    this.lastError = undefined
  }
}
