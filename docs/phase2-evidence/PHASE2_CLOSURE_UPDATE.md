# PHASE 2 — CLOSURE UPDATE

**Date:** 2026-08-20 · **Executed:** the three approved decisions, nothing else
**Phase 3:** not started · **D-002/D-003:** not attempted, not faked, not closed

---

## ⚠ READ THIS FIRST — A NEW FINDING CHANGES THE HEADLINE

**At 18:16:37 UTC a member (last_platform = "app") published a photograph post from the
Android app, and it is legacy-only.** `delta_growing` is now **TRUE** and
`new_unexplained_legacy_posts = 1`. No MEDIA-4001/4006/4010 fired, because the client
never ran the new write path at all — the app in members' hands (v1.2.14, built
2026-08-17) predates the write path (deployed today 15:51 UTC).

This is **not** caused by this workstream (the post arrived after the repoint was
executed and verified; the repoint touched only 8 old posts' URLs). It empirically
answers WS1's UNKNOWN-1: **the Android channel publishes legacy-only, invisibly**, and
will keep doing so until an app build carrying today's bundle ships. Cutting an app
release is outside the three approved decisions, so I did not do it — but it is now the
**one thing standing between you and a closed delta**, and it is a repo-internal action
(the android-build workflow exists), not an external blocker.

The post: `b959cf72…`, public, 1 slide, current `-l3` URL layout, no `post_media`.
The web write path remains proven and live (bundle `index-cSt3z7BJ.js`, verified again
today). The leak is the app channel alone.

---

## CLASS-F EXECUTION RESULT — ✅ EXECUTED AND VERIFIED

Applied as migration **`20260820180836_classf_repoint_originals`** after the read-only
gate re-verified **8 posts / 20 slides / 0 missing targets** (the required numbers, not
adjusted). One transient API timeout occurred first; I verified nothing had applied
before retrying — the audit table did not exist, so the retry was safe.

Every independent post-check matched the pre-captured baseline exactly:

| verification | result |
|---|---|
| 20 intended slide positions changed | ✅ audit arrays show exactly 20 |
| 8 intended posts affected | ✅ the 8 IDs match the pre-gate list |
| the 8 posts' after-state | ✅ == predicted digest `e449ef6d…` |
| no unintended `image_urls` changed | ✅ all-other-posts digest `9a204bfd…` identical |
| all replacement objects exist | ✅ 0 missing; spot retrieval: 1920×1920, 433,806 B, HTTP 200 |
| rollback evidence | ✅ 8 rows in `media_repair_audit`, before-arrays == pre-execution snapshot `357c32fd…`, table locked from clients |
| no storage mutation | ✅ 116 objects, digest `3a3bc738…` unchanged |
| `media_objects`/`post_media`/fences/functions | ✅ 263/265, `ref_set_md5` unchanged; all five key function md5s unchanged; RLS on posts intact; grants unchanged |
| `posts.image_url` consistency | ✅ equals `image_urls[1]` for all 8 |

**Members of 8 posts now see their photographs at 1920px instead of 600px.** No counter
moved — these posts remain legacy-only by design (Exclusion 1).

### Caught by our own gate, fixed, disclosed

The approved script created `media_repair_audit` **without ENABLE ROW LEVEL SECURITY**.
`newTableGrants.test.ts` went red — *after* production application, which was my
sequencing error: the suite should have run against the renamed file first. Production
was corrected eleven minutes later as **`20260820181949_media_repair_audit_rls`** (RLS
on, zero policies = deny-all; anon/authenticated verified denied; 8 audit rows intact).
The repo's `180836` file carries the ENABLE line with a provenance note naming the
version that actually applied it.

## PERMANENT LEGACY EXCLUSION COUNT

**29 slides / 17 posts / 25 objects**, recorded in `docs/PERMANENT_LEGACY_EXCLUSIONS.md`
and registered as **D-006** (pinned by the WS3 refusal tests, which now carry the
`@decision` marker):

- **Decision 1 — ACCEPTED as permanent legacy:** 27 Supabase-hosted thumbnail slides.
  Nothing copied, nothing deleted, no `media_objects`/`post_media` created, evidence
  preserved.
- **Decision 2 — migration REJECTED:** 2 R2 cover photographs. MIG-1019 and MEDIA-2102
  unchanged, mutation-locked (W2/W4).

## PRODUCTION RECONCILIATION — 19:01:35 UTC, from production, not from reports

| metric | value | note |
|---|---|---|
| total posts / slides | **253 / 311** | +1 each: the 18:16 Android post |
| `post_media` / `media_objects` | **263 / 265** | unchanged by this workstream |
| legacy-only posts / slides | **36 / 48** | 35/47 + the new Android post |
| permanent legacy exclusions | **29 slides** (D-006) + 18-slide mutable floor + the new Android post pending its own classification |
| new posts since write-path deploy | **1** — **NON-VACUOUS now** |
| new legacy-only posts since deploy | **1** — the measurement is real, and it is a FAIL for the app channel |
| `delta_growing` | **true** (was false at 17:55) |
| `ref_set_md5` | `dce7bec802523fca3b0a4123ea0a2a6f` — unchanged all day |
| orphan media | 2 (both explained: D-002 probe, WS2 retained object) |
| non-ready / owner mismatch / ordinal gaps / dup (owner,sha) / dup (post,ord) | **all 0** |
| Supabase `-thumb` slides remaining | **7** — exactly the unrepairable positions, as predicted |

The vacuous-vs-real distinction the directive demanded: at 17:55 the post-fix zero was
**0 of 0 (vacuous)**; at 19:01 it is **1 of 1 legacy-only (real, adverse)**. Reported as
such, not smoothed over.

## SECURITY VERIFICATION

Function md5s unchanged (`post_publish_with_media b38d88b5…`, `post_attach_media
fef4bf75…`, `media_mark_ready 546879aa…`, `publish_post_draft 3c208e23…`); frozen fence
present and untouched; `posts` RLS on, grants unchanged (8 rows); ownership controls
unwidened; the new audit table is deny-all with RLS on and zero client privileges.

## MUTATION RESULTS — all from GREEN baselines

| harness | result |
|---|---|
| write path | **58/58 detected** |
| scheduled duplicate | **24/24 detected** |
| candidate widening (incl. W1–W5) | **19/19 detected** |

## TEST SUITE

**2,261 passed / 1 skipped** (164 files) — including the new-table-grants failure that
was found and then fixed. `tsc --noEmit -p tsconfig.app.json` clean. No unrelated files
changed.

## CI RESULTS

**PR #83 — all 7 checks green** (typecheck, build, control-reachability, security
rules, secret scan, dependency scan, Cloudflare Pages), `mergeable_state: clean`,
squash-merged 19:16:36 UTC.

## DEPLOYMENT / REPOSITORY HASHES

| | |
|---|---|
| `main` = `origin/main` = local | **`7d58de2`** (tree-verified byte-identical) |
| DB migrations applied today | `20260820180836_classf_repoint_originals`, `20260820181949_media_repair_audit_rls` |
| repo ledger | both files present, 1:1 with the server ledger; `UNAPPLIED_` file deleted |
| served web bundle | `index-cSt3z7BJ.js` — unchanged, write path verified live |
| edge functions | unchanged |

## D-002 / D-003 STATUS

Untouched, unfaked, **not closed**. External requirements unchanged and documented:
Worker deployment, R2 binding (`MEDIA` → bucket `50mm`), `MEDIA_TOKEN_KEY` secret on
both sides, Worker route/custom domain, DNS proxy, **disable R2 public access**, then
the real unauthenticated-byte negative test against both the CDN hostname and the R2
public endpoint.

## PERCENTAGE — measured, not manufactured

**Phase 2 stands at 96%, not 97%.** The three decisions closed the 2-point backlog and
the 1-point Class-F item, which arithmetically gives 97 — but the same measurement pass
that would have certified it found the Android channel actively leaking
(`delta_growing = true`). The primary objective — STOP THE DELTA FROM GROWING — is met
on the web channel and **violated on the app channel**, and I will not certify 97% in
the same breath as a growing delta. I assess the leak at 1 point until an app build
carrying the write path ships and one real app post is observed with `post_media` rows.

## EXACT CONDITIONS STILL REQUIRED FOR 100%

1. **Ship an Android build containing today's bundle** (BUILD 1107+ / v1.2.15), observe
   one real app-channel post with `post_media` rows, and see `delta_growing` return to
   false. (~1 point — repo-internal, needs your go-ahead since app releases are yours.)
2. **D-002/D-003**: the six external Cloudflare/R2 steps above, closed only by the real
   unauthenticated-byte negative test. (~3 points — external.)
3. Optional, 0-point bookkeeping: update `media_write_path_delta`'s labels so the D-006
   exclusions stop being reported as `migratable_legacy_*`, and classify the Android
   post once item 1 lands.

Phase 2 is **not declared complete**. Phase 3 is **not started**.
