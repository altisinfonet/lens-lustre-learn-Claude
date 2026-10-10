# PHASE 2 — FINAL CLOSURE UPDATE

**Date:** 2026-08-20 · **Measured:** 11:58 UTC, live production · **Phase 3: NOT STARTED**

---

# PHASE 2 — NOT COMPLETE — 92%

The 8% that is missing is **one thing**: authorized byte delivery (D-002/D-003), which
cannot be built with the tools available and is documented as an external blocker rather
than worked around.

---

## 1. COMPLETION PERCENTAGE

| | Previous | Now | Basis |
|---|---|---|---|
| **Overall** | 85% | **92%** | the three 10-point priorities plus reconciliation |
| Priority 1 — write path | 10/10 | **10/10** | all four surfaces closed; the fourth was found today |
| Priority 2 — legacy media | 7/10 | **9/10** | every remaining slide classified with per-object evidence; the safely-repairable set is prepared and awaiting one decision |
| Priority 3 — byte delivery | 1/10 | **1/10** | **blocked** — see §4 |
| Reconciliation / security / tests | — | clean | §5, §6, §7 |

**Why not higher.** Priority 2 keeps its last point because 17 slides have a written,
reversible repair that has deliberately not been applied — it rewrites what 15 posts show
their members, which is not a cleanup decision. Priority 3 keeps 9 of its 10 because
nothing about it can be built here.

**Why not lower.** The delta is measurably not growing, every remaining slide is
classified with evidence rather than assumption, and the detector can now distinguish a
permanent floor from a real leak.

---

## 2. WRITE PATH

### The surface that was missed until today

The earlier work closed the composer, the draft and the scheduler. A repository-wide
re-trace found a **fourth** path that had been looked at and waved through:

**`create_system_post`** — SECURITY DEFINER, granted to `authenticated`, a bare
`INSERT INTO posts` with `image_urls` and nothing else. It reported **nothing**, because
MEDIA-4001 lives in the composer's client code and this RPC is called from two entirely
different places: **every album upload** (`MyPhotos.tsx`) and **every profile-photo
change** (`profilePostHelper.ts`).

Measured when found: 3 system posts existed, 2 of them legacy-only, newest 2026-08-19.

### Architecture, as now deployed

```
COMPOSER      upload → media_begin_upload → media-register-upload → post_publish_with_media
                                                                    (one txn, image_urls DERIVED)
DRAFT         upload → registerAllOrNone → post_drafts.media_ids → publish_post_draft
                                                                   → post_attach_media (guarded, DRAFT-005)
SCHEDULER     upload → registerAllOrNone → scheduled_posts.media_ids → publish-scheduled-posts
                                                                       → post_attach_media (guarded, MEDIA-4005)
ALBUM  (NEW)  upload → registerAllOrNone → create_system_post(_media_ids)
                                           → post_attach_media (guarded, MEDIA-4008)
PROFILE       upload → create_system_post(NULL) → permanently legacy-only, counted as MEDIA-4007
```

Every path is all-or-none per post: a single unregistered slide sends the whole post down
the legacy path rather than publishing an ordinal gap.

### Deployed versions and hashes

| Function | Version | `ezbr_sha256` |
|---|---|---|
| `media-register-upload` | **2** | `405127a99a5c08c8c65fdebc534adfdeac61f6fbe42ddfb9e97d313441cebf71` |
| `migrate-post-media` | 2 | `267aa65ac3d72ca5566bb2e1a7af38ef2d3fce4822becd341c8b25abd434def4` |
| `measure-post-media` | 2 | `990043d23aff39fabc7bf16d4dcbe9647cf2724d205584542f275ea6a69c8cfe` |
| `publish-scheduled-posts` | 23 | `85c176185f61afb4d928f8f58961a4aea96727daa3232bb5c6841e8d4cc83f71` |

`media-register-upload` v2 accepts one extra prefix — `avatars/<owner>/my-photos/` —
and **deliberately not the whole `avatars/` folder**, which also holds `avatar.webp` and
`cover.webp`. Those are overwritten in place; registering one would mint a media object
whose sha256 stops describing the bytes the moment the member changes their picture.

### Production verification

```
since the write path went live (2026-08-20 05:16:24 UTC)
  new_posts                       1
  new_legacy_only_posts           0
  new_unexplained_legacy_posts    0      ← the number that must stay at zero
  new_permanent_legacy_posts      0
  delta_growing                   false
```

**Legacy-only posts created after the fix: 0.**

### Honest limits

- **The composer path has still not been exercised end-to-end by a real member post.** One
  post was created since deployment (07:08) and it came from a **stale browser bundle** —
  diagnosed from edge logs showing no `media_begin_upload` at all, plus a chunk-load
  failure reporting `app_build 2026-08-10-3`. It was subsequently migrated.
- **Members still on the `2026-08-20-1` bundle will not have the MyPhotos fix** until their
  next reload. An album post made in that window will land legacy-only and *will* flip
  `new_unexplained_legacy_posts` — correctly, since its media is immutable. That first alarm
  is a known rollout lag, not a regression. `cache_buster` was bumped once today (2 → 3) and
  was **not** bumped a second time, to avoid forcing two reloads on members in one afternoon.

---

## 3. REMAINING MEDIA

| Class | Initial | Current | Migrated | Retained | Unresolved | Reason |
|---|---|---|---|---|---|---|
| **A** post-images/…/posts/ | 229 | 0 | **229** | 0 | 0 | complete |
| **B** post-images/…/file | 19 | 0 | **19** | 0 | 0 | migrated today |
| **C** avatars/…/my-photos/ | 15 | 0 | **15** | 0 | 0 | migrated today; now also created via the live path |
| **D** avatar.webp?t= | 16 | 16 | 0 | **16** | 0 | MUTABLE — overwritten in place; cannot carry content identity |
| **D′** cover.webp?t= | 2 | 2 | 0 | **2** | 0 | same |
| **E** avatars/covers/… | 2 | 2 | 0 | **2** | 0 | immutable and full-size, but owner sits at path **segment 3**; admitting it needs MIG-1019 to become conditional |
| **F-1** thumb, original EXISTS | 17 | 17 | 0 | **17** | 0 | repair written, reversible, **not applied** — awaiting decision |
| **F-2** thumb, original GONE | 6 | 6 | 0 | **6** | 0 | the thumbnail is the only surviving copy |
| **Totals** | | **47 slides / 35 posts** | **263 slides** | 47 | **0** | |

**Nothing is unresolved.** Every remaining slide is classified with per-object evidence in
`docs/LEGACY_MEDIA_EVIDENCE_MATRIX.md`.

### The split the detector now reports

- **Permanent floor: 18 posts / 18 slides** (D + D′) — legacy-only *by design*.
- **Migratable backlog: 17 posts / 29 slides** (E + F).

### Evidence highlights

- **All 27 class-F slides end in `-thumb.webp`** — a 600px thumbnail is serving as the
  photograph. For 17 of them the 1920px original was located in `storage.objects` and
  **both files were fetched and measured from their header bytes**: every thumb is exactly
  600px on its long edge, every original exactly 1920px, aspect ratios matching to within
  integer rounding (max Δ 0.0011). The pairing is proven, not inferred from filenames.
- **Class E** verified live on the CDN at 1500×1000 and 2000×1333 — real, immutable,
  full-size photographs excluded on a path-shape technicality alone.
- **Class D is demonstrably unsafe to migrate**: one key's two cache-busted URLs return
  *different images* (400×267 and 400×400).

### The one decision outstanding

`supabase/migrations/UNAPPLIED_20260820140000_classF_repoint_originals.sql` — re-points
those 17 slides to their verified originals, captures each post's whole `image_urls` array
in `media_repair_audit` **before** touching it, and gates itself on exactly 15 posts moving
and every rewritten URL resolving. The rollback restores from the audit table, so the undo
is exact rather than reconstructed. **Not applied**, because it changes what 15 posts show
their members.

---

## 4. D-002 / D-003 — BLOCKED ON EXTERNAL INFRASTRUCTURE

### The measured security result

Run today against a real production object, no session, credentials omitted:

```
fetch(mode:'no-cors', credentials:'omit')  →  type "opaque", status 0
new Image()  (no crossOrigin, no cookies)  →  LOADED, 1620 × 1081
```

**HTTP status: 200. Bytes retrieved: all of them.**

The opaque fetch is not a control — the CDN sends no CORS header, so a *script* cannot read
the bytes. `new Image()` needs no CORS and renders the photograph. That is how a third
party actually retrieves an image, and it works.

**The D-002 closure test FAILS.** `PrivacyGapNotice` stays in the composer, and
`PrivacyGapDisclosed.test.ts` still fails if the audience chooser ships without it.

### The exact external dependency

The Cloudflare connector **is** connected and working — it reads R2 buckets `50mm` (APAC,
Standard) and `agentcrm`, and Worker `seo-edge-injector`. It is **read-only for Workers**:

| Needed | Available? |
|---|---|
| Deploy a Worker script | **No** — only `workers_list` / `get_worker` / `get_worker_code` |
| Bind R2 to a Worker | **No** |
| Create a Worker route or custom domain | **No** |
| Change DNS, or disable R2 public access | **No** |

`docs/D003_CLOUDFLARE_HANDOVER.md` carries the complete handover: exact Cloudflare
configuration, exact Worker behaviour, exact token contract, exact application endpoint
contract, the 14-row security test matrix, and the deployment order — including the step
that actually closes the gap (**disable R2 public access**), and the test that catches a
half-deployment (fetch a restricted object directly from the R2 public endpoint; it must
also fail).

**Nothing was faked, stubbed, or half-implemented.**

---

## 5. DATABASE RECONCILIATION

```
total posts                 252     total slides                310
post_media                  263     media_objects               264
posts with media            217     posts without media          35
legacy-only posts            35     legacy-only slides           47
  ├─ permanent floor         18       ├─ permanent floor         18
  └─ migratable backlog      17       └─ migratable backlog      29
new-path posts              217     new-path slides             263
posts after write-path        1     legacy-only after fix         0
unreferenced media            1     non-ready media               0
refs to non-ready             0     owner mismatches              0
ordinal gaps                  0     partial posts                 0
duplicate owner/hash          0     duplicate post/ord            0
missing object paths          0     migration ledger             30
ref_set_md5   8312dcc2b35fb9cbbb5355fd98115858
```

Coverage: **263/310 slides (84.8%)**, **217/252 posts (86.1%)**.

**The single orphan is pre-existing and understood.** `media_objects` row `18b96d23…`
lost its reference when the owner deleted that post at 07:07 today — `post_media`
cascaded, `media_objects` did not, because nothing deletes storage objects. It is why
`media_objects` reads 264 against the manifest's 263.

---

## 6. SECURITY

| Check | Result |
|---|---|
| Client table grants on `media_objects` / `post_media` | **0** |
| Client column grants on those tables | **0** |
| Table ACL | `postgres` + `service_role` only — no `anon`, no `authenticated` |
| RLS policies on those tables | 5, all routed through `can_view_post` |
| `post_media_for` body md5 | `5ea99d5975ee68086b82aa2ee0b780b7` — **unchanged all session** |
| `media_write_path_delta` grants | `REVOKE ALL` from `public, anon, authenticated` |
| `create_system_post` ACL | `postgres`, `authenticated`, `service_role` — PUBLIC/anon **revoked** |
| Non-public posts | 0 |
| Restricted media reachable by direct URL | **YES — D-002 open** (§4) |

**Two security issues were caught while applying, not after:**

1. A `DEFAULT` on `create_system_post`'s new 5th argument made every 4-argument call
   **ambiguous** (`42725 function is not unique`) — that would have broken both live callers
   on their next run. The old overload is dropped.
2. `CREATE OR REPLACE` on a new signature took the server default of **EXECUTE to PUBLIC**,
   silently handing `anon` a post-creating SECURITY DEFINER function. Revoked.

> Note for the next audit: an earlier reading of `post_media_for` used
> `md5(pg_get_functiondef(...))`, which includes the header and yields
> `64566ba7917bc53e8faddeb5d45ed427`. The tracked value is `md5(prosrc)`. Two digests of the
> same unchanged function — do not read the header form as a regression.

---

## 7. TESTING

| | |
|---|---|
| Full suite | **2202 passing**, 1 skipped, 0 failing |
| Typecheck | `tsc --noEmit -p tsconfig.app.json` — clean |
| `mutate-write-path.mjs` | **35/35 detected** |
| `mutate-candidate-widening.mjs` | **14/14 detected** |
| `mutate-authorized-delivery.mjs` | **8/8 detected** |
| **Total mutations** | **57/57 detected · 0 escaped** |

### Escapes found and fixed rather than excused

- **Mutation 30 escaped genuinely.** The assertion checked only that the string
  `registerAllOrNone(` appeared; the mutation kept the call and discarded its result
  (`const mediaIds = null && await registerAllOrNone(...)`). The assertion now requires the
  **binding**, not the call. This is the "satisfiable by a comment" failure mode, and it
  got through my own review.
- **Four mutations were stale targets, not escapes** (13, 21, 22, and candidate-widening
  11). Each aimed at a definition that `CREATE OR REPLACE` had superseded, so it changed a
  file without changing behaviour. All four were **retargeted at the live definition**; no
  assertion was weakened.

### UI verification — real data, not fixtures

Loaded the live feed and inspected every rendered image:

```
media images   45      broken   0      empty src   0
  from CDN     43   (migrated / new path)
  from Supabase 2   (class F legacy — still rendering)
```

`post_media_for` over a 40-post sample: 48 rows, covering all 38 migrated posts,
**0 missing object paths, 0 missing dimensions, 0 migrated posts missed**. The 2
legacy-only posts correctly return nothing and fall back to `image_urls`.

---

## 8. DEPLOYMENT

| PR | Title | Merge |
|---|---|---|
| #77 | widen the candidate population; evidence for D/E/F; the D-003 spec | `6c11048` |
| #78 | close the stale-client hole that let the delta grow | `248a436` |
| #79 | close the fourth write surface, and split the delta floor from the leak | `6438a1d` |
| #80 | bump the build marker for the MyPhotos media change | `f6cbc16` |

Every check on every PR was read **individually via the API**, never from the
"Able to merge" banner. 7/7 green on each.

**Migrations applied today:** `media_write_path_delta`, `system_post_media`,
`system_post_media_fix_overload_and_grants`, `delta_attribution`. Ledger: 30 rows.
Every one has a rollback file that states what is lost by running it.

```
origin/main   f6cbc16
tree          1490294cf720c6973b33dc2fb84324de090dfc73
local == origin/main   YES
working tree clean     YES (0 changes)
stray local branches   none
```

Live bundle: `__APP_BUILD = "2026-08-20-2"`. `cache_buster` at version 3 (bumped 2 → 3 at
08:56 UTC, after confirming the new bundle was live).

---

## 9. REMAINING BLOCKERS

**Real blockers — nothing else stands between here and 100%:**

1. **D-003 / D-002 — external.** No tool can deploy a Worker, bind R2, set a route or
   change DNS. Requires someone with Cloudflare dashboard access to follow
   `docs/D003_CLOUDFLARE_HANDOVER.md`. **This is the whole of the missing 8%.**

**Decisions, not blockers — each is prepared and waiting:**

2. **Class F repair (17 slides).** Migration written, reversible, gated, not applied.
3. **Class E (2 slides).** Migratable only by making MIG-1019 conditional — the rule that
   has already caught three real ownership violations. Recommend a separate fourth
   candidate class with its own extractor, or leave retained.
4. **Class D/D′ (18 slides).** Only changes if the product decides profile-update
   announcements should snapshot to an immutable path rather than point at the live avatar.

**Item A — `measure-post-media`: KEEP.** 0 unmigrated candidates remain today, but it is
the only measurement tool for decisions 2–3, and it **self-expires 2026-09-01** by its own
code. Removing it now would mean touching the very test and mutation harness that constrain
it, right before it might be needed.

**Carried risks:**

- The composer write path is still unproven end-to-end by a real member post.
- D-004 dual-write still writes `image_urls`; its removal depends on the Android binary,
  which this repository cannot deploy.
- One orphan media object, no reaper — deliberate, but it will accumulate as posts are
  deleted, and every future reconciliation will report MIG-1071/1072 against it.

---

## 10. PHASE 3

**PHASE 3 = NOT STARTED.** Nothing in it was touched, planned, or scaffolded.
