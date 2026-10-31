# PHASE 2 — FINAL DECISION PACKAGE

**Date:** 2026-08-20 · **Measured:** 17:55:11 UTC, directly against production
**Phase 3:** not started · **Phase 2:** NOT declared complete — that declaration is yours
**Writes performed by this reconciliation:** ZERO. No storage copy, no URL rewrite, no
ownership-control change, no Class-F execution, no D-002/D-003 implementation, no fence
or manifest touched, no `posts.image_urls` modified.

---

## 1. EXACT CURRENT PERCENTAGE

**94%**, by the completion model fixed in the WS2 closure and carried unchanged since:

| component | points | state |
|---|---|---|
| everything through the write-path closure | 94 | **done, deployed, re-verified today** |
| D-002/D-003 — authorized media delivery | 3 | blocked (external infrastructure) |
| the 29-slide legacy backlog | 2 | blocked (owner decision) |
| Class-F repoint | 1 | prepared, corrected, gated — awaiting approval |

No number in this package is manufactured. Every count below was re-measured read-only
today, not carried forward from a report.

---

## 2. EXACT REMAINING BLOCKERS — re-verified today

**Blocker A — the 27 Supabase-hosted thumbnail slides.** Re-derived from scratch:
exactly **29 migratable-in-name slides across 17 posts**, of which **27 slides / 23
distinct objects** sit on `jtdtehuqtinjxropkkcn.supabase.co`. All 27 are `-thumb.webp`
derivatives; all 23 objects exist in `storage.objects`; spot retrievals confirm **404 on
the CDN, 200 on Supabase**, with the 1920px original alongside where it survives.
Unexpected hosts: **0**.

**Blocker B — the 2 R2 cover slides.** Both retrieved **200 from
`cdn.50mmretina.com`** today under `avatars/covers/<owner>/…` — real originals, owner at
path segment 3, refused by two independent ownership controls.

**Blocker C — Class-F repoint.** The repair's own selection logic, evaluated read-only
against production today: **8 posts / 20 slides would change, 0 rewritten targets
missing**. The corrected gates (`REPAIR-001: _n <> 8`, `REPAIR-003: _slides <> 20`) are
what is now on `main`, and the file still carries the `UNAPPLIED_` prefix.

**Blocker D — D-002/D-003.** Requirements verified against the handover doc and the
connector's actual tool surface; itemised in §7.

---

## 3. WHICH ITEM IS WHICH KIND OF WORK

| item | engineering work | owner decision | external infrastructure |
|---|---|---|---|
| 27 Supabase thumbnails | — | **✔ (accept as permanent legacy, or order a copy+rewrite programme)** | — |
| 2 R2 covers | — | **✔ (reject, or order an ownership-control widening)** | — |
| Class-F repoint (20 slides) | done and gated | **✔ (approve / reject execution)** | — |
| D-002/D-003 | client+RPC+Worker are already written | — | **✔ Cloudflare/R2 access** |
| `measure-post-media` | — | — | — (KEEP; 5 live dependents re-verified: config.toml deployment, MANIFEST_PROVENANCE.md, CANDIDATE_PATTERN_AUDIT.md, its pin test, mutation 12) |

**There is no unstarted engineering work left in Phase 2.** Every remaining item is a
decision or an external dependency.

---

## 4. EXACT EFFECT OF THE CLASS-F DECISION (20 slides)

**If you APPROVE** (rename the file to drop `UNAPPLIED_`, apply once):

- 20 slide positions across **8 posts** change from a 600px thumbnail URL to the
  1920px original beside it. Same photograph, same owner folder, higher fidelity.
- Every prior array is captured in `media_repair_audit` first; rollback is an exact
  restore, not a reconstruction. Gates abort the whole transaction unless exactly
  8 posts / 20 slides change and every target object exists (verified today: 0 missing).
- **Numbers that change: NONE of the Phase 2 counters.** The posts remain legacy-only
  (still on supabase.co), so legacy_only_posts stays 35, slides stays 47, the
  percentage stays 94%. This buys member-visible fidelity, not migration progress.
- Risk: members of 8 posts see their photograph change resolution. Nothing else.

**If you REJECT**: nothing changes; 8 posts keep showing 600px thumbnails forever, and
the corrected file stays in the repo as documentation. No counter moves either way.

---

## 5. EXACT EFFECT OF ACCEPTING THE 27 SUPABASE THUMBNAILS AS PERMANENT LEGACY

- The "migratable backlog" of 29 → **2** (the covers), or **0** if §6 is also accepted.
- The permanent floor grows from 18 slides to **45** (18 mutable + 27 accepted) — posts
  35 stays, but their classification changes from "pending" to "permanently excluded,
  documented".
- The 2-point backlog component of the model is satisfied **by decision rather than by
  migration**; with §6 also accepted, Phase 2's repository-side scope is closed and only
  D-002/D-003 remains → **97%**.
- What you give up: those 15 posts will never carry `post_media` rows and always render
  via `image_urls` fallback — which is exactly how they render today. Members see no
  change whatsoever.
- Reversible: yes. The objects, originals, and evidence matrix all survive; a future
  copy+rewrite programme remains possible if ever wanted. Accepting now forecloses
  nothing except the standing implication that this is pending work.
- Honest bookkeeping note: 3 of the 27 (`avatar-thumb.webp`) are mutable-avatar
  derivatives that belong in the floor under any reading; the classifier in
  `media_write_path_delta` would eventually deserve a one-line update so the published
  floor/backlog split matches the decision. That is a follow-up, not a precondition.

**If instead you order them migrated**: it requires a Supabase→R2 byte copy of 23
objects (~0.6 MB thumbs — or better, the 17 surviving 1920px originals, ~4.5 MB) AND an
`image_urls` rewrite of 15 posts, i.e. both operations WS3 was forbidden. It would be a
new, fenced, manifested programme under the shipped tooling — real work, real risk, for
posts that render correctly today.

---

## 6. EXACT EFFECT OF REJECTING THE 2 R2 COVER MIGRATIONS

- The ownership controls (`MIG-1019` owner-at-segment-2; `media_mark_ready`'s
  MEDIA-2102 prefix rule) stay exactly as written and as mutation-locked (W2/W4 both
  turn the suite red if anyone widens them later).
- 2 slides / 2 posts (same owner) stay legacy-only permanently; both render correctly
  today from the CDN. Members see no change.
- The backlog reaches 0 pending items when combined with §5.
- What acceptance would have cost: admitting a path shape where the owner sits at a
  different depth into an **ownership** control — the highest-consequence class of change
  in this engine — for 2 slides out of 310. **Recommendation stands: reject.**

---

## 7. EXACT D-002/D-003 EXTERNAL REQUIREMENTS

Verified today against the connector's real tool surface (read-only for Workers:
`workers_list`, `workers_get_worker`, `workers_get_worker_code` — nothing else) and
`docs/D003_CLOUDFLARE_HANDOVER.md`. Required, in order, none of it possible from here:

1. **Deploy** the `media-authz` Worker script (written, in-repo) — needs Wrangler or
   dashboard access with Workers write permission.
2. **Bind R2**: variable `MEDIA` → bucket `50mm`.
3. **Secret** `MEDIA_TOKEN_KEY` (32 random bytes, base64url) set on the Worker AND as a
   Supabase secret so the application can sign.
4. **Route/custom domain**: attach the Worker to `cdn.50mmretina.com`.
5. **DNS**: `cdn.50mmretina.com` becomes a proxied record pointing at the Worker route.
6. **Disable R2 public access** on bucket `50mm` — the step whose omission makes the
   Worker decorative.

Closure requires the **negative test**: an unauthenticated fetch of a restricted
object's bytes — both via the CDN hostname and directly against the R2 public
endpoint — must fail. Not simulated, not inferred. **I did not attempt or fake any of
this.** D-002 remains open; the composer continues to state the limitation honestly to
members ("the photo file itself can still be opened by anyone who has its direct link").

---

## 8. FINAL PRODUCTION RECONCILIATION — 2026-08-20 17:55:11 UTC

| metric | value |
|---|---|
| total posts / total slides | **252 / 310** |
| `post_media` / `media_objects` | **263 / 265** |
| legacy-only posts / slides | **35 / 47** (18/18 floor + 17/29 backlog) |
| posts created after the write-path fix | **0** |
| new legacy-only after the fix | **0 — VACUOUS (0 of 0)**, explicitly so marked: the only post-fix post was the WS2 test post, since deleted. The next real member post makes this non-vacuous. |
| posts with `idempotency_key` | 0 (the one bearer was the deleted test post) |
| `delta_growing` / `new_unexplained_legacy_posts` | **false / 0** |
| owner mismatches, ordinal gaps, dup (owner,sha256), dup (post,ord), non-ready, partial | **all 0** |
| unreferenced media | 2 — both explained (D-002 probe; WS2 test object retained by `ON DELETE RESTRICT`) |
| `ref_set_md5` | **`dce7bec802523fca3b0a4123ea0a2a6f`** — unchanged since WS3 |
| write path in the served bundle | **verified live**: `index-cSt3z7BJ.js` calls all media RPCs in member-call position; MEDIA-4009/4010 present |
| frozen 229 fence, historical manifests | **untouched** |

---

## 9. REPOSITORY / ORIGIN / DEPLOYMENT STATE

| | |
|---|---|
| `origin/main` = local `main` | **`d9c8c24`** — "WS3 — assert CDN_HOST by value…" (#82) |
| working tree | clean; no unpushed WS branches |
| deployed client bundle | `/assets/index-cSt3z7BJ.js`, build marker `2026-08-20-2` |
| live DB functions | unchanged: `post_publish_with_media b38d88b5…`, `post_attach_media fef4bf75…`, `create_system_post 2a90beb4…`, `publish_post_draft 3c208e23…`, `media_mark_ready 546879aa…` |
| Class-F file on main | corrected gates present, **still `UNAPPLIED_`** |
| pre-existing unrelated branches | `local-history-backup`, `publish/m1-and-control` — untouched |

## 10. CI / TEST / MUTATION STATUS

- **CI on `d9c8c24`: all 7 checks green** (typecheck, build, control-reachability,
  security rules, secret scan, dependency scan, Cloudflare Pages) — re-read today.
- **Tests: 2,259 passed / 1 skipped** across 164 files (last full local run, unchanged
  tree since).
- **Mutations: 101/101 detected** — write-path 58/58, scheduled-duplicate 24/24,
  candidate-widening 19/19 — all from GREEN baselines, all three harnesses now refusing
  a red baseline.
- Reminder from the WS3 session: GitHub shows an **overdue billing banner (pay by
  2026-08-31)**; a lapse would stop Actions, which is every gate above.

---

## THE DECISION IN ONE PARAGRAPH

Phase 2 stands at **94%**, and nothing that remains is engineering. Approving the
Class-F repoint changes what 8 posts display (better) and no counter. Accepting the 27
thumbnails as permanent legacy and rejecting the 2 cover migrations closes the
repository-side scope by decision — **97%** — with zero member-visible change and zero
foreclosed options. The last 3 points are Cloudflare access and a real negative test,
which no one in this session can perform. Phase 2 is **not** declared complete, and
Phase 3 is not started.
