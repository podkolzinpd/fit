import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../data/repositories/error'
import { queryRetryDelay, shouldRetryQuery } from './query-retry-policy'

describe('shouldRetryQuery', () => {
  it.each([
    'PT404',
    'PT409',
    'PT422',
    'PGRST116',
    '28000',
    '28P01',
    '42501',
  ])('does not retry permanent code %s', (code) => {
    expect(shouldRetryQuery(0, new RepositoryError(code, 'permanent'))).toBe(false)
  })

  it.each([401, 403, 404, 409, 422])('does not retry HTTP %s', (status) => {
    expect(shouldRetryQuery(0, { status })).toBe(false)
  })

  it.each([
    '08006',
    '53300',
    '57P01',
    '57P02',
    '57P03',
    'PGRST000',
    'PGRST001',
    'PGRST002',
    'PGRST003',
  ])('retries transient code %s once', (code) => {
    const error = new RepositoryError(code, 'temporarily unavailable')

    expect(shouldRetryQuery(0, error)).toBe(true)
    expect(shouldRetryQuery(1, error)).toBe(false)
  })

  it.each([502, 503, 504])('retries transient HTTP %s once', (status) => {
    expect(shouldRetryQuery(0, { status })).toBe(true)
    expect(shouldRetryQuery(1, { status })).toBe(false)
  })

  it('retries a fetch network error once', () => {
    const error = new TypeError('Failed to fetch')

    expect(shouldRetryQuery(0, error)).toBe(true)
    expect(shouldRetryQuery(1, error)).toBe(false)
  })

  it('does not retry an unknown application error', () => {
    expect(shouldRetryQuery(0, new Error('unexpected response'))).toBe(false)
  })
})

describe('queryRetryDelay', () => {
  afterEach(() => vi.restoreAllMocks())

  it('adds bounded jitter to exponential backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1)

    expect(queryRetryDelay(0)).toBe(750)
    expect(queryRetryDelay(1)).toBe(2_500)
  })

  it('caps the exponential base delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(queryRetryDelay(10)).toBe(5_000)
  })
})

