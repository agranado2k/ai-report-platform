#!/usr/bin/env bash
# infra/terraform/scripts/tf.sh
#
# Wrapper around `terraform <command>` that:
#   1. Sources `.tfvars.local` for bootstrap credentials.
#   2. Generates a per-env partial backend config and invokes `init` with it.
#   3. Acquires a Postgres advisory lock on Neon before any state-mutating
#      command (plan / apply / destroy / etc.) and releases it on exit.
#
# Why the PG lock? R2 has no DynamoDB-equivalent for the standard Terraform
# `s3` backend lock. We reuse Neon (which we're already paying for) as the
# coordination point. See ADR-018.
#
# Usage:
#   tf.sh <env> <terraform-command> [args...]
#
#   env:      prod | staging | shared
#   command:  init | plan | apply | destroy | output | console | state | ...
#
# Example:
#   tf.sh shared init
#   tf.sh staging plan -out=tf.plan
#   tf.sh staging apply tf.plan
#   tf.sh prod  apply

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Argument parsing ─────────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
  cat <<USAGE >&2
Usage: tf.sh <env> <terraform-command> [args...]
  envs:     prod | staging | shared
  commands: init | plan | apply | destroy | output | console | state | ...

Examples:
  tf.sh shared init
  tf.sh staging plan -out=tf.plan
  tf.sh prod apply
USAGE
  exit 2
fi

ENV="$1"
CMD="$2"
shift 2

case "$ENV" in
  prod | staging | shared) ;;
  *)
    echo "Unknown env: $ENV (expected: prod | staging | shared)" >&2
    exit 2
    ;;
esac

ENV_DIR="$TF_DIR/envs/$ENV"
if [[ ! -d "$ENV_DIR" ]]; then
  echo "Env directory not found: $ENV_DIR" >&2
  echo "Phase 0b will scaffold these. For now only the bootstrap is wired." >&2
  exit 2
fi

# ─── Load credentials ─────────────────────────────────────────────────────
# `.tfvars.local` is optional: source it if present (local operator flow),
# otherwise rely on env vars already being set (CI flow — GitHub Actions
# injects secrets directly into the environment). The required-var checks
# below catch the "missing config" case in both modes.
TFVARS_LOCAL="$TF_DIR/.tfvars.local"
if [[ -f "$TFVARS_LOCAL" ]]; then
  # shellcheck source=/dev/null
  set -a
  source "$TFVARS_LOCAL"
  set +a
fi

: "${PG_LOCK_URL:?PG_LOCK_URL not set (Neon connection string for advisory lock)}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID not set (Cloudflare account id)}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID not set (R2 access key id)}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY not set (R2 secret access key)}"

# ─── Backend config (per-env, temp file) ──────────────────────────────────
BACKEND_FILE="$(mktemp)"
cleanup_backend_file() { rm -f "$BACKEND_FILE"; }
trap cleanup_backend_file EXIT INT TERM

cat >"$BACKEND_FILE" <<EOF
key = "$ENV.tfstate"
endpoints = {
  s3 = "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
}
EOF

# ─── Postgres advisory lock (for state-mutating commands only) ────────────
LOCK_KEY="tf-$ENV"

needs_lock() {
  case "$1" in
    apply | destroy | plan | import | state | taint | untaint | refresh) return 0 ;;
    *) return 1 ;;
  esac
}

acquire_lock() {
  local got
  # Preflight: distinguish "can't reach the lock host" from "lock held". Without
  # this, a stale/unreachable PG_LOCK_URL makes psql fail and the `|| echo "f"`
  # below silently reports it as contention — a connectivity/credentials problem
  # then masquerades as a stuck lock (which wedged the apply chain for hours
  # once the lock host's old Neon project was deleted, 2026-06). Fail loud and
  # specific instead.
  if ! psql "$PG_LOCK_URL" -qAt -c "SELECT 1" >/dev/null 2>&1; then
    echo "ERROR: cannot connect to PG_LOCK_URL (the advisory-lock host)." >&2
    echo "  This is a connectivity/credentials problem, NOT lock contention." >&2
    echo "  Verify the connection string points at a live Neon endpoint:" >&2
    echo "    psql \"\$PG_LOCK_URL\" -c \"SELECT 1\"" >&2
    echo "  Prefer the DIRECT endpoint host (no '-pooler') for the lock." >&2
    return 1
  fi

  got=$(psql "$PG_LOCK_URL" -qAt -c \
    "SELECT pg_try_advisory_lock(hashtext('$LOCK_KEY'))" 2>/dev/null || echo "f")
  if [[ "$got" == "t" ]]; then
    return 0
  fi

  echo "Lock '$LOCK_KEY' is held by another tf.sh invocation. Waiting up to 60s..." >&2
  psql "$PG_LOCK_URL" -qAt -c \
    "SET lock_timeout = '60s'; SELECT pg_advisory_lock(hashtext('$LOCK_KEY'))" \
    >/dev/null 2>&1 || {
    echo "" >&2
    echo "Failed to acquire lock '$LOCK_KEY' within 60s." >&2
    echo "Inspect with:" >&2
    echo "  psql \"\$PG_LOCK_URL\" -c \"SELECT * FROM pg_locks WHERE locktype='advisory';\"" >&2
    echo "If it's stale, terminate the holding backend (advisory-unlock from a" >&2
    echo "different session is a no-op — the lock is owned by its acquiring session):" >&2
    echo "  psql \"\$PG_LOCK_URL\" -c \"SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory';\"" >&2
    return 1
  }
}

release_lock() {
  psql "$PG_LOCK_URL" -qAt -c \
    "SELECT pg_advisory_unlock(hashtext('$LOCK_KEY'))" >/dev/null 2>&1 || true
}

if needs_lock "$CMD"; then
  echo "Acquiring advisory lock '$LOCK_KEY' on Neon..." >&2
  acquire_lock
  # Combine cleanup: release the lock and remove the temp file on exit.
  trap 'release_lock; cleanup_backend_file' EXIT INT TERM
fi

# ─── Invoke terraform ─────────────────────────────────────────────────────
cd "$ENV_DIR"

case "$CMD" in
  init)
    terraform init -backend-config="$BACKEND_FILE" "$@"
    ;;
  *)
    terraform "$CMD" "$@"
    ;;
esac
