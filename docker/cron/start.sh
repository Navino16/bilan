#!/bin/sh
# Cron service command: a failing first call exits, so a wrong secret
# shows as a restart loop.
set -eu
if [ -z "${CRON_SECRET:-}" ]; then
  echo "ERROR CRON_SECRET is empty" >&2
  exit 1
fi
# busybox crond does not pass the container environment to its jobs.
umask 077
printf '%s' "$CRON_SECRET" >/run/cron-secret

sh /opt/cron/run.sh purge-imports
cp /opt/cron/crontab /etc/crontabs/root
exec crond -f -l 8
