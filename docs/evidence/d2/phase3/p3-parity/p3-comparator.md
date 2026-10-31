# P3 · the parity comparator (D2 half of the build gate)

**Gate (Addendum A, P3, D2 role text):** "a third script compares them and fails the build in both directions. The JSON
schema is frozen by the Auditor first; neither developer edits the other's producer."
**Schema:** `schemaVersion: 1`, frozen "as is" by the Auditor (MASTER R-84 §3) =
`docs/evidence/d2/phase3/subscription-scan-schema.md`.

## What ships
- `scripts/web-p3-parity.mjs` — reads the client reading (a fresh `scan("src")` by default) and D1's
  `db-publication-export` JSON; compares `tables`; **fails on subscribed-not-published AND on published-not-subscribed**.
  Refuses: wrong producer, schemaVersion ≠ 1, unsorted/duplicate `tables`, `counts.tables` mismatch, any unresolved
  client entry. No allowlist.
- `.github/workflows/d2-p3-parity.yml` — `self-test` job on every PR/push (self-test + `--strict` client scan);
  `parity` job runs whenever `docs/evidence/d1/phase3/db-publication-export.json` is committed. **Until then it shows
  SKIPPED, which is not a pass** — the gate closes only when it runs green.
- `src/__tests__/p3Parity.test.ts` — 16 tests.

## Fail-first, on real data (2026-10-04 10:45:54 UTC)
Client: `scan("src")` on staging `3408104` → 29 tables. Publication: the Owner's **production** reading of
`supabase_realtime`, 2026-09-26 18:50 UTC, as recorded in `docs/evidence/d1/phase2/replica-identity.md`, transcribed to
`publication-production-20260926.TRANSCRIBED.json` (labelled: NOT D1's exporter output). Exit 1:

| subscribed, NOT published (listener hears nothing) | published, NOT subscribed (WAL decoded for nobody) |
|---|---|
| admin_notifications · admin_vote_adjustments · badge_definitions · judge_comments · judge_sessions · judge_tag_assignments · judging_preflight_log · role_display_config · site_settings | certificates · competitions · featured_artists · image_comments · image_reactions · journal_articles · photo_of_the_day · post_comments · post_shares |

Full output: `failfirst-vs-production-20260926.txt` (file:line for every client-side table). Self-test 11/11.

## Findings
- **F-D2-13 (INFERRED from a 2026-09-26 reading):** 9 client listeners subscribe to tables production does not publish —
  incl. `site_settings` (`liveAdminSync.ts`), `role_display_config`, `badge_definitions`, `admin_notifications`. Those
  "live" updates never arrive on production. Re-confirm with D1's exporter before acting.
- **F-D2-14 (same reading):** 9 published tables have no client listener; each write to them is decoded by Realtime
  for nobody — a direct input to the P2 decode share.
- Reconciliation is both lanes: D2 drops dead listeners, D1 adds/drops publication members. Not in this PR.

## Asks
1. Auditor/D1: confirm the export path `docs/evidence/d1/phase3/db-publication-export.json` (one-line change here if not).
2. D1's exporter output must carry `producer: "db-publication-export"`, `schemaVersion: 1`, sorted unique `tables`.
