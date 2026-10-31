---
name: Vocabulary Generator R6
description: docs/judging/vocabulary.md is auto-generated from vocabulary.source.json (snapshot of system_tag_decision_map ⋈ judging_tags). Never hand-edit. CI fails if stale.
type: constraint
---

# R6 — Judging Vocabulary

**Source of truth:** `public.system_tag_decision_map` ⋈ `public.judging_tags` (live DB).

**Pipeline:**
1. `scripts/snapshot-vocabulary.mjs` (nightly, service-role) writes
   `docs/judging/vocabulary.source.json`.
2. `scripts/generate-vocabulary.mjs` deterministically renders
   `docs/judging/vocabulary.md` from that JSON.
3. PR CI (`audit-forbidden.yml`) runs `bun run vocab:check` and fails if
   `vocabulary.md` does not match `render(vocabulary.source.json)`.
4. Nightly workflow `vocabulary-snapshot.yml` opens a PR when the live DB
   diverges from the committed JSON.

**Rules:**
- Never hand-edit `docs/judging/vocabulary.md` — file carries a
  do-not-edit banner.
- Adding a new system tag → row appears in `system_tag_decision_map`
  (admin migration) → next nightly run opens a PR. Manual refresh:
  `bun run vocab:snapshot && bun run vocab:generate`.
- PR CI must NEVER be wired to read the live DB (anon role has no SELECT
  policy on `system_tag_decision_map`; we deliberately avoid leaking
  service-role into PR jobs).
- Required GitHub secrets for the nightly workflow only:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Files:**
- `docs/judging/vocabulary.source.json` — committed snapshot
- `docs/judging/vocabulary.md` — generated (do not edit)
- `scripts/generate-vocabulary.mjs` — deterministic renderer + `--check`
- `scripts/snapshot-vocabulary.mjs` — DB → JSON (service role)
- `.github/workflows/audit-forbidden.yml` — staleness gate (PR)
- `.github/workflows/vocabulary-snapshot.yml` — nightly refresh PR
- `scripts/audits/vocabulary_generator_r6.md` — forensic audit

**Snapshot at landing:** 11 mapping rows across 4 rounds, all `is_system =
true`, decisions = {accept, shortlist, needs_verification, reject}.
