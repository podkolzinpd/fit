import Fastify, { type FastifyInstance } from 'fastify'

interface BuildAppOptions {
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  })

  app.get('/health', () => ({ status: 'ok' }))

  return app
}
