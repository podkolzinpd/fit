import { ChildProcess, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { chmod, lstat, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { backupCloudruDatabase } from './cloudru-release-migrations.js'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(),
  stat: vi.fn(), lstat: vi.fn(), chmod: vi.fn() }))

const config = { host: '10.70.10.67', port: 5432, database: 'fit', user: 'fit_owner', password: 'synthetic-owner-password' }
const directory = statSync(tmpdir())
directory.uid = 0
directory.mode = 0o40700
const archive = statSync(process.execPath)
archive.uid = 0
archive.mode = 0o100600

function childWithExit(code: number): ChildProcess {
  const child = new ChildProcess()
  queueMicrotask(() => { child.emit('exit', code) })
  return child
}

describe('private pre-migration backup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(stat).mockResolvedValueOnce(directory).mockResolvedValueOnce(archive)
    vi.mocked(lstat).mockRejectedValue(Object.assign(new Error('synthetic_absent'), { code: 'ENOENT' }))
    vi.mocked(chmod).mockResolvedValue(undefined)
    vi.mocked(spawn).mockImplementation(() => childWithExit(0))
  })

  it('uses bounded PostgreSQL17 tools, verifies the archive, and never exposes credentials in arguments or child output', async () => {
    await backupCloudruDatabase(config, '/backup')
    expect(spawn).toHaveBeenNthCalledWith(1, 'pg_dump', expect.arrayContaining(['--format=custom', '--file', '/backup/before-migrations.dump']),
      expect.objectContaining({ stdio: 'ignore', timeout: 300_000 }))
    expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env)
      .toMatchObject({ PGUSER: 'fit_owner', PGPASSWORD: 'synthetic-owner-password', PGSSLMODE: 'require' })
    expect(JSON.stringify(vi.mocked(spawn).mock.calls[0]?.[1])).not.toContain('synthetic-owner-password')
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).not.toContain('--no-acl')
    expect(spawn).toHaveBeenNthCalledWith(2, 'pg_restore', ['--list', '/backup/before-migrations.dump'],
      expect.objectContaining({ stdio: 'ignore', timeout: 30_000 }))
    expect(chmod).toHaveBeenCalledWith('/backup/before-migrations.dump', 0o600)
  })

  it('refuses to overwrite an existing backup or follow its symlink', async () => {
    vi.mocked(lstat).mockResolvedValue(archive)
    await expect(backupCloudruDatabase(config, '/backup')).rejects.toThrow('cloudru_backup_already_exists')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('requires a root-owned private backup directory', async () => {
    const unsafe = statSync(tmpdir())
    unsafe.mode = 0o40777
    vi.mocked(stat).mockReset().mockResolvedValue(unsafe)
    await expect(backupCloudruDatabase(config, '/backup')).rejects.toThrow('cloudru_backup_directory_rejected')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('fails closed if pg_dump cannot produce the backup', async () => {
    vi.mocked(spawn).mockImplementation(() => childWithExit(1))
    await expect(backupCloudruDatabase(config, '/backup')).rejects.toThrow('cloudru_backup_failed')
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('fails closed if pg_restore cannot read the archive', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => childWithExit(0)).mockImplementationOnce(() => childWithExit(1))
    await expect(backupCloudruDatabase(config, '/backup')).rejects.toThrow('cloudru_backup_invalid')
  })
})
