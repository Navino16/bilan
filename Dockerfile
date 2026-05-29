# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

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

FROM base AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
