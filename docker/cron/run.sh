#!/bin/sh
# Calls one cron route on the app (spec §7). Non-zero exit on any HTTP error.
set -u
route="$1"
if body="$(wget -q -O - --post-data "" \
  --header "Authorization: Bearer $(cat /run/cron-secret)" \
  "http://app:3000/api/cron/$route" 2>&1)"; then
  echo "OK $route $body"
else
  echo "ERROR $route $body" >&2
  exit 1
fi
