# PHASE 2 — ITEM D: ORPHAN DETECTION UNDERSTANDS THE MEDIA GRAPH

**Date:** 2026-08-19 · **Status: ITEM D — COMPLETE** · Read-only audit → implement → test → mutate → measure → deploy → verify.
**Nothing was deleted from storage. No client grant was issued. No schema, fence, manifest or RLS change. Phase 3 not started.**

---

## THE DEFECT, IN ONE SENTENCE

`detect-orphan-files` decided which stored objects are live by enumerating **url columns**, chiefly `posts.image_urls`.
Phase 2 created a **second representation of media ownership** — `post_media → media_objects.derivatives → storage` — and the scan could not see it.

Two live paths produce storage keys that appear in **no url column at all**:

| path | what it writes | visible to the old scan? |
|---|---|---|
| `post_publish_with_media` (20260815041256) | a post with `image_urls = '{}'`, all media in `post_media` | **no** |
| `media-verify-upload` | originals at `post-images/<owner>/media/<media_id>/original.<ext>` | **no** |

Every such object would have been classified an orphan at 30 days and offered for deletion.

### Why it has not bitten yet — and why that is not comfort

All 228 `media_objects` in production were created **by the Phase 2 migration, from `posts.image_urls`**. So every
`derivatives.original` happens to also be an `image_urls` entry. Measured 2026-08-19:

```
derivative values                       228
values invisible to the OLD model         0     ← the accident
old-model key set                       577
new-model key set                       577     ← today's change is a NO-OP
```

The first post published through the new write path ends that accident **silently**. This cycle had to land before that, which is the same repair-order rule the 2026-08-14 rewrite was written under.

---

## THE ASYMMETRY THAT GOVERNS EVERY DECISION

```
FALSE ORPHAN      a live file omitted from the set   CATASTROPHIC — no undo
FALSE NON-ORPHAN  a dead file kept in the set        merely wasteful
```

Every ambiguity resolves toward **retention**; anything unclassifiable is **surfaced**, never dropped.

---

## D1 — AUDIT (read-only)

Repository-wide sweep for every orphan implementation, on the assumption there is more than one.

| component | verdict |
|---|---|
| `supabase/functions/detect-orphan-files/index.ts` | **the target.** v23, `ezbr a78f9b17…`, 25 url-column tables + 3 snapshot tables. Read-only, admin-only. |
| `supabase/functions/purge-s3-orphans/index.ts` | **does NOT consume the detector's verdict.** Independent model: `competition-photos/<uuid>/` folders whose uuid is not a live competition/entry id. `post-images/` is outside its prefix. Deletion Protocol enforced. |
| `src/__tests__/orphanReferenceSet.test.ts` | source-level assertions on the reference list |
| `src/lib/__tests__/imageLadder.test.ts` | pins the `-l3` rung derivation to the scan |
| `src/components/admin/AdminHealth.tsx` | the only caller. Read-only button; the purge button is dry-run only. |
| `cron.job` | **no `detect-orphan-files` cron exists.** Admin-button only. (`detect-orphan-files-weekly` in the docs was a plan, never created.) |
| `backfill-image-dims` | renames files in `posts.image_urls` and does **not** update `media_objects.derivatives` → can leave derivatives naming the pre-rename key. Retention-biased under the new model; recorded as a follow-up, not a blocker. |
| `backfill-media-objects`, `media-verify-upload` | **not deployed.** So the media-only state is not reachable in production today. |

Data-flow: `REFERENCE_COLUMNS` → `addUrls` (paginated, fail-loud) → `referencedPaths` → `-l3` rung derivation → Supabase-Storage listing + R2 `ListObjectsV2` → age ≥ 30 days → report.

---

## D2 — THE MODEL (12 states)

| # | state | verdict |
|---|---|---|
| S1 | named only by `posts.image_urls` | not an orphan |
| S2 | named by both image_urls and derivatives | not an orphan |
| S3 | **named ONLY by `media_objects.derivatives`** | **not an orphan** ← the whole cycle |
| S4 | new upload key `…/media/<id>/original.webp` | not an orphan |
| S5 | non-`original` rungs (1440 / 1080 / 600) | not an orphan |
| S6 | in-flight (`pending`/`verified`, empty derivatives) — key **derived** | not an orphan |
| S7 | `quarantined` with zero references (quarantine DETACHES by design) | not an orphan |
| S8 | `ready` with no `post_media` row | not an orphan, but **counted** |
| S9 | derivative written as a full CDN URL | normalises to the same key |
| S10 | derivative unresolvable to a managed bucket | **retained AND reported** |
| S11 | `-l3` key arriving via media_objects | both rung addresses derived |
| S12 | nothing in the database names it | **IS an orphan** ← positive control |

Three retention rules, each against a real failure mode: every derivative value counts; every state counts; a row with no `post_media` reference still counts.

---

## D3 — IMPLEMENTATION

**New:** `supabase/functions/_shared/referenceSet.ts` — `BUCKETS`, `extractPath` (moved verbatim), `originalKeyFor`, `mediaReferenceKeys`. The rules live in a plain module so the tests **execute the code the scan runs** instead of grepping it.

**Changed:** `detect-orphan-files/index.ts`
- `addMediaReferences()` — paginated, **fail-loud**, queued into the same `Promise.all` as the url-column reads. Selects `id,owner_id,mime,state,derivatives`; **never `sha256`**.
- `addPostMediaCoverage()` — reports which media objects no post points at. **Never an orphan test.**
- new `media_graph` report block: rows scanned, keys added, rows by state, derived in-flight keys, media without post reference, unresolved values + sample.
- `scope_warning` now states both representations per run.

---

## D4/D5 — TESTS AND MUTATION

`src/__tests__/orphanMediaReferenceSet.test.ts` — 26 tests: the 12 states as **real function calls**, awkward-input handling, wiring assertions, and the `originalKeyFor` pair lock against `media-verify-upload`.

`tools/mutate-orphan-media.mjs` — **17/17 detected.** Mutation 1 is the whole cycle: unwire the media graph → suite RED.

> **Mutation 4 initially escaped.** `if (error) { …400 chars… throw` is satisfied by `if (error) { break; } if (false) { throw`. Both the new assertion **and the pre-existing one in `orphanReferenceSet.test.ts`** were tightened so the throw must be *first* in the error branch. A weak assertion in a deletion safety list, found by the harness rather than by luck.

**Full suite: 2042 passed · 1 skipped · 160 files** (was 2016 / 159).

---

## D6 — PERFORMANCE

| read | time | buffers |
|---|---|---|
| `media_objects` (5 cols) | 21.3 ms | 23 |
| `post_media` (1 col) | 4.3 ms | 5 |
| *existing* `posts` read, for scale | 40.6 ms | 72 |

Both run concurrently with the 28 reads already in the scan. CPU: 4.1 ms at 228 rows; 908 ms at 100 000 rows — linear, against a scan that already reads ~114 MiB from R2.

---

## D7/D8 — DEPLOYMENT

```
detect-orphan-files   version 24   ACTIVE   verify_jwt true
ezbr_sha256  533ac1bc4c18c579909502eadf43c72d23febc908b26d78ce029eac185e2f8ee   (was a78f9b17…, v23)
payload: detect-orphan-files/index.ts + _shared/s3.ts + _shared/referenceSet.ts
         directory structure preserved, so `../_shared/*.ts` needs NO import rewrite
```

Commit `32692e4` on `origin/main` (PR #74, squash). **Local tree == origin/main tree = `efb0206c144afd0ce553e724f2ba09cc7de11282`.**

CI on `main` @ `32692e4`: **Typecheck ✅ · Web build ✅ · Security ✅ · UI gate ✅ (7m 08s) · Cloudflare Pages ✅.**

| file | blob |
|---|---|
| `supabase/functions/_shared/referenceSet.ts` | `8f07bf09438159ab8c98e0bb3908c08175259cdb` |
| `supabase/functions/detect-orphan-files/index.ts` | `edf56b24c5c232b8b79c825252c694fee2be6a03` |
| `src/__tests__/orphanMediaReferenceSet.test.ts` | `ad62adc9dc8ab756a7f2060f309b8cdef8d1ba98` |
| `src/__tests__/orphanReferenceSet.test.ts` | `95a69f841d93c4dc9adb1e94f48033dd64759915` |
| `tools/mutate-orphan-media.mjs` | `36fba3996b39200b39ef4751156bd853e6dbb51f` |

---

## D9 — INDEPENDENT PRODUCTION VERIFICATION

**The counterfactual, run against real production data inside a rolled-back transaction:** a post with `image_urls = '{}'` plus one `media_objects` row at the new upload key.

```
probe key            post-images/00af64a6…/media/30e56090…/original.webp
resolves to bucket   true
visible to OLD model FALSE   ← would have been deleted at 30 days
visible to NEW model TRUE
```

**Rolled back and verified non-persistent:**

```
media_objects 228 · post_media 228 · posts 254 · probe rows left 0
non_ready 0 · unreferenced 0
ref_set_md5 73d4dea406d3c37b67a23f583820b837   (unchanged since Item C)
media policies 5 · ledger 22 rows
```

---

## REMAINING / FOLLOW-UPS (not blockers)

1. **`npm run lint` was already failing on `detect-orphan-files`** before this change — the `edge-authority-baseline.json` entries for this file (lines 4 and 73) are stale and no longer match the file. **Verified against the pre-change file as pre-existing, not a regression.** Re-baselining is a security-control edit and was left alone. (The `Security` CI workflow passes; only the local `eslint .` run reports it.)
2. `backfill-image-dims` rewrites `posts.image_urls` without updating `media_objects.derivatives`.
3. `post_publish_with_media` is `GRANT EXECUTE … TO authenticated` and applied, though unreachable today (a member cannot drive a media object to `ready`; `media_mark_ready` is service_role only).
4. There is still **no orphan sweep for `post-images/` on R2** — `purge-s3-orphans` covers `competition-photos/` only. Detection now sees the media graph; reclamation of dereferenced media remains a separate, unwritten, separately-reviewable sweep.
5. Item A (`measure-post-media` removal) still deferred; Item E (client read-path switch) not started; D-002 privacy gap open; 1 photograph outstanding after the 2026-08-19 15:38:02 fence.

## VERIFICATION LEVELS — STATED HONESTLY

- **Repo ↔ origin/main:** mechanically proven (identical tree hash).
- **Repo ↔ deployed function:** the payload was assembled from the repo files and `get_edge_function` returns source containing every control, but the deployed bytes were not machine-diffed against the repo. Treat as *verified by inspection*, not by hash.
- **Behaviour:** proven by executing the shipped module (26 tests), by 17/17 mutation detection, and by the rolled-back production counterfactual.
