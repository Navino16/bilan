# Sourced by the perf scripts. Builds and secrets live outside the repo, in $BILAN_PERF_DIR.
PERF_DIR="${BILAN_PERF_DIR:-$HOME/.cache/bilan-perf}"
PERF_ENV="$PERF_DIR/perf.env"
mkdir -p "$PERF_DIR"

# The labels in budget_perf are encrypted with these keys: they live as long as the data set.
if [ ! -f "$PERF_ENV" ]; then
  {
    echo "DATABASE_URL=mysql://app:app_password@localhost:3307/budget_perf"
    echo "APP_URL=http://localhost:3410"
    for key in AUTH_SECRET DATA_ENCRYPTION_KEY SEARCH_TOKEN_KEY CRON_SECRET; do
      echo "$key=$(openssl rand -base64 32)"
    done
  } > "$PERF_ENV"
  chmod 600 "$PERF_ENV"
fi
export PERF_DIR PERF_ENV
