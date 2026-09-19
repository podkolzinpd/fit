import { describe, expect, it } from 'vitest'

import type { BrotliTenantMigrationEnvelope } from './types.js'
import {
  decodeStageTenantMigrationTransport,
  encodeStageTenantMigrationTransport,
} from './transport.js'

const ENVELOPE: BrotliTenantMigrationEnvelope = {
  format: 'fit-tenant-envelope-v3',
  compression: { name: 'brotli' },
  kdf: {
    name: 'scrypt',
    salt: Buffer.alloc(16, 1).toString('base64'),
  },
  cipher: {
    name: 'aes-256-gcm',
    iv: Buffer.alloc(12, 2).toString('base64'),
    authTag: Buffer.alloc(16, 3).toString('base64'),
  },
  ciphertext: Buffer.alloc(3_000, 4).toString('base64'),
}

describe('stage tenant migration binary transport', () => {
  it('round-trips the encrypted envelope without Base64 body overhead', () => {
    const transport = encodeStageTenantMigrationTransport(ENVELOPE)

    expect(decodeStageTenantMigrationTransport(
      transport.body,
      transport.headers,
    )).toEqual(ENVELOPE)
    expect(transport.body.byteLength).toBe(3_000)
    expect(transport.body.byteLength).toBeLessThan(
      Buffer.byteLength(JSON.stringify(ENVELOPE)) * 0.8,
    )
  })

  it.each([
    ['empty body', Buffer.alloc(0), encodeStageTenantMigrationTransport(ENVELOPE).headers],
    ['missing metadata', Buffer.from('ciphertext'), {}],
    [
      'wrong format',
      Buffer.from('ciphertext'),
      {
        ...encodeStageTenantMigrationTransport(ENVELOPE).headers,
        'x-fit-tenant-migration-envelope-format': 'fit-tenant-envelope-v2',
      },
    ],
    [
      'non-canonical metadata',
      Buffer.from('ciphertext'),
      {
        ...encodeStageTenantMigrationTransport(ENVELOPE).headers,
        'x-fit-tenant-migration-salt': 'not-base64',
      },
    ],
  ])('rejects %s', (_name, body, headers) => {
    expect(decodeStageTenantMigrationTransport(body, headers)).toBeUndefined()
  })
})
