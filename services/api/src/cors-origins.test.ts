import { describe, expect, it } from 'vitest'

import { parseAllowedOrigins } from './cors-origins.js'

describe('parseAllowedOrigins', () => {
  it('accepts the exact Android and iOS Capacitor origins alongside reviewed web origins', () => {
    expect(parseAllowedOrigins(
      'capacitor://localhost, https://localhost, https://fit.example.test, http://localhost:5173',
    )).toEqual([
      'capacitor://localhost',
      'https://localhost',
      'https://fit.example.test',
      'http://localhost:5173',
    ])
  })

  it.each([
    'capacitor://attacker.example',
    'capacitor://localhost/path',
    'http://fit.example.test',
    'https://localhost/path',
  ])('rejects an unreviewed origin: %s', (origin) => {
    expect(() => parseAllowedOrigins(origin)).toThrow('CORS_ALLOWED_ORIGINS')
  })
})
