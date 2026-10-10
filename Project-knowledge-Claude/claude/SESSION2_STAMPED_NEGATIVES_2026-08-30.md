# Session 2 — every published negative, with its as-of time

Emitted 2026-08-30T17:33:45Z. **No new measurement.** Every row restates a result already published, adding the
timestamp it was actually observed at. `computed_at` is the mtime of the artefact that produced it;
no value was recomputed to make this register.

## The two snapshots every row is relative to

| snapshot | as-of |
|---|---|
| **Deployed** — ACTIVE version of each of the 71 functions, Supabase Functions API, project `jtdtehuqtinjxropkkcn` | fetched **2026-08-30 13:47Z – 14:03Z**; ten functions independently re-fetched **15:40Z – 16:05Z** and found byte-identical |
| **Repository** — clone of `altisinfonet/lens-lustre-learn-Claude` | staged **13:46Z**; fully fetched (226 refs) **15:36Z**; confirmed identical to origin's 119 branch heads **16:07Z** |

A negative about production is only as good as the deployed snapshot. A negative about the repository
is only as good as the last fetch. Both move without me.

## Register

| # | negative, as published | instrument | computed_at (UTC) |
|---|---|---|---|
| N1 | **0 of 71** deployed bundles carry a storage-lane assertion (D1 `assertStorageLane` in code, or D2 lane constants) | `tool/lanecheck.py` | **16:09:02Z** |
| N2 | **0 of 71** fire D2b — a `throw` within 400 chars of `bucket_name`/`public_url`/`endpoint` | `tool/lanecheck.py` | **16:09:02Z** |
| N3 | **0 of 73** repository bundles at `main` `b671e1fb` fire the lane detector (positive control: 12 of 73 fire at the RC) | `tool/lanecheck.py` | **16:09:17Z** |
| N4 | Of the ten deployed bundles that reference the object store in code, **none** carries a lane assertion | `tool/lanecheck.py` + code-symbol scan | **16:10:07Z** |
| N5 | **0 provable hybrids** — no bundle's committed files are inconsistent with every single committed state | `tool/atomicity.py` | **15:55:51Z** |
| N6 | For each of the ten non-atomic bundles, the intersection over its *committed* files is **non-empty** — none is a proven mix | `tool/atomicity.py` | **15:57:34Z** |
| N7 | **No** function matches the RC but not `main` | `tool/run.py` | **14:13:04Z** |
| N8 | **No** deployed function is absent from the repository at `main` (repo-only: `backfill-media-objects`, `media-verify-upload`) | `git ls-tree` vs `list_edge_functions` | **14:13:04Z** |
| N9 | CORS class differs between deployed and repository at `main` for **no** function | `tool/cors.py`, both sides | **14:13:04Z** |
| N10 | `Access-Control-Allow-Credentials` is set in **0 of 71** bundles | `tool/cors.py` | **14:13:04Z** |
| N11 | **0 lexer errors** across 393 files (deployed + `main` + RC) | `tool/lex.py` | **15:53Z** (post-fix run) |
| N12 | **0 unresolved import specifiers** across all 71 bundles | `tool/bundle.py`, after the `_shared` hoist rule | **15:54Z** |
| N13 | Self-test: **0 failures** (21 assertions) | `tool/selftest.py` | **16:09:43Z** |
| N14 | **16 of 183** deployed files hash to **no** object in the clone — i.e. no committed origin | `git hash-object` over 122 refs | **14:14:46Z** |
| N15 | Same check after the full fetch (226 refs): still **16**, byte-for-byte the same files — staleness explains **none** of them | as N14, post-fetch | **15:37:07Z** |
| N16 | Same check again after `git fetch --all --tags --prune` run verbatim: still **16** | as N14 | **16:05Z** |
| N17 | **14 of 183** after removing the deploy-rewrite case and the filler-run case | `tool/atomicity.py` + run-length probe | **15:56:28Z** |
| N18 | Clone vs origin: **no** ref present remotely but absent locally, and **no** ref differing in sha, across 119 branch heads | `git ls-remote` + `for-each-ref` | **16:07Z** |
| N19 | Dual-courier control: **0 disagreements** over 19 files | `cmp` over two independent transcriptions | **14:03Z** |
| N20 | Three-way transcription control: **0 disagreements** over 45 files | `cmp` over three independent transcriptions | **16:05Z** |
| N21 | GitHub REST API: **no** repository permission — `GET /repos/altisinfonet/*` returns 403 | `curl` | **13:44Z** — **still true at 16:07Z**; the git protocol is not blocked |
| N22 | Supabase Management API over HTTPS: **no** access token in this environment — 401 | `curl` | **13:44Z** |
| N23 | Developer 1's TSV carries **no** row valued `UNKNOWN` | join script over `951a2cfd…59da` | **16:43:26Z** |
| N24 | Pass 1 at E3, strict: **no** function is MATCH for Developer 1 and not for me | join script | **16:43:26Z** |
| N25 | Pass 1 at E3, `imap_excluded`: symmetric difference **empty in both directions** | join script | **16:43:26Z** |
| N26 | Pass 2: symmetric difference **empty in both directions** | join script | **16:43:26Z** |

## One negative already withdrawn

| | |
|---|---|
| claim | "`claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv` is still empty" |
| as-of | **16:38Z** — true at that instant |
| superseded | the file was created **16:45:12Z** |
| defect | I published it in the present tense with no as-of time. That is the error this register exists to prevent, and it was mine. |

## Standing caveat on all of the above

Every negative here is a statement about a snapshot, not about the world. A deploy, a push, or a
merge invalidates the relevant rows without notice and without changing this document. Re-run
`tool/run.py`, `tool/atomicity.py`, `tool/lanecheck.py` and `tool/selftest.py` against a fresh
snapshot before quoting any row as current.
