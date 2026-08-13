import Fastify, { type FastifyInstance } from 'fastify'

import type { DatabaseConnection, DatabasePool } from './db/types.js'

interface BuildAppOptions {
  databasePool?: DatabasePool
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  })

  app.get('/health', () => ({ status: 'ok' }))

  app.get('/ready', async (_request, reply) => {
    if (options.databasePool === undefined) {
      return reply.code(503).send({ status: 'not_ready' })
    }

    let connection: DatabaseConnection | undefined
    try {
      connection = await options.databasePool.connect()
      await connection.query('select 1')
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    } finally {
      connection?.release()
    }
  })

  if (options.databasePool !== undefined) {
    app.addHook('onClose', async () => options.databasePool?.end())
  }

  return app
}
