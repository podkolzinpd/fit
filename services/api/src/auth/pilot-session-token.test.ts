import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createPilotSessionToken, hashPilotSessionToken } from './pilot-session-token.js'

describe('pilot session token', () => {
  it('generates a browser-safe opaque token and stores only its digest', () => {
    const session = createPilotSessionToken()

    expect(session.raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(session.sha256).toBe(
      createHash('sha256').update(session.raw, 'utf8').digest('hex'),
    )
    expect(session.sha256).not.toContain(session.raw)
  })

  it('rejects values outside the exact opaque token format', () => {
    expect(hashPilotSessionToken('too-short')).toBeUndefined()
    expect(hashPilotSessionToken(`${'x'.repeat(42)}+`)).toBeUndefined()
  })
})
