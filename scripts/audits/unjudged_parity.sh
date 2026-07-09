#!/usr/bin/env bash
# J-03 Unjudged Parity — offline forensic export.
#
# Pulls live rows from the Supabase Postgres via psql, hands them to DuckDB,
# replays the v5 tag-only "unjudged" math for every (judge × competition × round)
# combination provided, and writes a CSV report to /mnt/documents/.
#
# Usage:
#   scripts/audits/unjudged_parity.sh <competition_id> <round_number> [judge_id]
#
# If judge_id is omitted the script audits every assigned judge of that
# competition. Requires PG* env vars (sandbox managed-DB session).

set -euo pipefail

if [ -z "${PGHOST:-}" ]; then
  echo "PGHOST not set — this script needs an exec-DB-enabled session." >&2
  exit 2
fi

COMP_ID="${1:?competition_id required}"
ROUND="${2:?round_number required}"
JUDGE_ID="${3:-}"

OUT_DIR="/mnt/documents"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ELIG_CSV="/tmp/parity_eligible_${STAMP}.csv"
TAG_CSV="/tmp/parity_tagged_${STAMP}.csv"
JUDGES_CSV="/tmp/parity_judges_${STAMP}.csv"
REPORT_CSV="${OUT_DIR}/unjudged_parity_${COMP_ID}_r${ROUND}_${STAMP}.csv"

# 1. Judges in scope ----------------------------------------------------------
if [ -n "$JUDGE_ID" ]; then
  echo "judge_id" > "$JUDGES_CSV"
  echo "$JUDGE_ID" >> "$JUDGES_CSV"
else
  psql -c "COPY (
    SELECT judge_id::text FROM public.competition_judges
    WHERE competition_id = '${COMP_ID}'
  ) TO STDOUT WITH CSV HEADER" > "$JUDGES_CSV"
fi

# 2. Eligible photo set for this round (mirrors the RPC) ----------------------
if [ "$ROUND" = "1" ]; then
  psql -c "COPY (
    SELECT ce.id::text AS entry_id, gs.idx AS photo_index
    FROM public.competition_entries ce
    CROSS JOIN LATERAL generate_series(0, GREATEST(array_length(ce.photos, 1), 1) - 1) AS gs(idx)
    WHERE ce.competition_id = '${COMP_ID}'
      AND ce.status = 'submitted'
  ) TO STDOUT WITH CSV HEADER" > "$ELIG_CSV"
else
  PREV=$((ROUND - 1))
  psql -c "COPY (
    SELECT DISTINCT jpt.entry_id::text AS entry_id, jpt.photo_index
    FROM public.judge_photo_tags jpt
    JOIN public.judging_tags t ON t.id = jpt.tag_id
    JOIN public.competition_entries ce ON ce.id = jpt.entry_id
    WHERE ce.competition_id = '${COMP_ID}'
      AND jpt.round_number = ${PREV}
      AND (t.label ILIKE '%shortlist%' OR t.label ILIKE '%qualified%')
  ) TO STDOUT WITH CSV HEADER" > "$ELIG_CSV"
fi

# 3. All tags by all in-scope judges for this round ---------------------------
psql -c "COPY (
  SELECT jpt.judge_id::text, jpt.entry_id::text AS entry_id, jpt.photo_index
  FROM public.judge_photo_tags jpt
  JOIN public.competition_entries ce ON ce.id = jpt.entry_id
  WHERE ce.competition_id = '${COMP_ID}'
    AND jpt.round_number = ${ROUND}
) TO STDOUT WITH CSV HEADER" > "$TAG_CSV"

# 4. DuckDB parity replay -----------------------------------------------------
duckdb -c "
COPY (
  WITH judges AS (SELECT judge_id FROM read_csv_auto('${JUDGES_CSV}')),
       elig   AS (SELECT DISTINCT entry_id, photo_index FROM read_csv_auto('${ELIG_CSV}')),
       tags   AS (SELECT DISTINCT judge_id, entry_id, photo_index FROM read_csv_auto('${TAG_CSV}')),
       per_judge AS (
         SELECT j.judge_id,
                (SELECT count(*) FROM elig)                                          AS eligible_count,
                (SELECT count(*) FROM tags t
                   WHERE t.judge_id = j.judge_id
                     AND (t.entry_id, t.photo_index) IN (SELECT entry_id, photo_index FROM elig)
                )                                                                    AS tagged_count,
                (SELECT count(*) FROM elig e
                   WHERE NOT EXISTS (
                     SELECT 1 FROM tags t
                      WHERE t.judge_id = j.judge_id
                        AND t.entry_id = e.entry_id
                        AND t.photo_index = e.photo_index
                   )
                )                                                                    AS grid_unjudged
         FROM judges j
       )
  SELECT judge_id,
         '${COMP_ID}'                                AS competition_id,
         ${ROUND}                                    AS round_number,
         eligible_count,
         tagged_count,
         (eligible_count - tagged_count)             AS sidebar_unjudged,
         grid_unjudged,
         (eligible_count - tagged_count) - grid_unjudged AS drift,
         CASE WHEN (eligible_count - tagged_count) - grid_unjudged = 0
              THEN 'OK' ELSE 'DRIFT' END             AS verdict
  FROM per_judge
  ORDER BY drift DESC, judge_id
) TO '${REPORT_CSV}' (HEADER, DELIMITER ',');
"

echo "✓ Wrote ${REPORT_CSV}"
echo "Drift summary:"
duckdb -c "SELECT verdict, count(*) AS judges FROM read_csv_auto('${REPORT_CSV}') GROUP BY verdict;"

rm -f "$ELIG_CSV" "$TAG_CSV" "$JUDGES_CSV"
