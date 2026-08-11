import type { QueryResultRow } from 'pg'

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<readonly Row[]>
}

export interface DatabaseConnection extends DatabaseClient {
  release(): void
}

export interface DatabasePool {
  connect(): Promise<DatabaseConnection>
  end(): Promise<void>
}
