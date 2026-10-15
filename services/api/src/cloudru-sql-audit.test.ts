import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { auditManifest, boundedAuditPool, compareAuditManifests, readSourceAuditManifest, runSqlAudit } from './cloudru-sql-audit.js'
import { PgDatabasePool } from './db/pg-pool.js'

vi.mock('./db/pg-pool.js', () => ({ PgDatabasePool: vi.fn() }))

const table = { schema: 'public', table: 'workouts', rows: 2, sha256: 'a'.repeat(64) }
const manifest = { format: 'fit-cloudru-sql-snapshot-v1' as const, tables: [table] }

describe('read-only Cloud.ru SQL audit', () => {
  it('compares exact content, not only row counts', () => {
    expect(compareAuditManifests(manifest, manifest)).toEqual([])
    expect(compareAuditManifests(manifest, { ...manifest, tables: [{ ...table, sha256: 'b'.repeat(64) }] }))
      .toEqual([{ table: 'public.workouts', sourceRows: 2, targetRows: 2, reason: 'content_differs' }])
  })

  it('reports missing, extra and deleted rows without printing digests', () => {
    const target = { ...manifest, tables: [{ ...table, table: 'profiles', rows: 0 }] }
    const report = compareAuditManifests(manifest, target)
    expect(report).toHaveLength(2)
    expect(report[0]).toEqual({ table: 'public.profiles', sourceRows: null, targetRows: 0, reason: 'table_missing' })
    expect(JSON.stringify(report)).not.toContain(table.sha256)
  })

  it('rejects unsafe names, duplicates, migration history and invalid digests/counts', () => {
    for (const change of [{ table: 'workouts;delete' }, { schema: 'pg_catalog' },
      { rows: -1 }, { rows: 0.5 }, { sha256: 'invalid' },
      { schema: 'app_private', table: 'fit_migrations' }]) {
      expect(() => auditManifest({ ...manifest, tables: [{ ...table, ...change }] })).toThrow('audit_manifest_invalid')
    }
    expect(() => auditManifest({ ...manifest, tables: [table, table] })).toThrow('audit_manifest_invalid')
    expect(() => auditManifest({ ...manifest, tables: [] })).toThrow('audit_manifest_invalid')
  })

  it('treats a source changing around the target read as inconclusive', async () => {
    const source = vi.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce({
      ...manifest, tables: [{ ...table, sha256: 'b'.repeat(64) }],
    })
    const result = await runSqlAudit(source, () => Promise.resolve(manifest))
    expect(result.status).toBe('source_changed_during_audit')
    expect(result.cutoverAuthorized).toBe(false)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('reports stable equality without authorizing cutover or leaking row payloads', async () => {
    const result = await runSqlAudit(() => Promise.resolve(manifest), () => Promise.resolve(manifest))
    expect(result).toMatchObject({ status: 'equal', sourceRows: 2, targetRows: 2, differences: [], cutoverAuthorized: false })
    expect(JSON.stringify(result)).not.toContain(table.sha256)
  })

  it('propagates failed reads instead of returning a false parity result', async () => {
    await expect(runSqlAudit(() => Promise.resolve(manifest), () => Promise.reject(new Error('failed'))))
      .rejects.toThrow('failed')
  })

  it('sets bounded timeouts only inside an established read-only transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue([]), release: vi.fn() }
    client.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ readOnly: 'on' }])
    const raw = new PgDatabasePool({ max: 1 })
    vi.mocked(raw).connect = vi.fn().mockResolvedValue(client)
    const end = vi.fn().mockResolvedValue(undefined)
    vi.mocked(raw).end = end
    const bounded = boundedAuditPool(raw)
    const connection = await bounded.connect()
    await connection.query('begin isolation level repeatable read read only')
    expect(client.query).toHaveBeenNthCalledWith(1, 'begin isolation level repeatable read read only', [])
    expect(client.query).toHaveBeenNthCalledWith(2, "set local statement_timeout = '60s'")
    expect(client.query).toHaveBeenNthCalledWith(3, "set local lock_timeout = '2s'")
    expect(client.query).toHaveBeenNthCalledWith(4, "select current_setting('transaction_read_only') as \"readOnly\"")
    await connection.query('commit')
    expect(client.query).toHaveBeenCalledTimes(5)
    connection.release()
    await bounded.end()
    expect(client.release).toHaveBeenCalledOnce()
    expect(end).toHaveBeenCalledOnce()
  })

  it('refuses a connection not actually in READ ONLY and propagates setup failures', async () => {
    const client = { query: vi.fn().mockResolvedValue([]), release: vi.fn() }
    const raw = new PgDatabasePool({ max: 1 })
    vi.mocked(raw).connect = vi.fn().mockResolvedValue(client)
    const connection = await boundedAuditPool(raw).connect()
    await expect(connection.query('begin isolation level repeatable read read only'))
      .rejects.toThrow('audit_readonly_required')
    client.query.mockRejectedValueOnce(new Error('setup failed'))
    await expect(connection.query('begin isolation level repeatable read read only'))
      .rejects.toThrow('setup failed')
  })

  it('calls only the IAM-protected manifest with bounded time and no redirects/chunks', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(manifest)))
    expect(await readSourceAuditManifest('https://example.containers.yandexcloud.net', 'test-token', request))
      .toEqual(manifest)
    expect(request.mock.calls[0]?.[0]).toBe('https://example.containers.yandexcloud.net/stage/cloudru/sql-snapshot/manifest')
    expect(request.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(request.mock.calls[0]?.[1]?.redirect).toBe('error')
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    await expect(readSourceAuditManifest('http://invalid.example', 'test-token', request))
      .rejects.toThrow('audit_source_url_invalid')
    request.mockResolvedValue(new Response('private error must not be emitted', { status: 503 }))
    await expect(readSourceAuditManifest('https://example.containers.yandexcloud.net', 'test-token', request))
      .rejects.toThrow('audit_source_http_503')
  })

  it('keeps transfer apply and empty-target guards intact and audit non-mutating', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/transfer-yandex-sql-to-cloudru.yml', import.meta.url), 'utf8')
    expect(workflow).toContain("if: inputs.mode != 'audit'")
    expect(workflow).toContain("if: inputs.mode == 'dry-run' || inputs.mode == 'apply'")
    expect(workflow).toContain('unexpected nonempty target table')
    expect(workflow).toContain("test -z \"$(sudo podman ps -a --filter name='^fit-api-stage$'")
    const audit = workflow.split('      - name: Read-only SQL parity and private runtime audit')[1]
    expect(audit).toBeDefined()
    expect(audit).not.toMatch(/db:migrate|pg_restore|sql-transfer-cli|systemctl (?:reload|restart)|certbot|nginx -s|podman (?:stop|rm)/u)
    expect(audit).toContain('cloudru-sql-audit.ts:ro')
    expect(audit).toContain('--read-only')
    for (const block of workflow.matchAll(/ {8}run: \|\n([\s\S]*?)(?=\n {6}- name:|$)/gu)) {
      const script = block[1]?.split('\n').map((line) => line.slice(10)).join('\n')
        .replace(/\$\{\{[^}]+\}\}/gu, 'audit')
      const checked = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
      expect(checked.status, checked.stderr).toBe(0)
    }
  })
})
