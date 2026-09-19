import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient } from '../db/types.js'
import {
  applySourceCutoverWriteGate,
  readSourceCutoverWriteGateSettings,
  SourceCutoverWriteGateError,
} from './source-cutover-write-gate.js'

const PROJECT_ID = 'abcdefghijklmnopqrst'
const ENVIRONMENT = {
  FIT_SOURCE_CUTOVER_WRITE_GATE_ACTION: 'inspect',
  FIT_TENANT_SOURCE_POOLER_URL:
    `postgresql://postgres.${PROJECT_ID}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  FIT_TENANT_SOURCE_SSL_ROOT_CERT: '/certs/root.pem',
  SUPABASE_DB_PASSWORD: 'password',
  SUPABASE_PROJECT_ID: PROJECT_ID,
}

describe('source cutover write gate settings', () => {
  it('keeps inspection confirmation-free and source-only', () => {
    const settings = readSourceCutoverWriteGateSettings(
      ENVIRONMENT,
      () => 'trusted-ca',
    )

    expect(settings.action).toBe('inspect')
    expect(new URL(String(settings.sourceConfig.connectionString)).hostname)
      .toBe('aws-0-eu-west-1.pooler.supabase.com')
  })

  it.each([
    ['enable', undefined, 'enable_not_confirmed'],
    ['disable', undefined, 'disable_not_confirmed'],
    ['enable', 'wrong', 'enable_not_confirmed'],
    ['disable', 'wrong', 'disable_not_confirmed'],
  ])('rejects unconfirmed %s', (action, confirmation, code) => {
    expect(() => readSourceCutoverWriteGateSettings({
      ...ENVIRONMENT,
      FIT_SOURCE_CUTOVER_WRITE_GATE_ACTION: action,
      FIT_SOURCE_CUTOVER_WRITE_GATE_CONFIRMATION: confirmation,
    }, () => 'trusted-ca')).toThrowError(new SourceCutoverWriteGateError(code))
  })

  it('accepts only the bounded enable and rollback phrases', () => {
    expect(readSourceCutoverWriteGateSettings({
      ...ENVIRONMENT,
      FIT_SOURCE_CUTOVER_WRITE_GATE_ACTION: 'enable',
      FIT_SOURCE_CUTOVER_WRITE_GATE_CONFIRMATION:
        'PAUSE_SUPABASE_PRODUCT_WRITES_FOR_CUTOVER',
    }, () => 'trusted-ca').action).toBe('enable')

    expect(readSourceCutoverWriteGateSettings({
      ...ENVIRONMENT,
      FIT_SOURCE_CUTOVER_WRITE_GATE_ACTION: 'disable',
      FIT_SOURCE_CUTOVER_WRITE_GATE_CONFIRMATION:
        'RESUME_SUPABASE_PRODUCT_WRITES_BEFORE_YANDEX_WRITES',
    }, () => 'trusted-ca').action).toBe('disable')
  })
})

describe('source cutover write gate command', () => {
  it.each([
    ['inspect' as const, true, undefined],
    ['enable' as const, true, true],
    ['disable' as const, false, false],
  ])('reports %s state without row data', async (action, paused, parameter) => {
    const query = vi.fn().mockResolvedValue([{ writes_paused: paused }])
    await expect(applySourceCutoverWriteGate(
      { query },
      action,
    )).resolves.toBe(paused)
    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      ...(parameter === undefined ? [] : [[parameter]]),
    )
  })

  it('fails closed on a missing or contradictory state', async () => {
    const missingDatabase = {
      query: vi.fn().mockResolvedValue([]),
    } as unknown as DatabaseClient
    const contradictoryDatabase = {
      query: vi.fn().mockResolvedValue([{ writes_paused: false }]),
    } as unknown as DatabaseClient

    await expect(applySourceCutoverWriteGate(
      missingDatabase,
      'inspect',
    )).rejects.toEqual(new SourceCutoverWriteGateError('gate_state_invalid'))
    await expect(applySourceCutoverWriteGate(
      contradictoryDatabase,
      'enable',
    )).rejects.toEqual(new SourceCutoverWriteGateError('enable_failed'))
  })
})
