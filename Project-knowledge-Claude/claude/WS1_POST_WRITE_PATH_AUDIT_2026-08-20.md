# WORKSTREAM 1 — EXHAUSTIVE POST WRITE-PATH AUDIT

**Date:** 2026-08-20 · **Repo HEAD:** `f6cbc16` · **Production:** read-only, unmodified
**Scope:** every route by which a row can appear in `public.posts`

> **NO production changes. No deployments. No migrations. Phase 3 untouched.**

---

## EXECUTIVE CONCLUSION

| | |
|---|---|
| Distinct write surfaces found | **9** (7 direct/indirect producers + 2 deferred feeders) |
| Currently reachable in production | **8** (1 is dead) |
| Legacy-only capable (**RED**) | **3** |
| Media-graph-safe (**GREEN**) | **2** — and one of them **has never executed in production** |
| Previously unknown surfaces discovered | **4** |
| **Critical defect found** | **YES — 1, latent, on the primary publish path** |

### The three findings that matter

1. **🔴 CRITICAL — the primary publish path is broken by a detached method reference.**
   `src/lib/media/postMediaWrite.ts:137` and `:259` store `supabase.rpc` in a variable
   and call it. `supabase-js` defines `rpc` as a prototype method returning
   `this.rest.rpc(...)`; a detached call runs with `this === undefined` and throws
   `TypeError: Cannot read properties of undefined (reading 'rest')`.
   **This is the exact bug the repository already documents as a live production outage**
   (`src/hooks/feed/usePostDrafts.ts:89-108`, reported from the Android app 2026-08-17).
   **Corroborated by production data: 0 of 252 posts carry an `idempotency_key`, which
   `post_publish_with_media` always sets. That function has never created a post.**

2. **🔴 NEW — duplicating a scheduled post drops its media, its privacy, its SEO
   opt-out and its categories.** `ScheduledPostsList.tsx:137` omits four fields;
   `useScheduledPosts.ts:126-130` then defaults them. A duplicate of a *private*,
   search-excluded, categorised scheduled post publishes **public, indexable,
   uncategorised and legacy-only**. Latent — 0 pending scheduled posts today.

3. **🟡 NEW — a resumed draft silently ignores its own schedule.**
   `WallPosts.tsx:2281` routes on `draftId`, so `publishResumedDraft` runs and publishes
   **immediately**, while the button's disabled predicate still validates the
   5-minute/90-day schedule window.

---

## COMPLETE WRITE-SURFACE MATRIX

| # | Surface | File:Line | Function | Caller | Prod reachable | image_urls | media_objects | post_media | Atomic | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Composer publish (media) | `src/lib/media/postMediaWrite.ts:264` | `publishViaMedia` → RPC `post_publish_with_media` | `WallPosts.tsx:1287`; mounted at `Feed.tsx:311`, `Layout.tsx:290`, `PublicProfile.tsx:1085` | **reachable but THROWS** (see §RED-1) | derived server-side | yes | yes | **yes** | 🟢→**🔴 broken** |
| 2 | Composer legacy fallback | `src/components/WallPosts.tsx:1308` | `createPost` → `.from("posts").insert` | same | yes | **client-supplied** | no | **no** | n/a | 🔴 |
| 3 | Album upload | `src/pages/MyPhotos.tsx:409` | `handleAddPhotos` → RPC `create_system_post(_media_ids)` | route `/my-photos`, `App.tsx:163` | yes | yes | yes (pre-registered) | yes (guarded) | post+attach in one txn | 🟡 |
| 4 | Profile/cover announcement | `src/lib/profilePostHelper.ts:41` | `createProfileUpdatePost` → RPC `create_system_post(NULL)` | `EditProfile.tsx:18` | yes | yes | **no** | **no** | n/a | 🔴 *by design* |
| 5 | Draft publish | `src/hooks/feed/usePostDrafts.ts:281` | `usePublishDraft` → RPC `publish_post_draft` | `WallPosts.tsx:1057`, `DraftsList.tsx:26` | yes | from draft row | at draft-save time | conditional (DRAFT-005) | post+attach in one txn | 🟡 |
| 6 | Scheduled publish | `supabase/functions/publish-scheduled-posts/index.ts:238` | service_role `.from("posts").insert` | **pg_cron jobid 11, `* * * * *`, ACTIVE** | yes | from scheduled row | at schedule time | conditional (MEDIA-4005) | insert then attach | 🟡 |
| 7 | **Scheduled duplicate** | `src/components/post/ScheduledPostsList.tsx:137` | `handleDuplicate` → `useCreateScheduledPost` | route `/scheduled-posts`, `App.tsx:431` | yes | copied | **dropped** | **dropped** | n/a | 🔴 **NEW** |
| 8 | *feeder* — schedule branch | `src/components/WallPosts.tsx:1221` | `createPost` schedule branch → `scheduled_posts` | same as #1 | yes | yes | pre-registered | via #6 | n/a | 🟡 **NEW** |
| 9 | *feeder* — draft autosave | `src/components/WallPosts.tsx:1009` | `saveDraft` → `post_drafts` | same as #1 | yes | yes | pre-registered | via #5 | n/a | 🟡 **NEW** |
| — | `media-verify-upload` | `supabase/functions/media-verify-upload/index.ts` | — | **none** | **NO** — absent from `config.toml`, not deployed, zero invocations | — | — | — | — | ⚫ GRAY |

**Server-side retry loop (no UI, invisible to an `insert` grep):**
`publish-scheduled-posts/index.ts:336-368` `shift()` re-arms a failed row to `pending`
with a later `scheduled_for`, up to `MAX_SHIFTS` — producing a post row on a *later*
cron invocation from a row the member never touched again. Inherits #6's status.

---

## COMPLETE LIFECYCLE DIAGRAM

```
① COMPOSER — IMMEDIATE  (the intended GREEN path — currently throws)
   file → uploadImageWithThumbnail → R2 (post-images/<owner>/posts/…)
        → describeStoredObject (sha256 + dims of the ENCODED bytes)
        → media_begin_upload (RPC)              ◀── THROWS HERE, detached rpc
        → media-register-upload (edge v2, re-reads + re-hashes the object)
        → media_mark_verified → media_mark_ready
        → post_publish_with_media (ONE txn: post + all post_media, image_urls DERIVED)
        → post_media_for (read)
   ON ANY REFUSAL ▶ ② ; ON THROW ▶ no post at all (POST-2003)

② COMPOSER — LEGACY FALLBACK  🔴
   uploaded URLs → .from("posts").insert({image_urls, thumbnail_urls, …})
        → NO media_objects, NO post_media → MEDIA-4001 → post_media_for returns nothing
        → renderer falls back to image_urls

③ ALBUM (MyPhotos)  🟡
   files → R2 (avatars/<owner>/my-photos/<album>/…)
        → registerAllOrNone (all-or-none)
        → create_system_post(_media_ids)  ─ txn ─▶ posts + post_attach_media (guarded)
        → on attach refusal: post survives, MEDIA-4008 warning, legacy-only

④ PROFILE / COVER ANNOUNCEMENT  🔴 by design
   avatar.webp?t=… (MUTABLE) → create_system_post(NULL) → posts only
        → MEDIA-4007 (permanent floor, never migratable)

⑤ DRAFT  🟡
   saveDraft → registerAllOrNone → post_drafts{media_ids}
        … later …
   publishResumedDraft → publish_post_draft ─ txn ─▶ posts + post_attach_media (guarded)

⑥ SCHEDULED  🟡
   schedule branch → registerAllOrNone → scheduled_posts{media_ids}
        … pg_cron every minute …
   publish-scheduled-posts → .from("posts").insert → post_attach_media (non-fatal)
        → on failure: shift() re-arms, retries later

⑦ SCHEDULED DUPLICATE  🔴 NEW
   existing row → handleDuplicate (drops media_ids, privacy, indexing_disabled, categories)
        → scheduled_posts{media_ids:NULL, privacy:'public'}
        … cron …
        → posts: legacy-only, PUBLIC, indexable, uncategorised
```

---

## RED SURFACES — can still produce POST + image_urls + NO post_media

### RED-1 · **CRITICAL** · The composer's media path throws before it can publish

**File:** `src/lib/media/postMediaWrite.ts:137` (and identically `:259`)

```ts
const rpc = supabase.rpc as unknown as <T>(…) => …;   // ◀ DETACHED
const { data: mediaId, error } = await rpc<string>("media_begin_upload", {…});
```

`node_modules/@supabase/supabase-js/dist/index.mjs:291-296`:

```js
rpc(fn, args = {}, options = {…}) { return this.rest.rpc(fn, args, options); }
```

Verified empirically — a detached call throws
`TypeError: Cannot read properties of undefined (reading 'rest')`.

**The repository already documents this exact bug**, in `usePostDrafts.ts:89-108`:

> *"⚠ CALL IT, NEVER COPY IT. This line was `const rpc = supabase.rpc as …`, and that
> single word of difference stopped members publishing from the app… Reported from the
> live Android app 2026-08-17; introduced 2026-08-12."*

`postMediaRead.ts:146` uses the **safe** in-call-position form and works in production.
The comment at `postMediaWrite.ts:133-136` claims it matches `postMediaRead.ts` — **it
does not.**

**Blast radius.** `publishViaMedia` has no internal try/catch, so the throw propagates past
the legacy fallback at `WallPosts.tsx:1304` into the outer catch — **the member gets
"Could not publish" and no post at all.** Same throw reaches `registerAllOrNone` from the
schedule branch (`:1211`), `saveDraft` (`:987`) and `MyPhotos.tsx:385`.

**Production corroboration:** `select count(idempotency_key) from posts` → **0 of 252**.
`post_publish_with_media` always sets it. It has never run. All 264 `media_objects` were
created by `media_migrate_post` (the migrator), not by the live path.

**Why the suite is green:** `src/__tests__/mediaWritePath.test.ts:109` mocks the client as
a plain object literal whose `rpc` is an own-property function — detaching an own property
off an object literal is harmless. The mock cannot reproduce a prototype-method receiver.

### RED-2 · **NEW** · Duplicating a scheduled post drops four fields

**File:** `src/components/post/ScheduledPostsList.tsx:137-145`

Passes `content, image_urls, thumbnail_urls, image_url, tagged_user_ids, scheduled_for`.
Omits **`media_ids`, `privacy`, `indexing_disabled`, `categories`** — all of which exist on
the source row (`select("*")` at `useScheduledPosts.ts:63`).

`useScheduledPosts.ts:126-130` then defaults them, and production confirms the columns:
`privacy NOT NULL DEFAULT 'public'`, `indexing_disabled NOT NULL DEFAULT false`,
`categories NOT NULL DEFAULT '{}'`, `media_ids` nullable.

**Consequences:** legacy-only post; **privacy silently downgraded to public**; SEO opt-out
lost; categories lost. The privacy downgrade is the more serious of the two.
Once Phase B's `POST-CAT-002` minimum activates, every duplicate will additionally fail at
publish and `shift()` until `max_shifts_exceeded`.

**Status: latent.** Production has 1 scheduled post ever (published 2026-07-03), 0 pending.

### RED-3 · By design · Profile/cover announcements

`src/lib/profilePostHelper.ts:41` → `create_system_post(_media_ids: null)`. The URL is
`avatars/<owner>/avatar.webp?t=…`, overwritten in place on every change, so it can never
carry content identity — `media_mark_ready` refuses it (MEDIA-2102) and
`media-register-upload` refuses it by name. Correctly counted as **MEDIA-4007**, and
excluded from `delta_growing`. **Not a defect.** 18 posts / 18 slides.

---

## GREEN SURFACES

| Surface | Guarantee | Caveat |
|---|---|---|
| `post_publish_with_media` (the RPC itself) | One transaction: post + every `post_media` row + completeness gate; `image_urls` **derived** from `media_objects.derivatives`, never supplied | The **RPC is sound**; its **caller cannot reach it** (RED-1). Body md5 `b38d88b5…`, DEFINER, `authenticated` |
| `post_attach_media` | Ownership, readiness, dense ordinals, and **MEDIA-2205** (each object's delivery URL must EQUAL `image_urls[ord]`) | `service_role` only — a client can never call it directly. Body md5 `fef4bf75…` |

Everything else that touches the media graph (#3, #5, #6) is **🟡 YELLOW**: the attach is
deliberately *guarded*, so a refusal costs the member the media references but not the post.
That is a considered trade-off, not an oversight — but it means none of them can be called
atomically-green.

---

## DEAD / UNREACHABLE SURFACES

| Item | Evidence it is dead |
|---|---|
| `supabase/functions/media-verify-upload/` | **Absent from `supabase/config.toml`**, not in the deployed function list, **zero invocations** in `src/` or `supabase/` (only prose references). Would strand every upload at `pending` if deployed — it derives `post-images/<owner>/media/<id>/original.<ext>`, a layout 0 of 264 objects use |
| `post_publish_with_media` 6-arg overload | Dropped at `20260820061500_media_write_path_live.sql:279`; production shows only the 7-arg signature |
| `publish_post_draft` (2026-08-12 version) | Superseded by `CREATE OR REPLACE`; production body md5 `3c208e23…` matches the current migration |
| `create_system_post` 4-arg overload | Dropped; production shows only the 5-arg signature |
| `harness/b4/*.sql`, `harness/b5/*.sql` | Raw `INSERT INTO posts`; `b4/03_races.sh:6` pins psql to a **local unix socket** (`/tmp/pgrun:5433`, db `harness`). ⚠ The `.sql` files carry **no `current_database()` guard** — safe only because of how they are invoked |
| `src/uiharness/*` | `fakeBackend.ts` replaces `window.fetch`/`WebSocket` before any app module loads |
| `useRescheduleScheduledPost` | Exported at `useScheduledPosts.ts:145`, **zero call sites** |
| `/__crop-test`, `/dev/phase7-badges`, `/qa/watermark-matrix` | Ship in the production router (`App.tsx:372,420,430`) but import no supabase client — pure UI |

---

## DATABASE-LEVEL FORENSIC TRACE

Exhaustive scan of **every function in every schema** whose body inserts into `posts`
(corrected for Postgres regex — `\b` is a backspace, not a word boundary; the first
attempt silently returned zero rows):

| Function | Args | Security | EXECUTE grants | Body md5 |
|---|---|---|---|---|
| `create_system_post` | `text, text, text[], text[], uuid[]` | DEFINER | `authenticated`, `service_role` | `2a90beb4…` |
| `post_publish_with_media` | `uuid[], text, text, text[], boolean, text, text[]` | DEFINER | `authenticated`, `service_role` | `b38d88b5…` |
| `publish_post_draft` | `uuid` | DEFINER | `authenticated`, `service_role` | `3c208e23…` |

**Exactly three. No fourth.** `media_migrate_post` matched a name search but only
*mentions* `post_publish_with_media` in a comment — it never inserts into `posts`.

**Triggers:** 9 on `posts`, 2 on `scheduled_posts`, 1 each on `post_drafts`/`post_media`/
`media_objects`. **None inserts into `posts`** — all are validation, moderation, rate-limit,
hashtag sync, fan-out or queue-enqueue. Verified by scanning every trigger function body.

**Table grants — the reason a direct client insert is possible at all:**

```
posts            → anon, authenticated: DELETE, INSERT, SELECT, UPDATE
scheduled_posts  → anon, authenticated: DELETE, INSERT, SELECT, UPDATE
post_drafts      → authenticated:       DELETE, INSERT, SELECT, UPDATE
```

RLS INSERT policies bound them to `user_id = auth.uid()`, not-banned, account-live — so
`anon` cannot actually insert (its `auth.uid()` is NULL), but **`authenticated` can insert
a post directly**, which is precisely what surface #2 does.

**Schedulers (`pg_cron`, 17 active jobs):** exactly one touches posts —
**jobid 11 `publish-scheduled-posts`, `* * * * *`, active**, via `net.http_post`. *(This
corrects an earlier report that claimed no cron registration existed for it — it exists,
it is just configured outside the repo.)* `jobid 12 process-post-jobs` runs
`process_post_jobs(100)` every 5s; verified it neither inserts posts nor calls pg_net.

---

## PRODUCTION CROSS-CHECK

| Check | Result |
|---|---|
| Posts with `idempotency_key` | **0 / 252** → `post_publish_with_media` has never run |
| Posts with partial refs (`0 < refs < slides`) | 0 |
| `post_media` rows orphaned from posts | 0 |
| References owned by someone other than the post author | 0 |
| Unexpected `post_kind` values | 0 |
| `media_objects` not ready | 0 |
| 12 most recent posts | all `refs == slides` |
| Legacy-only posts created since 05:16:24 UTC | **0** |
| `client_errors` since deploy (POST-2003 / MEDIA-4xxx / TypeError) | **none** — the path has not been exercised from a current bundle |
| Scheduled posts | 1 ever, published 2026-07-03, 0 pending |
| Deployed edge functions | `media-register-upload` v2 `405127a9…`, `migrate-post-media` v2 `267aa65a…`, `measure-post-media` v2 `990043d2…`, `publish-scheduled-posts` v23 `85c17618…` |

---

## TWO-PASS VERIFICATION (§8)

| Pass | Method | New surfaces |
|---|---|---|
| 1 | `.from("posts")`, `INSERT INTO posts`, `posts.insert/upsert` across the whole repo | baseline 6 |
| 2 | RPC call sites by name; every `image_urls:` write; all `.rpc("…")` literals | **caught what pass 1 missed** — the narrow-cast call sites (`)("create_system_post", {`) are invisible to a `.rpc("` grep |
| 3 | Adversarial hunt — duplicate/clone/retry/import flows, dynamic table names, deferred feeders | **+4 new** (#7, #8, #9, `shift()`) and **RED-1** |

Pass 2 and pass 3 each found things pass 1 could not. The inventories were reconciled and
every discrepancy investigated before this report.

---

## UNKNOWN / NEEDS EXTERNAL VERIFICATION

1. **The Android binary.** It reads `image_urls` and cannot be built or inspected from this
   repository. Whether it has its own post-creating path is **unverifiable here**.
2. **RED-1 in the wild.** Certain by source and by the `idempotency_key = 0` evidence, but
   **not yet observed as a member-facing failure**, because nobody has published a
   photograph from a current bundle since the write path shipped. The first one will fail.
3. **`harness/b4`, `b5` SQL.** No `current_database()` guard. Safe as invoked today; I could
   not prove no other invocation path exists.

---

## FINAL ANSWER

**1. Have we found EVERY way a production post can currently be created?**
Yes, for everything reachable from this repository and this database — bounded by an
exhaustive `pg_proc` scan (3 functions), a complete trigger scan (0), the full `pg_cron`
inventory (1 relevant job), and three independent repository passes. The one genuine gap is
the Android binary (§UNKNOWN-1).

**2. Can any currently reachable path still create an image_urls-only post?**
**Yes — three.**

**3. Exactly which?**
- **#2 composer legacy fallback** — and, because of **RED-1**, it is currently the *only*
  way the composer can succeed at all… except it cannot, because the throw bypasses it.
- **#7 scheduled duplicate** — drops `media_ids` *and* silently downgrades privacy to public.
- **#4 profile/cover announcement** — by design, permanent, correctly counted.

**4. What is the safest fix?**
1. **RED-1 (do first, one line each):** change `postMediaWrite.ts:137` and `:259` from
   `const rpc = supabase.rpc as …` to the in-call-position form already used safely at
   `postMediaRead.ts:146`, or the arrow wrapper at `usePostDrafts.ts:109`. Then **fix the
   test mock** so it uses a class/prototype method — the current object-literal mock cannot
   catch this class of bug, and a mutation test that detaches the method should be added.
2. **RED-2:** pass `media_ids`, `privacy`, `indexing_disabled`, `categories` through
   `handleDuplicate`. Consider making them required on `CreateScheduledPostInput` so
   omission is a compile error rather than a silent default.
3. **Defence in depth:** wrap `publishViaMedia` in try/catch so an unexpected throw
   degrades to the legacy fallback rather than costing the member the post.
4. **RED-3:** no fix — document only.

**5. Does fixing those stop the migration delta from growing?**
**Fixing RED-1 and RED-2 removes every *unintended* source.** The delta then has a
permanent floor of profile/cover announcements (#4), which the detector already reports
separately as `permanent_legacy_*` and excludes from `delta_growing`. So: yes for the leak,
no for the floor — and the floor is correct.

**6. What remains for Phase 2 after this workstream?**
- Fix RED-1 and RED-2 (repository work, small, high value).
- Prove the composer path end-to-end in production — **still never executed**.
- The 47 retained legacy slides (18 permanent floor, 29 migratable backlog) and the
  unapplied class-F repair.
- **D-002/D-003** — blocked on Cloudflare, unchanged by this audit.

**7. What percentage of Phase 2 should this workstream represent?**
**~5 points of the 100**, as audit. But its *findings* move the assessment: Priority 1 was
being scored 10/10 on the strength of an architecture that, on this evidence, **has never
successfully run in production**. I would score Priority 1 at **7/10** until RED-1 is fixed
and one real post is observed going through it — which moves overall Phase 2 from 92% to
about **89%**.

That correction is the most useful output of this workstream.
