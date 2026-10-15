FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json eslint.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

COPY --from=docker.io/library/postgres:17-bookworm@sha256:66aafa11cf15800a3c94763f7e11d1e7b2e37e5e84bc4ce027cb6e1e4bfaf4df /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=docker.io/library/postgres:17-bookworm@sha256:66aafa11cf15800a3c94763f7e11d1e7b2e37e5e84bc4ce027cb6e1e4bfaf4df /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends liblz4-1 libpq5 libzstd1 \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version \
  && pg_restore --version \
  && npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY certs/yandex-cloud-ca.pem ./certs/yandex-cloud-ca.pem
COPY db/migrations ./db/migrations

USER node
CMD ["node", "dist/server.js"]
