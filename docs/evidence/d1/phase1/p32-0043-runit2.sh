#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# The "Run it" step of .github/workflows/apply-migration.yml, EXTRACTED so a
# file can be exercised through the real dispatch path instead of through a
# paraphrase of it.
#
# The body below is the workflow's step verbatim as of PR #293 (R-13), with two
# differences, both stated rather than hidden:
#   * DB_URL is a local scratch connection, so the pooler-port gate would
#     always refuse it. The port check is kept and run against a SIMULATED port
#     supplied in POOLER_PORT (default 5432), so the gate is still exercised —
#     it is just not asked about a credential that has no pooler.
#   * no secret is read and none is printed. This harness never touches a
#     connection string for staging or production.
#
# Everything that matters is unchanged: the lane `case`, the port refusals, and
# the single psql session that does `-c "SET p32.lane = '<lane>';"` and then
# `-f <file>`. That one-session ordering IS the R-13 interlock; a harness that
# set the GUC some other way would be testing something else.
#
#   TARGET_LANE=staging ./p32-0043-runit2.sh <db> <file> [POOLER_PORT]
#
# This is the same extraction that ships with 20260910_0037 as
# p1-0037-runit2.sh. Each unit is one self-contained PR off staging and 0037
# has not landed yet, so the copy travels with this one. When both are merged
# they should be reduced to a single file; recorded here rather than left for
# a reader to notice.
# Exit status is psql's, or 1 for a refusal.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

DB="${1:?usage: TARGET_LANE=<lane> $0 <db> <file> [pooler_port]}"
MIGRATION_PATH="${2:?usage: TARGET_LANE=<lane> $0 <db> <file> [pooler_port]}"
POOLER_PORT="${3:-5432}"
TARGET_LANE="${TARGET_LANE-}"

# ── The lane, re-asserted at the point of use. ──────────────────
case "$TARGET_LANE" in
  staging|production) : ;;
  *) echo "::error::Unknown target '$TARGET_LANE' at the point of use. Refusing."; exit 1 ;;
esac

# ── Pooler mode. The same three refusals, against the simulated port. ───
PORT="$POOLER_PORT"
if [ -z "$PORT" ]; then
  echo "::error::Could not parse a port from the credential. Expected postgres://postgres.<ref>:<password>@<host>:<port>/postgres. Refusing rather than guessing."
  exit 1
fi
echo "Credential port: $PORT"
if [ "$PORT" = "6543" ]; then
  echo "::error::transaction-mode pooler cannot carry p32.lane; the Environment secret must use the session pooler (5432)"
  exit 1
fi
if [ "$PORT" != "5432" ]; then
  echo "::error::Unexpected port '$PORT'. This workflow requires the session pooler on 5432 — see the setup notes at the top of this file. Refusing."
  exit 1
fi

echo "Asserting p32.lane = '$TARGET_LANE' for this session, then running the file."
psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "$DB" \
  --set ON_ERROR_STOP=1 \
  --echo-errors \
  --no-psqlrc \
  -c "SET p32.lane = '${TARGET_LANE}';" \
  -f "$MIGRATION_PATH"
