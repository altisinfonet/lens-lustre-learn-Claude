#!/usr/bin/env bash
# Local proof of 20261030_0702 on two lane-shaped fixtures (no remote database).
# Needs a scratch Postgres 16 reachable as PGHOST/PGPORT, user postgres (trust).
# Each lane: real table DDL from 0005 / 0002 / 0006 + the real 20261103_0300,
# then seed → PROBE (expect FAIL G1) → apply → PROBE (expect PASS)
# → rollback → PROBE (expect FAIL G1) → apply → PROBE (expect PASS).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
F=docs/evidence/d2/S7/vid6-fixture
M=supabase/migrations
core=$(mktemp)
{ cat $F/base.sql; sed -n 102,283p $M/20261005_0005_vid2_videos.sql
  sed -n 134,160p $M/20261012_0002_vid1_converter_sources.sql; sed -n 288,302p $M/20261005_0006_vid4_music_check.sql; } > "$core"
run() { PGOPTIONS="-c p32.lane=$1" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$2" 2>&1 | grep -E "PASS|FAIL|ERROR" | cut -c1-240; echo "  exit ${PIPESTATUS[0]}"; }
for lane in staging production; do
  echo "=== $lane"
  psql -U postgres -qc "DROP DATABASE IF EXISTS $lane" -c "CREATE DATABASE $lane"
  psql -U postgres -d $lane -v ON_ERROR_STOP=1 -q -f "$core" >/dev/null
  run $lane $M/20261103_0300_ops_alarms.sql >/dev/null
  run $lane $F/seed_$lane.sql >/dev/null
  echo "PROBE before:";  run $lane $M/PROBE_20261030_0702_s7_vid6_video_alarms.sql
  echo "apply:";         run $lane $M/20261030_0702_s7_vid6_video_alarms.sql
  echo "PROBE after:";   run $lane $M/PROBE_20261030_0702_s7_vid6_video_alarms.sql
  echo "rollback:";      run $lane supabase/rollback/20261030_0702_s7_vid6_video_alarms_ROLLBACK.sql
  echo "PROBE after rollback:"; run $lane $M/PROBE_20261030_0702_s7_vid6_video_alarms.sql
  echo "re-apply:";      run $lane $M/20261030_0702_s7_vid6_video_alarms.sql
  echo "PROBE:";         run $lane $M/PROBE_20261030_0702_s7_vid6_video_alarms.sql
done
rm -f "$core"
