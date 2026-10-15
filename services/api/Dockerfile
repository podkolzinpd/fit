FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json eslint.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

COPY --from=public.ecr.aws/docker/library/postgres:17@sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3 /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=public.ecr.aws/docker/library/postgres:17@sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3 /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends liblz4-1 libpq5 libzstd1 \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --omit=dev \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY certs/yandex-cloud-ca.pem ./certs/yandex-cloud-ca.pem
COPY db/migrations ./db/migrations

USER node
CMD ["node", "dist/server.js"]
