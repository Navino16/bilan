#!/bin/sh
# Prod image entrypoint (spec §5): migrate, seed, then hand PID 1 to the server.
set -eu

cd /opt/migrate
echo "bilan: applying database migrations"
node_modules/.bin/prisma migrate deploy
echo "bilan: seeding roles, permissions and default settings"
node prisma/seed.ts

cd /app
exec node server.js
