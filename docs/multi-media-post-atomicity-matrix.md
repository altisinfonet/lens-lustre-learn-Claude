# Multi-media Post Atomicity Matrix (B4 gate)

**Status:** COMPLETE — 20 rows executed on a faithful harness, 2026-08-14.
**Contract (FINAL PLAN, B4):** no half-publish · no duplicate post · no duplicate reference · no duplicate object · no orphans.
**Harness + transcripts:** `harness/b4/` (schema+seed, matrix, races, before/after transcripts).
**Regression lock:** `src/__tests__/postAtomicity.test.ts` (8 assertions, 8 mutations caught).

This matrix is a gate, not a document: every row below was executed, and the
verdict column records what the database actually did, not what the design
said it would do. Two rows failed. Both are fixed and re-proven; the fixes are
migrations `20260814234152` and `20260814234206`.

## Why two regimes

A member's post today is **one row** — `posts.image_urls` is a text array, so
multi-photo atomicity at the database is whatever a single INSERT gives you.
The media engine (`media_objects` + `post_media`, state machine, content
identity) is **built and applied but holds zero rows**; it goes live with the
B5 client switch. Both must be covered: B4 must not regress today's behaviour
and must satisfy tomorrow's.

## Regime 1 — today (posts.image_urls)

| # | Scenario | Verdict | Mechanism |
|---|---|---|---|
| R1 | Photo 2 of 3 fails to upload | **PASS (no half-publish)** — the whole attempt throws before any row is written; no post exists | client: `uploadPhotos` throws, `createPost` catches |
| R2 | Member retries after R1 | **WAS: duplicate objects.** Photos 1–2 re-uploaded under fresh names (keys are time+random), the first pair orphaned. **FIXED** — resume cache, see below | `WallPosts.tsx` `uploadedPhotoCache` |
| R3 | Two identical submits at the same instant (double-tap / two devices) | **WAS: FAIL — 2 identical posts.** Measured. **FIXED** by `20260814234152` | `detect_duplicate_post` + advisory lock |
| R3b | Same two submits, sequential (control) | PASS — refused | proves R3 was the overlap, not a broken guard |
| R3c | A *different* member posting identical content concurrently | PASS — not blocked (completed at t+1152 ms against a lock held to t+3000 ms) | lock key is (member, content) |
| R4 | Identical repost inside 10 minutes | PASS — refused | `content_hash` window |
| R4b | Same caption, different photos | PASS — allowed | hash covers the URLs; R4 is not over-broad |
| R5 | Post insert fails after all uploads succeed | Orphaned objects, no post — collected by the 30-day sweep under the Deletion Protocol | by design |
| R6 | Author swaps a published post's photos | PASS — refused | `enforce_post_caption_only_update` |
| R6b | Author edits the caption (control) | PASS — allowed | R6 is not vacuous |

## Regime 2 — media engine (applied, live at B5)

| # | Scenario | Verdict | Mechanism |
|---|---|---|---|
| R7 | Reference media still `pending` | PASS — refused | `tg_post_media_requires_ready` |
| R8a | `pending → ready` (skip verification) | PASS — refused | `tg_media_state_transition` |
| R8b | `pending → verified → ready`, then reference (control) | PASS — accepted | the machine permits the legal path |
| R8c | `ready → verified` (backwards) / `ready → quarantined` | PASS — refused / allowed | terminal quarantine |
| R9 | Same bytes uploaded twice by one owner | PASS — one object, same id returned | `UNIQUE (owner_id, sha256)` |
| R10 | Two concurrent `media_begin_upload`, same bytes | PASS — both converge on one object | `ON CONFLICT` + re-select |
| R11 | Re-upload of quarantined bytes | PASS — refused, no upload/refuse loop | `media_begin_upload` |
| R12 | Delete media that a post references | PASS — refused | `ON DELETE RESTRICT` |
| R13 | Delete the post | PASS — references cascade, media row survives as a sweep candidate | by design |
| R14 | 51st never-completed upload | PASS — refused | in-flight cap of 50 |
| R15 | Partial reference set (ords 0 and 2, hole at 1) | **GAP — accepted.** No publish gate exists: `posts` has no `status` column, so the design's "publish requires every ord" is unbuilt. Harmless today (nothing writes these tables); **a B5 requirement**, recorded not hidden | — |
| R16 | Same media twice in one carousel | **WAS: accepted.** **FIXED** by `20260814234206` | `UNIQUE (post_id, media_id)` |
| R17 | Takedown lands while a publish is in flight | **WAS: FAIL — a live post referenced quarantined bytes.** Measured. **FIXED** | `FOR UPDATE` + quarantine detaches references |
| R18 | Delete media while a publish referencing it is in flight | PASS — the delete waits, then fails; no dangling reference | FK RESTRICT under concurrency |

## The two failures, in plain terms

**Duplicate posts (R3).** The guard asked "does a duplicate already exist?"
and two simultaneous submits both got "no", because neither could see the
other's uncommitted row. A member double-tapping Post on a slow connection got
two identical posts. Now the two are serialised on a key made of that member
and that exact content — different members, and the same member posting
different photos, never wait on each other.

**Takedowns (R17).** A quarantine committing while a publish was in flight
left the taken-down photo on a live post. Now the publish holds the media row
while it checks, and the quarantine removes the photo from every post showing
it in the same transaction that takes it down.

## Open, and deliberately so

- **R15 publish gate** — needs `posts.status` (`pending_media → published`) and
  an all-ords-present check. Belongs to B5, where the two-phase publish first
  exists. Until then nothing writes `post_media`, so there is nothing to hole.
- **R5 orphans** — a post that dies after its uploads leaves objects behind.
  The sweep collects them at 30 days. Content-addressed keys (the B5 design)
  remove the class entirely; the resume cache removes the common case now.
