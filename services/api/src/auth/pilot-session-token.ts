import { createHash, randomBytes } from 'node:crypto'

const PILOT_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface NewPilotSessionToken {
  raw: string
  sha256: string
}

export function createPilotSessionToken(): NewPilotSessionToken {
  const raw = randomBytes(32).toString('base64url')
  const sha256 = hashPilotSessionToken(raw)
  if (sha256 === undefined) throw new Error('Generated pilot session token is invalid')
  return { raw, sha256 }
}

export function hashPilotSessionToken(token: string): string | undefined {
  if (!PILOT_SESSION_TOKEN_PATTERN.test(token)) return undefined
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
