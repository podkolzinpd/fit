import { describe, expect, it, vi } from 'vitest'

import { buildDatabaseConnectionConfig } from './connection-config.js'

describe('database connection config', () => {
  it('keeps URL configuration for local development', () => {
    expect(
      buildDatabaseConnectionConfig('DATABASE', {
        environment: { DATABASE_URL: 'postgresql://local/fit' },
      }),
    ).toEqual({ connectionString: 'postgresql://local/fit' })
  })

  it('builds a TLS config from Connection Manager components', () => {
    const readCertificate = vi.fn().mockReturnValue('trusted-ca')

    expect(
      buildDatabaseConnectionConfig('MIGRATION_DATABASE', {
        environment: {
          MIGRATION_DATABASE_HOST: 'private.db.yandexcloud.net',
          MIGRATION_DATABASE_PORT: '6432',
          MIGRATION_DATABASE_NAME: 'fit',
          MIGRATION_DATABASE_USER: 'fit_owner',
          MIGRATION_DATABASE_PASSWORD: 'generated-password',
          MIGRATION_DATABASE_SSL_ROOT_CERT: '/certs/yandex.pem',
        },
        readCertificate,
      }),
    ).toEqual({
      host: 'private.db.yandexcloud.net',
      port: 6432,
      database: 'fit',
      user: 'fit_owner',
      password: 'generated-password',
      ssl: { ca: 'trusted-ca', rejectUnauthorized: true },
    })
    expect(readCertificate).toHaveBeenCalledWith('/certs/yandex.pem')
  })

  it('requires encrypted TLS for the Cloud.ru stage IP without an unavailable CA', () => {
    const readCertificate = vi.fn()
    expect(buildDatabaseConnectionConfig('DATABASE', {
      environment: {
        DATABASE_HOST: '10.70.10.67',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'fit',
        DATABASE_USER: 'fit_api',
        DATABASE_PASSWORD: 'generated-password',
        DATABASE_SSL_MODE: 'require',
      },
      readCertificate,
    })).toMatchObject({ ssl: { rejectUnauthorized: false } })
    expect(readCertificate).not.toHaveBeenCalled()
  })

  it('does not allow unverified TLS for other databases', () => {
    expect(() => buildDatabaseConnectionConfig('DATABASE', {
      environment: {
        DATABASE_HOST: 'private.db.yandexcloud.net',
        DATABASE_PORT: '6432',
        DATABASE_NAME: 'fit',
        DATABASE_USER: 'fit_api',
        DATABASE_PASSWORD: 'generated-password',
        DATABASE_SSL_MODE: 'require',
      },
    })).toThrow('DATABASE_SSL_MODE=require is limited to the Cloud.ru stage database')
  })

  it('rejects partial component configuration', () => {
    expect(() =>
      buildDatabaseConnectionConfig('DATABASE', {
        environment: { DATABASE_HOST: 'private.db.yandexcloud.net' },
      }),
    ).toThrow('DATABASE connection variables are incomplete')
  })

  it('rejects ambiguous URL and component configuration', () => {
    expect(() =>
      buildDatabaseConnectionConfig('DATABASE', {
        environment: {
          DATABASE_URL: 'postgresql://local/fit',
          DATABASE_HOST: 'private.db.yandexcloud.net',
        },
      }),
    ).toThrow('DATABASE_URL cannot be combined with component variables')
  })

  it('returns undefined when no database is configured', () => {
    expect(
      buildDatabaseConnectionConfig('DATABASE', { environment: {} }),
    ).toBeUndefined()
  })
})
