import { safeDatabaseErrorDiagnostics } from './db/database-readiness.js'

type DispatchOperation = 'push' | 'app_feedback'
type DispatchPhase = 'prepare' | 'finalize'

export class BackgroundDispatchError extends Error {
  constructor(
    readonly operation: DispatchOperation,
    readonly phase: DispatchPhase,
    cause: unknown,
  ) {
    super('Background dispatch stage failed', { cause })
    this.name = 'BackgroundDispatchError'
  }
}

export async function dispatchStage<Result>(
  operation: DispatchOperation,
  phase: DispatchPhase,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    throw new BackgroundDispatchError(operation, phase, error)
  }
}

function safeCause(error: unknown) {
  const diagnostics = safeDatabaseErrorDiagnostics(error)
  // Do not allow arbitrary strings from error.code into logs.
  const code = /^(?:[0-9][0-9A-Z]{4}|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)$/u
    .test(diagnostics.code) ? diagnostics.code : 'unknown'
  return {
    errorCode: code,
    errorCategory: code === 'unknown' ? 'unknown' : diagnostics.category,
  }
}

export function backgroundDispatchDiagnostics(error: unknown) {
  const cause = error instanceof BackgroundDispatchError ? error.cause : error
  // Transaction helpers preserve [original error, rollback error]. Never log
  // AggregateError itself: messages and nested errors can contain user data.
  const original: unknown = cause instanceof AggregateError ? cause.errors[0] : cause
  const rollback: unknown = cause instanceof AggregateError ? cause.errors[1] : undefined
  return {
    dispatchOperation: error instanceof BackgroundDispatchError ? error.operation : 'unknown',
    dispatchPhase: error instanceof BackgroundDispatchError ? error.phase : 'unknown',
    errorType: cause instanceof AggregateError ? 'AggregateError' : cause instanceof Error ? 'Error' : 'unknown',
    ...safeCause(original),
    ...(cause instanceof AggregateError ? { rollbackErrorCode: safeCause(rollback).errorCode } : {}),
  }
}
