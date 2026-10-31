---
name: J-03 Unjudged Parity Audit
description: Forensic parity check — sidebar Unjudged counter vs grid filtered set per (judge, competition, round) under strict v5 tag-only rule. RPC + admin widget on /admin/health + DuckDB CSV exporter
type: feature
---

**Server**: `get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number int)` — admin/super_admin only, SECURITY DEFINER, STABLE. Returns one row with `eligible_count`, `tagged_count`, `sidebar_unjudged = eligible − tagged`, `grid_unjudged = |eligible \ tagged|`, `drift = sidebar − grid`, and `drift_photos jsonb` listing every untagged `(entry_id, photo_index)`.

**Eligible set**:
- Round 1: every photo of every `submitted` `competition_entries` row (expanded via `generate_series` over `photos`)
- Round 2+: every `(entry_id, photo_index)` any judge tagged with a label ILIKE `%shortlist%` or `%qualified%` in `round_number = current − 1` (any-judge-shortlist rule, mirrors round-close coverage gate)

**Judged predicate**: strict v5 — only `judge_photo_tags` row at `(judge_id, entry_id, photo_index, round_number)` counts. Decision/score deliberately excluded so the report flags any UI that still includes them.

**Surfaces**:
- `src/components/admin/UnjudgedParityAudit.tsx` mounted in `src/components/admin/AdminHealth.tsx` after `CertificateDriftAudit`. Inputs: judge uuid, competition uuid, round; outputs OK/Drift banner + 4 stat tiles + offending photo list.
- `scripts/audits/unjudged_parity.sh <competition_id> <round> [judge_id]` — pulls live rows via psql, replays the math in DuckDB, writes `/mnt/documents/unjudged_parity_<comp>_r<round>_<utc>.csv` per-judge with `verdict` column. Requires `PGHOST` (managed-DB exec session).

**Why drift can occur**: divergent filter logic between `useJudgePhotoData.getMyDecisionCounts` (sidebar) and `JudgePanel` filtered list (grid), or duplicate `judge_photo_tags` rows for one `(judge, entry, photo, round)`. Drift > 0 means sidebar over-counts; drift < 0 means grid over-counts.
