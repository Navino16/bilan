#!/usr/bin/env bash
# Production build of a commit, served like the Docker image: see docs/development.md.
# Usage: scripts/perf/build.sh [<ref>|.]   ("." = the working tree, uncommitted changes included)
# Prints the build directory on the last line. A commit already built is reused.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/perf/env.sh

REF="${1:-HEAD}"
if [ "$REF" = "." ]; then
  DIR="$PERF_DIR/builds/worktree"
else
  DIR="$PERF_DIR/builds/$(git rev-parse --short=12 "$REF^{commit}")"
  if [ -f "$DIR/.built" ]; then echo "$DIR"; exit 0; fi
fi

rm -rf "$DIR"
mkdir -p "$DIR"
if [ "$REF" = "." ]; then
  # Tracked and untracked files minus the ignored ones (.env, samples/, node_modules...).
  git ls-files -z --cached --others --exclude-standard |
    tar --null --ignore-failed-read -T - -cf - 2>/dev/null | tar -xf - -C "$DIR"
else
  git archive "$REF" | tar -xf - -C "$DIR"
fi

cd "$DIR"
npm ci --prefer-offline --no-audit --no-fund >&2
npx prisma generate >&2
set -a
. "$PERF_ENV"
set +a
# next/font downloads the Google fonts at build time: retry a flaky network.
for attempt in 1 2 3; do
  NODE_ENV=production npx next build >&2 && break
  [ "$attempt" -lt 3 ] || exit 1
  echo "next build failed, retrying ($attempt/3)" >&2
done
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
rm -f .next/standalone/.env
touch .built
echo "$DIR"
