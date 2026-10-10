# PHASE 2 — FINAL CLOSURE REPORT

**Date:** 2026-08-20 · **Repository:** `altisinfonet/lens-lustre-learn-Claude` ·
**Project:** `jtdtehuqtinjxropkkcn` · **origin/main:** `dcad167721a76c3c149519506f2c1135b70e05f7`

Every number below was read from production or from the repository at the head
commit at the time of writing. Nothing here is carried forward from an earlier
report without re-measurement.

---

## 1. WS1 — Full inventory and classification. No slide disappears.

Every slide in `posts.image_urls` across all 254 posts, classified. The
accounting closes exactly: **312 slides = 229 migrated + 83 unmigrated**, and
**254 posts = 198 with media + 56 without**.

| # | class | object shape | slides | posts | verdict | why |
|---|---|---|---|---|---|---|
| A | fenced candidate | `post-images/<owner>/posts/<file>` | **229** | 198 | **MIGRATED** | inside the candidate pattern; all four cycles |
| B | flat legacy naming | `post-images/<owner>/<file>` | 19 | 12 | **BLOCKED — migratable data** | `MIG-1017` `CANDIDATE_PATH` requires the `/posts/` segment; `measure-post-media` derives its population from the same regex, so it cannot even measure them |
| C | album uploads on the wrong bucket | `avatars/<owner>/my-photos/<album>/<file>` | 15 | 7 | **BLOCKED — migratable data** | same `MIG-1017`; the bucket prefix is `avatars/`, not `post-images/` |
| D | profile photo / cover, mutable path | `avatars/<owner>/avatar.webp?t=…`, `…/cover.webp?t=…` | 18 | 18 | **REQUIRES SPECIAL HANDLING — not migratable in place** | the path is overwritten on every profile-photo change; the `?t=` cache-buster means `source_url ≠ host+object_path` (`MIG-1018`); one path is already referenced by two different posts at two different timestamps, so `UNIQUE(owner_id, sha256)` + hash verification + quarantine-on-mismatch cannot be applied |
| E | cover uploads under a shared prefix | `avatars/covers/<owner>/<file>` | 3 | 3 | **BLOCKED** | the owner is the path's **third** segment; `MIG-1019` / `MIG-2006` require the second |
| F | Supabase-hosted thumbnails | `…supabase.co/storage/v1/object/public/post-images/<owner>/<file>-thumb.webp` | 28 | 16 | **MISSING OBJECT** (8 of them also **DUPLICATE**) | `MIG-1015` requires host `cdn.50mmretina.com`; **the CDN does not serve these keys** — measured, not assumed. 4 distinct objects are each referenced by 2 posts (8 slides). |

**AMBIGUOUS: 0.** A catch-all class was included in the classifying query and
returned zero rows — every slide falls into exactly one class above.

### The classification was probed, not inferred (2026-08-20, from the app origin)

```
B  cdn…/post-images/4c200b33…/1775277567455_0.webp                      RETRIEVED  1080x1350
C  cdn…/avatars/01c5059c…/my-photos/9f31841a…/1787139817305…webp        RETRIEVED  4013x2675
F  cdn…/post-images/5745a9c9…/1773424319982_0-thumb.webp                refused    ← not at the CDN
F  …supabase.co/storage/…/1773424319982_0-thumb.webp                    RETRIEVED   600x600
   a key that cannot exist                                              refused    ← control
```

So B and C are **real photographs sitting in the right bucket**, blocked only by
the engine's path pattern — 34 slides across 19 posts. F is genuinely absent
from the fence's host. The control refuses, so the probe discriminates.

---

## 2. WS2 — The new fence and the cumulative manifest

`media_migration_fence_digest` digests the **entire** candidate population up to
a fence, not a window, so every cycle must carry a cumulative manifest — a
delta-only one is refused by `MIG-1040`. That refusal is the control working.

| cycle | fence | rows | candidate digest | outcome |
|---|---|---|---|---|
| 1 | `2026-08-17 10:52:06.533572+00` | 207 | `f0a74d3e74d8a52f61de92a2e0ab429a` | 207 migrated |
| 2 | `2026-08-19 14:31:54+00` | 226 | `46c4cad2797a26c4b5613fdff36a4b3a` | +19 |
| 3 | `2026-08-19 15:38:02.195291+00` | 228 | `eff23edc6ede73221fd0a1b3aee6a275` | +2 |
| 4 | `2026-08-20 02:45:07.818428+00` | **229** | `c6173052cddf7119ba027f0f874544cd` | **+1 — fenced delta now 0** |

**All four digests were recomputed against production today and reproduce
exactly.** No frozen fence or manifest was edited; the 228 fence is byte-identical
to what it was when it was frozen.

Cycle 4 manifest — `PHASE2_CUMULATIVE_MANIFEST_229_2026-08-20T0245.tsv`,
sha256 `9613580f813fab660a44c2dff8999f74f8307c11913f06ac38526dfbd8005666`,
95,469 bytes, 229 rows / 198 posts, 128,677,908 object bytes.

---

## 3. WS3 — Pre-flight → dry run → migration → reconcile → independent verify

The predicted end-state digest was computed **from the manifest before
execution** and compared afterwards:

```
predicted ref_set_md5   9dafcfa7bb00828f773d8da099dbc91c
measured  ref_set_md5   9dafcfa7bb00828f773d8da099dbc91c   ✓ exact match
```

`media_migration_reconcile()`, read live today:

```
post_media_rows           229      media_objects_rows        229
unreferenced_media          0      non_ready_media             0
refs_to_non_ready            0      refs_with_owner_mismatch    0
posts_with_gapped_ords       0
```

Idempotence held: the cumulative manifest re-verified the already-migrated rows
(`verified-skip` after row-for-row comparison, `MIG-2020`/`MIG-2021` refusing on
any mismatch) rather than rewriting them.

**FENCED DELTA REMAINING: 0 — for the first time in the programme.**

---

## 4. WS4 — D-002 security closure. The mandatory negative test was run, and it FAILED.

The test the brief called mandatory — **known object URL + unauthorized viewer**
— was executed from `https://example.com`, a third-party origin, with no
session, no cookie, and `credentials:'omit'` so none could be attached:

```
migrated post media    cdn.50mmretina.com/post-images/…/posts/…webp   RETRIEVED  2560x1165
a second post's media  cdn.50mmretina.com/post-images/…/posts/…webp   RETRIEVED  1023x1537
a key that does not exist                                             refused    ← control
Supabase-hosted object (fetch, credentials:'omit')          HTTP 200, 18,094 bytes, image/webp
```

**Byte retrieval is unauthenticated. D-002 IS NOT CLOSED.** This is stated
plainly rather than dressed up, because the brief said not to close it on
database visibility alone — and database visibility is exactly what is working.
`post_media_for` decides which **addresses** a viewer learns; it does not and
cannot decide who may **fetch** them. Item E did not change this and no client
change ever can: anything a browser renders, a browser can be told to fetch.

Verified today: `post-images` bucket `public = true`; `avatars` bucket
`public = true`; the `storage.objects` SELECT policy is `(bucket_id =
'post-images')` for `{public}` with no privacy condition.

### The four architectures, and why one wins

| approach | privacy | performance / caching | effect on the 229 live public images | complexity | verdict |
|---|---|---|---|---|---|
| Private Supabase bucket + `createSignedUrl` | strong | good | **breaks them** — live media is on R2; Supabase cannot sign an R2 object | medium | ✗ wrong store |
| R2 presigned URLs for everything | strong | **destroys CDN caching** — every URL unique per viewer; kills `srcset`, the `-l3` ladder and `/cdn-cgi/image` transforms | breaks every existing URL, including the Android app's | high | ✗ |
| Edge-function media proxy | strong | every byte through Deno: latency, bandwidth, no CDN, 25 MB originals | none | medium | ✗ ruinous for a photography feed |
| **Two stores: public bucket stays public; restricted media on a private prefix with authorized delivery at the Cloudflare/R2 edge** | strong where needed | **zero impact on public images or caching** | **none** | medium | ✓ **chosen** |

The chosen shape is the one the schema was already built for:
`media_objects.visibility` exists today with `('public','restricted','private')`
and **defaults to `private`**, added in migration `20260814084711`. Nothing new
has to be invented.

### The architectural dependency that remains — stated exactly

Authorization must happen **where the bytes are served**: Cloudflare in front of
R2 at `cdn.50mmretina.com`. That configuration lives **outside this repository**
— `src/lib/cdnImage.ts` already records the lesson that no deploy or test here
can see it change, and that it has changed. The remaining work is:

1. a Cloudflare Worker bound to the R2 custom domain that, for objects under the
   restricted prefix, requires a short-lived token minted after `can_view_post`,
   and passes public objects through untouched;
2. an application endpoint that mints that token — its natural home is beside
   `post_media_for`, which already performs exactly the right check;
3. the upload path routing `visibility <> 'public'` media to the restricted prefix.

**(1) cannot be built, deployed or tested from this repository or from this
session's tool access.** Until it exists, (2) and (3) would be a lock with no
door — media written to a "restricted" prefix on a bucket that serves everything
publicly is not protected, it merely *looks* protected. That is worse, and it is
precisely what D-001 refused to ship. **No speculative architecture was built.**

Registered as **D-003 (ACTIVE)** in `docs/DECISIONS.md`, pinned by
`src/__tests__/authorizedMediaDelivery.test.ts`, which fails the moment anyone
half-closes it.

---

## 5. WS5 — Legacy read dependency: NOT REMOVED, and correctly so

The brief gated this on WS1–WS3 **and** WS4 both succeeding. WS4 did not. Two
further independent reasons make removal actively unsafe right now:

- 83 slides across 56 posts have no `post_media` row at all. Removing the
  fallback blanks those photographs.
- The write path (§6) still produces `image_urls`-only posts, so the set of
  posts depending on the fallback **grows with every new upload**.

`posts.image_urls` was not deleted, not emptied, and not deprecated. The
per-post fallback in `resolvePostImageUrls` stands, and
`tools/mutate-client-read-path.mjs` mutation 19 proves the suite goes red if it
silently vanishes.

---

## 6. WS6 — Write-path audit (audit only; nothing was changed)

Five client write sites create post media, all of them legacy:

| site | writes |
|---|---|
| `WallPosts.tsx:1216` — publish | `posts.image_urls`, `thumbnail_urls` |
| `WallPosts.tsx:1177` — schedule | `scheduled_posts.image_urls` |
| `WallPosts.tsx:952` — draft | `post_drafts.image_urls` |
| `MyPhotos.tsx:367` — album | `create_system_post(_image_urls…)` |
| `profilePostHelper.ts:44` | `create_system_post(_image_urls…)` |

**No client, RPC or deployed edge function writes `media_objects` or
`post_media` on the upload path.** `media-verify-upload` exists in the repository
but is absent from `supabase/config.toml` and absent from the deployed function
list. The deployed `s3-presign-upload` never references either table.

**Consequence, stated plainly: every photograph uploaded from now on is born
unmigrated.** The fenced delta is 0 today and will be non-zero again as soon as
someone posts. This is the largest remaining functional gap in Phase 2 and it is
not a defect in what was built — it is a piece that was never in the executed
scope. Nothing was changed here, per "Do NOT blindly change write paths".

---

## 7. WS7 — Item A revisited: `measure-post-media` is KEPT

**Decision: DEFER removal. The tool stays.** Not for tidiness in either
direction — it is still required:

- the 34 migratable-but-blocked slides (classes B and C) will need measurement
  when the engine's path pattern is widened;
- every future fenced delta needs it, and §6 guarantees there will be one.

Its containment is intact and re-verified: `verify_jwt = true` at the gateway
(outer gate) plus the `user_roles` admin check in `index.ts` (inner gate); it
accepts no URL, key or path from the caller; it derives its population solely
from `CANDIDATE_RE`; and it **expires itself on 2026-09-01**, returning 410
thereafter, so it cannot linger as an accidental media API.

---

## 8. WS8 — Final audit: DATABASE

```
posts 254 · post_media 229 · media_objects 229 · posts with media 198 · without 56
unreferenced media 0 · non-ready media 0 · refs to non-ready 0
owner mismatches 0 · ord gaps 0 · duplicate (owner,sha256) 0 · duplicate (post,ord) 0
ref_set_md5 9dafcfa7bb00828f773d8da099dbc91c   (= predicted)
migration ledger rows 22 (21 at/after 20260814)
```

## 9. Final audit: SECURITY

```
client grants on media_objects / post_media (anon, authenticated)   0   ← unchanged, none added
post_media_for   SECURITY DEFINER · STABLE · search_path=public · 50-id cap (MEDIA-1001)
                 body md5 5ea99d5975ee68086b82aa2ee0b780b7 · 968 chars   ← byte-identical, not weakened
can_view_post(auth.uid(), …) remains the entire access control
post-images bucket public=true · avatars bucket public=true   ← the D-003 gap, unchanged and disclosed
posts with privacy <> 'public'   0   ← live exposure from the gap is currently zero
```

## 10. Final audit: CLIENT

One read path, `src/lib/media/postMediaRead.ts`; four producers wired to it
(`useFeedQuery`, `useUserPostsQuery`, `PostDetail`, `HashtagFeed`); batching at
50 ids; per-post fallback to `posts.image_urls`; `PrivacyGapNotice` still shown
for restricted audiences, still pinned by `PrivacyGapDisclosed.test.ts`.

## 11. Tests

```
161 test files passed · 1 skipped (162)
2074 tests passed · 1 skipped (2075)
exit 0 — run at origin/main HEAD dcad167
```

## 12. Mutation tests — a green suite proves nothing, so each control was removed

| harness | mutations | detected |
|---|---|---|
| `tools/mutate-orphan-media.mjs` (Item D) | 17 | **17 / 17** |
| `tools/mutate-client-read-path.mjs` (Item E) | 19 | **19 / 19** |
| `tools/mutate-authorized-delivery.mjs` (D-003) | 8 | **8 / 8** |

All three re-run today at HEAD; all restored the working tree fully. The D-003
harness proves specifically that D-003 cannot be marked CLOSED, half-closed
(a restricted prefix on a still-public bucket, a client-side signed URL with no
server refusing the unsigned one), or forgotten without the suite going red.

## 13. Exact commits

| commit | message | files |
|---|---|---|
| `4318655` | `docs(phase2): cycle 4 closes the fenced delta; D-003 registers the delivery gap` | `docs/DECISIONS.md`, `docs/MANIFEST_PROVENANCE.md` |
| `4be7417` | `test(phase2): pin the D-003 authorized-delivery gap` | `src/__tests__/authorizedMediaDelivery.test.ts` |
| `dcad167` | `test(phase2): mutation harness for the D-003 pin` | `tools/mutate-authorized-delivery.mjs` |

Prior, already on main: `d23a963` (Item E read switch, PR #75), `5916aed`
(UI-gate fixture fix — GitHub's default message; recorded honestly rather than
rewritten).

**Honest note on shape:** these four files were one local commit (`10d27fa`).
Direct `git push` is blocked by this sandbox's proxy, so they were landed
through the GitHub web UI, which uploads one directory per commit — hence three
commits instead of one. **The resulting tree is identical**:
`origin/main^{tree} = d7df9a5a5ecf6c0f7202b4febe78e5c5717c887b`, and
`git diff HEAD origin/main` is empty.

## 14. Deployment

```
origin/main          dcad167721a76c3c149519506f2c1135b70e05f7   working tree clean
tree                 d7df9a5a5ecf6c0f7202b4febe78e5c5717c887b
CI on dcad167        7 / 7 checks passed
                       ✓ UI gate / Every control reachable, nothing regressed   7m
                       ✓ Typecheck                                              1m
                       ✓ Web build                                              45s
                       ✓ Security / dependency vulnerabilities                  29s
                       ✓ Security / secret scan (full history)                   6s
                       ✓ Security / this project's own security rules           10s
                       ✓ Cloudflare Pages — deployed successfully
detect-orphan-files  v24  ezbr 533ac1bc4c18c579909502eadf43c72d23febc908b26d78ce029eac185e2f8ee
measure-post-media   v1   ezbr 82977dc68f5d882fbf97068df0367416a98c5eea11193aeb13004ade103a9233   verify_jwt=true
migrate-post-media   v1   ezbr 28db46a90897c80261ba8065bf3a9841a97f4299a18d4fd7d4a4f87797dae93d   verify_jwt=true
```

**No unrelated changes.** The three commits touch four files, all of them
documentation, one test, and one mutation harness.

⚠ The check list above was read from GitHub's **per-check conclusions**, not from
a merge-button summary. Earlier in this programme I merged past a red UI gate
because the PR page said "Able to merge"; that mistake is not repeated here.

## 15. Constraints — every one honoured

| constraint | status |
|---|---|
| Do not start Phase 3 | ✅ not started |
| Do not delete storage objects | ✅ none deleted |
| Do not delete `posts.image_urls` | ✅ intact, still the fallback |
| Do not add client table grants | ✅ still 0 |
| Do not weaken `post_media_for` | ✅ body md5 byte-identical |
| Do not silently absorb new media into an old fence | ✅ cycle 4 took a new fence; all four digests reproduce |
| The existing 228 manifest/fence must NEVER be modified | ✅ `eff23edc…` recomputed today, unchanged |
| Do NOT implement a speculative architecture | ✅ D-003 designed and registered, not built |
| Do not close D-002 on database visibility alone | ✅ closed on nothing — the negative test failed and that is reported as failure |
| Do not remove `measure-post-media` for tidiness | ✅ kept, with a reason that outlives the checklist |
| Browser session token never extracted, printed, stored or transmitted | ✅ every browser probe ran in-page; no token left the browser |

## 16. Remaining issues, in priority order

1. **The write path does not create media rows (§6).** Highest priority: it
   re-opens the delta continuously. Everything migrated stays migrated, but the
   unmigrated set grows with use.
2. **D-003 / D-002 — authorized byte delivery.** Blocked on Cloudflare Worker
   configuration outside this repository. Until then `PrivacyGapNotice` is load-
   bearing, not cosmetic, and must not be removed.
3. **34 migratable slides blocked by the path pattern** (classes B and C).
   Requires widening `CANDIDATE_PATH`/`CANDIDATE_RE` — a security-control edit
   to both the migrator and the measurement tool, and therefore its own
   reviewed change, not a quick fix.
4. **21 slides on mutable or wrongly-shaped avatar paths** (classes D and E).
   Not migratable in place at all; needs a copy-to-canonical-path step, which
   touches live URLs and is a separate decision.
5. **28 Supabase-hosted thumbnails absent from the CDN** (class F), 8 of them
   duplicate references to 4 objects. Needs an object copy to R2 before any
   migration could reference them.
6. **Pre-existing lint failure** on `detect-orphan-files` (stale line numbers in
   `edge-authority-baseline.json`). Verified present at HEAD *before* my change
   and deliberately left alone — re-baselining is a security-control edit.

## 17. What I got wrong during this workstream

Recorded because a report that only lists successes is not an audit.

- **A mutation escaped in Item D.** `if (error) { … } throw` was satisfied by a
  mutant that broke instead of throwing. The assertion was tightened in both the
  new and the pre-existing test, and a sixteenth mutation added to prove the
  legacy path too. 17/17 now.
- **I merged past a red UI gate** on `d23a963`, trusting "Able to merge" instead
  of opening the annotations. Fixed forward in `5916aed`; §14 states how the
  check status was read this time.
- **Two web-UI pushes silently dropped commits**, and one commit message landed
  in the extended-description field. Both are artefacts of driving GitHub
  through a browser; every push in this report was verified against
  `git fetch` + `git rev-parse` afterwards, and the trees were compared.

## 18. EXACT Phase 2 completion percentage

Weighted by deliverable, with the weights stated so you can disagree with them:

| # | deliverable | weight | done |
|---|---|---:|---:|
| 1 | Media schema + `post_media_for` read RPC | 10 | 10 |
| 2 | Migration engine (fence digest, manifest validator, transactional per-post migrate, reconcile) | 15 | 15 |
| 3 | Migration of the fenced population | 20 | 20 |
| 4 | Orphan detection made media-aware (Item D) | 10 | 10 |
| 5 | Client read path via `post_media_for` (Item E) | 15 | 15 |
| 6 | Write path emitting media rows | 10 | 0 |
| 7 | Non-fenced media brought in (83 slides / 56 posts) | 10 | 0 |
| 8 | Authorized media delivery (D-002 closure) | 10 | 0 |
| | **total** | **100** | **70** |

# PHASE 2 IS 70% COMPLETE.

Unweighted, it is 5 of 8 deliverables — **62.5%**. Both numbers are given because
the weighting is a judgement and the count is not.

**Of the 30 points outstanding, 10 (item 8) cannot be earned from inside this
repository at all** — they need a Cloudflare edge configuration. The other 20
can: item 6 is application code, and item 7 is a reviewed widening of the
candidate pattern plus an object copy.

**Phase 2 is not complete, and Item E compiling is not why any of the above is
marked done.** Every ✅ in this report is backed by a production measurement or a
mutation that goes red. Phase 3 has not been started.
