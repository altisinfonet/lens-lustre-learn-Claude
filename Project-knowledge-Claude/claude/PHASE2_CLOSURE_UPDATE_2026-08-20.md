# PHASE 2 — CLOSURE UPDATE

**Date:** 2026-08-20 · **Measured at:** 08:57 UTC · **Phase 2 is NOT declared complete. Phase 3 is NOT started.**

---

## 0. THE HEADLINE, BECAUSE IT IS NOT GOOD NEWS FIRST

**The delta grew today, and every instrument built to detect that stayed silent.**

At 05:16:24 UTC the media write path went live. At **07:08:49 UTC a member published one
photograph and it landed `image_urls`-only** — no `media_objects` row, no `post_media`
reference. That is precisely the outcome the whole priority exists to prevent.

It was found by querying `posts` directly, not by any alarm.

### What the evidence actually showed

| Check | Result |
|---|---|
| Edge logs 06:50–07:20 for `media_begin_upload` | **none** |
| Edge logs for `media-register-upload` / `post_publish_with_media` | **none** |
| What the logs *did* show at 07:08:48.9 | a bare `POST /rest/v1/posts` → 201 |
| `MEDIA-4001` persisted in `client_errors` | **none** |
| Does the deployed bundle contain the new path? | **yes** — fetched `index-DF8Qsb7B.js` from production and confirmed `media_begin_upload`, `post_publish_with_media`, `MEDIA-4001` |
| `SYS-9002` at 07:17:02 from the same client | `Failed to fetch dynamically imported module: /assets/AdminHealth-Zdzvna2F.js`, `app_build 2026-08-10-3` |

The object key was `…/posts/1787209721889-ko4g1dyjuuc-w1620h1081-l3.webp` —
`${Date.now()}-${Math.random().toString(36).slice(2)}`, which is the **web** client's
format, not Android's. The upload happened at 07:08:41 and the post at 07:08:49, eight
seconds apart, in one live session.

### Root cause

**The publishing browser was running a bundle from before the deploy.** A chunk-hash that
no longer exists is the signature of a stale SPA, and `app_build` still read `2026-08-10-3`.

The write path did not fail. It was never invoked.

### Why nothing reported it — the design mistake

`MEDIA-4001`…`4005` are all `logger.warn` calls **inside the new client code**. A counter
that ships inside the thing it watches cannot report that the thing did not ship. That
circularity is mine, not an operational oversight.

Compounding it: `site_settings.cache_buster` was `{enabled: true, version: 2}`, last
touched **2026-07-09**, and was never bumped for the write-path release. Nothing forced a
returning member onto the new bundle.

---

## 1. CURRENT PERCENTAGE

**Phase 2: ~85%** (was 70% at the last report).

| Priority | Weight | Before | Now | Note |
|---|---|---|---|---|
| 1 — Write path | 10% | 10% | **10%** | deployed, and now *observable* |
| 2 — Non-fenced media | 10% | 0% | **7%** | B+C migrated; D/E/F await owner decisions |
| 3 — Authorized byte delivery | 10% | 0% | **1%** | specified; the Cloudflare dependency is now connected but nothing is built |

The 15% still open is: D/E/F handling (owner decisions), and D-002/D-003 (real work,
now unblocked).

---

## 2. WRITE-PATH STATUS

**Deployed and correct. Now proven observable, still not proven end-to-end by a real
member post through the new code.**

Fixed today, after the incident:

- **`MEDIA-4006`** — `registerUploadedPhoto` returned `null` on `!photo.stored` with **no
  log at all**. It is the only refusal that makes no network call, and therefore the only
  one that can leave no trace anywhere. It now names itself and distinguishes its two
  causes: unmeasurable encoded bytes, or a resumed draft where `null` is the honest answer.
- **`media_write_path_delta(_since)`** — a `STABLE SECURITY DEFINER` function that reads
  **committed rows only**. No client logs, no table grants (`REVOKE ALL` from
  `public, anon, authenticated`). It reports `new_legacy_only_posts` scoped to a cutoff, so
  a shrinking total cannot mask a growing edge.
- **`__APP_BUILD`** bumped `2026-08-10-3` → `2026-08-20-1`, with the incident recorded
  beside it so it is understood as evidence rather than decoration.
- **`cache_buster` bumped 2 → 3** at 08:56:41 UTC, after the new bundle was confirmed live
  (`index-X0RsPxIF.js`, `__APP_BUILD = "2026-08-20-1"`, contains `MEDIA-4006`). Every
  returning member now reloads once onto current code.
- The `MEDIA-40xx` codes **were never in the error catalog**. `docs/error-codes.md`
  described none of them. Range `MEDIA-4000…4099` is now reserved; all six documented.

Live reading, since 05:16:24 UTC:

```
new_posts 1 · new_legacy_only_posts 0 · new_legacy_only_slides 0 · delta_growing false
```

---

## 3. REMAINING-MEDIA STATUS

### Executed: the class B + C cycle

| | |
|---|---|
| Fence | `2026-08-20T07:44:42.350401+00` |
| Fence function | `media_migration_fence_digest_wide` (the frozen v1 is untouched) |
| Live fenced population | `key_set_md5 9c6dfe1ed1972ec7a04bb503c6fd5a2f` · **263 slides / 217 posts** |
| Manifest | **263 rows**, sha256 `ae389eb148b365bdfa2b26c090117219539bda3917a89347cf2693829d47037f` |
| Measurement | all 263 objects read whole and hashed by `measure-post-media` v2 — 0 failures, 0 missing dimensions, 0 missing MIME |
| Dry run | all 217 posts, every object re-fetched and byte-verified against the manifest — **0 refusals** |
| Real run | **20 posts migrated (35 slides)** · 197 `verified-skip` · 0 refused · 0 failed |

Three independent derivations of the candidate set agreed exactly — the SQL fence function
(263), the edge function's own scan (263), and a client-side re-derivation from
`posts.image_urls` (263, with 0 unmeasured and 0 measured-but-not-candidate).

**The manifest is reproducible from the database.** A query over
(fence timestamp, the three candidate regexes, `post_media` ⋈ `media_objects`) regenerates
it byte-for-byte — verified: `encode(digest(t,'sha256'),'hex') = ae389eb1…` is `true`.
Two rows needed a documented rounding note: `1387×640` and `938×1280` are exact
`.0000005` ties, where JS `toFixed(6)` rounds half-to-even and Postgres `round()` rounds
half-up. Both forms satisfy `MIG-1026` (error exactly `5e-7 < 1e-6`); the manifest carries
the JS form because that is what was approved and executed.

### Residual: 35 posts / 47 slides, none of them migratable as-is

| Class | Slides | Posts | Why it is excluded |
|---|---|---|---|
| **F** — `supabase.co` host | 27 | 15 | thumbnails serving as the main photograph; 1920px originals exist for 17 of 23 objects |
| **D** — `avatars/<uuid>/avatar.webp?t=…` | 16 | 16 | MUTABLE — overwritten on every profile-photo change |
| **E** — `avatars/covers/<uuid>/…` | 2 | 2 | owner is at path segment 3, not 2 |
| **D′** — `avatars/<uuid>/cover.webp?t=…` | 2 | 2 | MUTABLE, same reason as D (one owner) |

Nothing in D, E or F has been copied, re-pointed or deleted. Two findings stand:

- a class-D key's two cache-busted URLs return **different images** (400×267 vs 400×400) —
  migrating D would cement a substitution the CDN cache is currently postponing;
- class F is not a migration problem but a **repair** problem: members' photographs are
  being displayed at thumbnail resolution while full-size originals sit in Supabase.

---

## 4. D-002 / D-003 STATUS — STILL OPEN

**D-002 is NOT closed.** The closure test has not been attempted, because nothing has been
built that could pass it:

> KNOWN OBJECT URL + NO SESSION + CREDENTIALS OMITTED + UNAUTHORIZED VIEWER → HTTP DENIED / NO BYTES

The `post-images` prefix is public and its `storage.objects` SELECT policy carries no
privacy condition. `PrivacyGapNotice` remains in the composer, which is the condition of
D-002, and `PrivacyGapDisclosed.test.ts` still fails if the chooser is offered without it.

**What changed today:** the `Cloudflare Developer Platform` connector is now **connected
and verified working** — it lists R2 buckets `50mm` and `agentcrm` and one Worker
(`seo-edge-injector`). That was the blocking dependency. D-003 is buildable for the first
time; it has not been started, and **no partial or fake authorization has been implemented**.

---

## 5. DATABASE RECONCILIATION

```
posts                     252        slides                    310
post_media                263        media_objects             264
posts with media          217        non-ready media             0
legacy-only posts          35        legacy-only slides         47
partial posts               0        ordinal gaps                0
owner mismatches            0        refs to non-ready           0
unreferenced media          1        non-public posts            0
ref_set_md5   8312dcc2b35fb9cbbb5355fd98115858
```

Coverage: **263/310 slides (84.8%)**, **217/252 posts (86.1%)**.

Movement this session: `post_media` 228 → 263, `media_objects` 229 → 264, legacy-only
55 posts / 82 slides → **35 posts / 47 slides**.

**The one orphan is pre-existing and benign.** `media_objects` row `18b96d23-82a3-4e7e-abc2-ab5fe681d938`
(owner `c2f9619d…`, created 2026-08-19 15:23) lost its reference when the owner deleted
that post at 07:07 today: `post_media` cascaded, `media_objects` did not. Nothing deletes
storage objects, and there is no reaper — by design. It is why `media_objects` reads 264
against the manifest's 263, and why `MIG-1071`/`MIG-1072` appear in the run's
reconciliation check. **`MIG-1070` and `MIG-1075` did not fire**, which is the assertion
that matters: `post_media` is exactly 263, and the actual
(post, position, content) **set** equals the manifest — something count equality alone
would not have proven.

---

## 6. SECURITY VERIFICATION

| Check | Result |
|---|---|
| Client grants on `media_objects` / `post_media` | **0** |
| `post_media_for` body md5 | `5ea99d5975ee68086b82aa2ee0b780b7` — **unchanged** |
| `media_write_path_delta` grants | `REVOKE ALL` from `public, anon, authenticated`; no `GRANT EXECUTE` |
| Non-public posts | 0 |
| Restricted media reachable by direct URL | **YES — the D-002 gap is open** |

> ⚠ A note for whoever checks this next: an earlier reading of `post_media_for` used
> `md5(pg_get_functiondef(...))`, which includes the function header and yields
> `64566ba7917bc53e8faddeb5d45ed427`. The tracked value is `md5(prosrc)` — the body. The
> two are different digests of the same unchanged function; do not read the header form as
> a regression.

---

## 7. MUTATION RESULTS

`tools/mutate-write-path.mjs` — **26/26 DETECTED**, including seven new ones aimed at
exactly the half-fixes this work could rot into:

- MEDIA-4006 deleted → the silent drop returns
- MEDIA-4006 downgraded to a comment (an assertion satisfiable by prose)
- the delta check starts reading `client_errors` → inherits the blindness it escaped
- the scoped `new_*` counters removed → a shrinking total hides a growing edge
- the `REVOKE` dropped and `EXECUTE` granted to the client
- the build marker reverted to `2026-08-10-3`
- MEDIA-4006 removed from the catalog while the client still emits it

**One pre-existing mutation was found escaping and fixed properly.** Mutation 13
(`media_mark_ready` stops checking ownership) aimed at a copy of the function inside
`20260820061500_media_write_path_live.sql` that the candidate-pattern widening had
**superseded** with `CREATE OR REPLACE`. It changed a file without changing behaviour, and
the assertions — which resolve the *last* definition, on purpose — correctly ignored it.
It has been retargeted at the live definition rather than the assertion being weakened.

`tools/mutate-candidate-widening.mjs` — 14/14 detected (unchanged).

---

## 8. UI RESULTS

- Composer publish order unchanged: `publishViaMedia` **first**, legacy insert only on
  refusal, `MEDIA-4001` on every fallback.
- `PrivacyGapNotice` still rendered for `friends`/`private` — the condition of D-002.
- No member-visible change shipped today. The `cache_buster` bump forces one reload per
  returning member; anyone mid-compose at 08:56 UTC will have lost an unsaved draft. That
  is the cost of stopping the delta, and it was taken deliberately.

---

## 9. CI RESULTS

| | PR #77 | PR #78 |
|---|---|---|
| typecheck | ✅ | ✅ |
| build | ✅ | ✅ |
| Every control reachable, nothing regressed | ✅ | ✅ |
| Secret scan (full history) | ✅ | ✅ |
| This project's own security rules | ✅ | ✅ |
| Dependency vulnerabilities (production only) | ✅ | ✅ |
| Cloudflare Pages | ✅ | ✅ |

Each check's own conclusion was read via the API, not the "Able to merge" banner.
Local gate: `tsc --noEmit -p tsconfig.app.json` clean; full suite **2178 passing**.

---

## 10. DEPLOYMENT HASHES

**Edge functions**

| Function | Version | `ezbr_sha256` |
|---|---|---|
| `media-register-upload` | 1 | `9f034433a0a395c9f6c547d15000a9ab88db269b8e48a5dbc42481fd9fd5231e` |
| `measure-post-media` | 2 | `990043d23aff39fabc7bf16d4dcbe9647cf2724d205584542f275ea6a69c8cfe` |
| `migrate-post-media` | **2 (deployed today)** | `267aa65ac3d72ca5566bb2e1a7af38ef2d3fce4822becd341c8b25abd434def4` |
| `publish-scheduled-posts` | 23 | `85c176185f61afb4d928f8f58961a4aea96727daa3232bb5c6841e8d4cc83f71` |

The migrator's repo/production divergence is **closed**. The deployed copy is this file's
logic byte-for-byte; only comment glyphs were normalised to ASCII by the deploy path, and
the header records that.

**Database functions (`md5(prosrc)`)**

```
post_publish_with_media            b38d88b5c1de33b467c880b898d4b13a
post_attach_media                  fef4bf755d6886817eaf3692bbaa9e26
media_begin_upload                 49cc53626afc1e1683eb4f830d84b572
media_mark_ready                   546879aa8799706ad66a47835e15fa23
media_migrate_post                 0b5f94797c1f2cd2ad285a8dddd2d0cd
media_migration_fence_digest       bd6c7bc1dfff2710629f9eabebfacbc6
media_migration_fence_digest_wide  bac9327adb53b0da35eff00e812319e6
media_migration_reconcile          7d86143364b044a367c4d07375a2144a
media_write_path_delta             241e632ea81dae17acebe9c01218c82c
post_media_for                     5ea99d5975ee68086b82aa2ee0b780b7   (unchanged)
```

**Git**

| | |
|---|---|
| PR #77 | `feat(media): widen the candidate population; evidence for D/E/F; the D-003 spec` → merged `6c11048` |
| PR #78 | `fix(media): close the stale-client hole that let the delta grow` → merged `248a4367` |
| main | `248a4367` |
| Live bundle | `/assets/index-X0RsPxIF.js`, `__APP_BUILD = "2026-08-20-1"` |

---

## 11. ITEM A — `measure-post-media`

**KEEP.** It is the only tool that can measure the class B/C population, and it did the
263-object measurement today. It expires **2026-09-01** by its own code (`410` thereafter),
so it cannot quietly become a permanent media API.

Re-evaluate only when D/E/F are resolved and no new legacy-only media is being produced.

---

## 12. REMAINING BLOCKERS

**Owner decisions — nothing proceeds on these without you:**

1. **Class F (27 slides / 15 posts).** Members' photographs are displayed at thumbnail
   resolution while 1920px originals exist on Supabase for 17 of 23 objects. Proposed:
   re-point `image_urls` at the originals, then migrate. This is a *quality* fix first.
2. **Class D + D′ (18 slides / 18 posts).** Mutable keys. A copy to a canonical immutable
   path is designable but changes what a historical post shows. Not started; the impact
   matrix stands.
3. **Class E (2 slides / 2 posts).** Owner at segment 3 — needs either a fourth candidate
   class with its own ownership rule, or a copy.
4. **D-003.** The Cloudflare connector is live. Say the word and the Worker, token
   contract and application endpoint get built against the specification in
   `docs/D003_AUTHORIZED_DELIVERY_SPEC.md`.

**Open risks I am carrying:**

- **The write path is still unproven end-to-end in production.** Zero posts have gone
  through it. `media_write_path_delta` is now the watch; `MEDIA-4001`/`4006` say why when
  it happens.
- **D-004 dual-write** still writes `image_urls`, and its removal condition — the Android
  binary no longer reading it — is outside this repository's control.
- **1 orphan media object**, no reaper. Deliberate, but it will accumulate as posts are
  deleted, and each future reconciliation will report `MIG-1071`/`MIG-1072` against it.
- **Resumed drafts are legacy-only by construction** (`WallPosts.tsx` sets `stored: null`
  for resumed URLs). Correct — the bytes are gone — but now counted, via `MEDIA-4006`.

---

## FINAL GATE

**Phase 2 is not complete.** **Phase 3 has not been started and nothing in it was touched.**
