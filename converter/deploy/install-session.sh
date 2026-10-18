#!/bin/bash
# 50mm Retina World · install a seeded converter session on the VM (live CAPTCHA, 2026-10-18).
#
#   node seed-session.mjs --url https://<ref>.supabase.co | ssh <vm> sudo bash ~/converter-deploy/deploy/install-session.sh --lane live
#   bash install-session.sh --validate-only < file      (checks the input only; no root, changes nothing)
#
# stdin: exactly what converter/tools/seed-session.mjs prints — {"refresh_token":"…"} — and
# nothing else (at most 4 KB read). The token is never put on a command line, never echoed,
# never logged: it goes from stdin through a pipe into a 0600 file the lane's WORKER writes
# (root never writes through a name in the worker's own directory — re-review N1).
#
# --lane is required (no default): the token must land in the lane it was made for.
# What it does, for that lane only:
#   1. stops the worker unit (so it cannot rotate the old session while the file is replaced)
#   2. as the worker user, umask 077: writes <base>/state/session.json.seed.<pid>, syncs it,
#      renames it over <base>/state/session.json
#   3. checks it is a regular file, <worker>:<worker> 0600
#   4. starts the worker unit again (if it is enabled or was running) — its first sign-in is
#      then a refresh grant with this token (no password, no CAPTCHA)
set -euo pipefail
set +x

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lane-lib.sh
. "$here/lane-lib.sh"
lane=""
validate_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lane) lane="${2:-}"; shift 2 ;;
    --validate-only) validate_only=1; shift ;;
    *) echo "install-session: unknown argument" >&2; exit 2 ;;
  esac
done

# Read the input (at most 4 KB) and accept only the seed tool's exact shape.
json="$(head -c 4096 | tr -d '\r')"
json="${json%$'\n'}"
re='^\{"refresh_token":"([A-Za-z0-9_.-]+)"\}$'
if [[ ! "$json" =~ $re ]] || (( ${#BASH_REMATCH[1]} < 12 || ${#BASH_REMATCH[1]} > 1024 )); then
  json=""
  echo "install-session: REFUSED — stdin is not {\"refresh_token\":\"…\"} from seed-session.mjs (nothing changed)" >&2
  exit 2
fi
if [[ $validate_only -eq 1 ]]; then json=""; echo "install-session: input is valid (nothing changed)"; exit 0; fi

[[ -n "$lane" ]] || { json=""; echo "install-session: REFUSED — --lane staging|live is required (nothing changed)" >&2; exit 2; }
lane_vars "$lane" || { json=""; exit 2; }
[[ $EUID -eq 0 ]] || { json=""; echo "install-session: run as root (sudo)" >&2; exit 1; }
id -u "$WORKER_USER" >/dev/null 2>&1 || { json=""; echo "install-session: $WORKER_USER does not exist — run setup.sh --lane $LANE first" >&2; exit 1; }
state="$BASE/state"
[[ -d "$state" && ! -L "$state" && "$(stat -c '%U:%G %a' -- "$state")" == "$WORKER_USER:$WORKER_USER 700" ]] \
  || { json=""; echo "install-session: $state is not $WORKER_USER:$WORKER_USER 0700 — run setup.sh --lane $LANE first" >&2; exit 1; }
file="$state/session.json"

was_active=0
systemctl is-active --quiet "$UNIT" && was_active=1
echo "install-session: stopping $UNIT (lane $LANE)"
systemctl stop "$UNIT"

# The worker writes its own file; the token travels on stdin only (printf is a bash builtin: no argv).
# shellcheck disable=SC2016  # $1 is expanded by the inner sh, as the worker
printf '%s' "$json" | runuser -u "$WORKER_USER" -- sh -c 'umask 077; t="$1.seed.$$"; cat > "$t" && sync "$t" && mv -f "$t" "$1" && sync "$(dirname "$1")"' sh "$file"
json=""

if [[ -f "$file" && ! -L "$file" && "$(stat -c '%U:%G %a' -- "$file")" == "$WORKER_USER:$WORKER_USER 600" ]]; then
  echo "install-session: $file written ($WORKER_USER:$WORKER_USER 0600)"
else
  echo "install-session: FAILED — $file is not a $WORKER_USER 0600 regular file" >&2
  exit 1
fi

if [[ $was_active -eq 1 ]] || systemctl is-enabled --quiet "$UNIT" 2>/dev/null; then
  systemctl start "$UNIT"
  echo "install-session: $UNIT started — watch for a worker.start line and NO auth.reseed_required:"
  echo "  journalctl -u $UNIT -n 30 --no-pager"
else
  echo "install-session: $UNIT is not enabled; start it when ready: sudo systemctl enable --now $UNIT"
fi
