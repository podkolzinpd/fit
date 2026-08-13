import Fastify, { type FastifyInstance } from 'fastify'

interface BuildMigrationAppOptions {
  logger?: boolean
  runMigrations: () => Promise<readonly string[]>
}

export function buildMigrationApp(
  options: BuildMigrationAppOptions,
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true })

  app.get('/health', () => ({ status: 'ok' }))

  app.post('/migrate', async (_request, reply) => {
    try {
      const migrations = await options.runMigrations()
      return { status: 'migrated', migrations }
    } catch {
      return reply.code(500).send({ status: 'migration_failed' })
    }
  })

  return app
}
