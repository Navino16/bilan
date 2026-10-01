# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Dev runs on glibc (Debian) so the host's bind-mounted node_modules
# (built on the WSL/glibc host) are binary-compatible — native modules
# like Prisma engines would break under alpine/musl.
FROM node:24 AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time-only dummy env: `next build` evaluates server route modules (e.g.
# /api/auth) that import the Prisma db and run env validation. No DB/secret is
# used at build (the adapter connects lazily); real values are injected at
# runtime. These ENV vars do not reach the final image (prod stage is FROM base).
ENV APP_URL=http://localhost:3000
ENV DATABASE_URL=mysql://app:app_password@localhost:3306/budget
ENV AUTH_SECRET=build_time_dummy_secret_padding_padding_padding
ENV DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENV SEARCH_TOKEN_KEY=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate || true
RUN npm run build

# Self-contained migrate + seed toolkit (spec §4): independent of what Next copies
# into the standalone node_modules.
FROM base AS migrator
WORKDIR /opt/migrate
COPY package-lock.json /tmp/package-lock.json
RUN locked() { node -p "require('/tmp/package-lock.json').packages['node_modules/$1'].version"; } \
  && echo '{"private":true,"type":"module"}' > package.json \
  && npm install --no-audit --no-fund \
    "prisma@$(locked prisma)" \
    "dotenv@$(locked dotenv)" \
    "@prisma/client@$(locked @prisma/client)" \
    "@prisma/adapter-mariadb@$(locked @prisma/adapter-mariadb)" \
  && npm cache clean --force
COPY prisma.config.ts ./
COPY prisma/schema.prisma prisma/seed.ts ./prisma/
COPY prisma/migrations ./prisma/migrations
RUN DATABASE_URL=mysql://build:build@localhost:3306/build node_modules/.bin/prisma generate

FROM base AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migrator --chown=nextjs:nodejs /opt/migrate /opt/migrate
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/bilan-entrypoint
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENTRYPOINT ["bilan-entrypoint"]
