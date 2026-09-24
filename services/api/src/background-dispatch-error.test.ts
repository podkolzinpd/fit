import { describe, expect, it } from 'vitest'

import { BackgroundDispatchError, backgroundDispatchDiagnostics, dispatchStage } from './background-dispatch-error.js'

describe('background dispatch diagnostics', () => {
  it('preserves original and rollback codes without exposing messages', () => {
    const cause = new AggregateError([
      Object.assign(new Error('private query'), { code: '42501' }),
      Object.assign(new Error('private connection'), { code: 'ECONNRESET' }),
    ], 'private aggregate')
    expect(backgroundDispatchDiagnostics(new BackgroundDispatchError('push', 'prepare', cause))).toEqual({
      dispatchOperation: 'push', dispatchPhase: 'prepare', errorType: 'AggregateError',
      errorCode: '42501', errorCategory: 'permission', rollbackErrorCode: 'ECONNRESET',
    })
  })

  it.each([undefined, 'secret', { code: 'SECRET_TOKEN', name: 'private' }, new Error('private')])(
    'redacts unknown error data', (error) => {
      const result = backgroundDispatchDiagnostics(error)
      expect(result).toMatchObject({ dispatchOperation: 'unknown', dispatchPhase: 'unknown', errorCode: 'unknown' })
      expect(JSON.stringify(result)).not.toMatch(/secret|private|SECRET_TOKEN/)
    },
  )

  it('wraps failures without retrying or losing the cause', async () => {
    const cause = new Error('private')
    let calls = 0
    await expect(dispatchStage('app_feedback', 'prepare', () => {
      calls += 1
      return Promise.reject(cause)
    })).rejects.toMatchObject({ operation: 'app_feedback', phase: 'prepare', cause })
    expect(calls).toBe(1)
  })
})
