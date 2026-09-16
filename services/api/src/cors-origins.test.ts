import { describe, expect, it } from 'vitest'

import { parseAllowedOrigins } from './cors-origins.js'

describe('parseAllowedOrigins', () => {
  it('accepts the exact iOS Capacitor origin alongside reviewed web origins', () => {
    expect(parseAllowedOrigins(
      'capacitor://localhost, https://fit.example.test, http://localhost:5173',
    )).toEqual([
      'capacitor://localhost',
      'https://fit.example.test',
      'http://localhost:5173',
    ])
  })

  it.each([
    'capacitor://attacker.example',
    'capacitor://localhost/path',
    'http://fit.example.test',
  ])('rejects an unreviewed origin: %s', (origin) => {
    expect(() => parseAllowedOrigins(origin)).toThrow('CORS_ALLOWED_ORIGINS')
  })
})
