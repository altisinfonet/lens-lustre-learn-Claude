# P3 · the database half of the parity check — the publication exporter (D1)

**Gate (Addendum A, P3):** "parity check green on `staging`" — two producers and a comparator that fails the build in both directions; schema `schemaVersion: 1`, frozen by the Auditor "as is" (R-84 §3; `docs/evidence/d2/phase3/subscription-scan-schema.md`). **Export path:** `docs/evidence/d1/phase3/db-publication-export.json` (R-93, confirmed). D2's job `d2-p3-parity.yml` runs as soon as this file exists.

## What ships
| File | Role |
|---|---|
| `scripts/db-publication-export.sql` | the READING: read-only, one row, one JSON value — `supabase_realtime`'s members with replica identity, row filter and columns. Catalog metadata only; no table row, no secret |
| `scripts/db-publication-export.mjs` | the EXPORTER: reading → `{ producer: "db-publication-export", schemaVersion: 1, tables: [sorted, unique], counts, … }`. Bare names for `public` (the client scan's names), `schema.table` otherwise (never dropped). **Refuses** another publication, `FOR ALL TABLES`, an unknown lane, no read time, a nameless or duplicated entry, an unknown replica identity. `--check` regenerates an export from the reading it names and fails unless byte-identical |
| `.github/workflows/d1-p3-export.yml` | self-test (21 cases) + `--check` on every committed export — a hand-edited or stale export cannot reach D2's parity job |
| `readings/publication-production-20261004.json` | **production**, the Owner's run of `scripts/db-publication-export.sql`, 2026-10-04 16:47:41 UTC, saved **byte for byte** (replaces the TRANSCRIBED 2026-09-26 reading; same 29 tables, FULL = profiles, scheduled_posts) |
| `readings/publication-production-20261004.lane.json` | its lane record: `production` + the sha256 of the verbatim file (the SQL output carries no lane). Editing either file turns `--check` red |
| `readings/publication-staging-20261004.json` | **staging**, read by D1 with the `.sql` through the Supabase MCP, 2026-10-04 15:41:01 UTC, verbatim |
| `db-publication-export.json` | the export D2's job reads — **production** (the lane the app's listeners actually connect to) |
| `db-publication-export.staging.json` | the staging export, for the record (D2's job does not read it) |
| `p3-export-run-tests.sh` → `p3-export-transcript.txt` | C-34 harness |

## Fail first (transcript)
Seven hand-edits are red under `--check` (a table added to make parity pass, a table removed, the lane relabelled, the reading changed after the export, the verbatim reading edited, the lane record relabelled, the reading deleted); four bad readings are refused with their own message (another publication, `FOR ALL TABLES`, no lane, a duplicate). D2's unchanged `validate()` accepts both exports' shape.

## The reading (D2's comparator, unchanged)
| Export | Client tables | Published | Subscribed, NOT published | Published, NOT subscribed | Verdict |
|---|---|---|---|---|---|
| production (2026-10-04 16:47:41) | 29 | 29 | **9**: admin_notifications · admin_vote_adjustments · badge_definitions · judge_comments · judge_sessions · judge_tag_assignments · judging_preflight_log · role_display_config · site_settings | **9**: certificates · competitions · featured_artists · image_comments · image_reactions · journal_articles · photo_of_the_day · post_comments · post_shares | **FAIL** |
| staging (2026-10-04) | 29 | **0** | 29 | 0 | FAIL |

**The parity job on this PR is therefore RED, by design: it is the P3 gate reading, now produced by D1's exporter instead of D2's transcription, and it confirms F-D2-13 / F-D2-14.** P3 turns green only after the reconciliation, in both lanes' halves (R-84): D2 drops the dead listeners (P4 already moves the configuration tables off realtime), D1 drops the nine unsubscribed tables from the publication (a migration, production lane — the "published, not subscribed" column is WAL decoded for nobody, the P2 decode share). Staging publishes nothing at all (**F-P3-1**): staging cannot be the lane that proves parity until its publication is built from git; that is a decision for the Auditor.

## Asks
1. **Done (2026-10-05):** the Owner's production reading of 2026-10-04 16:47:41 UTC is committed verbatim and the export regenerated from it.
2. **Auditor:** rule on (a) merging this PR with D2's parity job red (the job is the gate's reading, not a regression), and (b) F-P3-1 — which lane the parity gate is judged on.
