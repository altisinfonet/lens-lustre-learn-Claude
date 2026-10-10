# Phase 2 — read-only audit of the remaining work

**Date:** 2026-08-19 · Nothing was modified: no code, schema, grants, deployment, manifest or production data. No Phase 3 work.

## The headline

The 207-photo migration is complete and correct, and **not one line of the application reads either new table.** A grep across `src/` for `media_objects` or `post_media` returns nothing outside `types.ts` and tests. The data layer is finished; the read layer has not started.

## 1. What the client switch actually requires

Four things, in this order, and only the first is a database change:

1. **A column-scoped `GRANT`.** RLS is already correct on both tables (below) but RLS without a `GRANT` denies everything. `anon` and `authenticated` currently have **no** privilege on either table.
2. **A read path** — either a `SECURITY DEFINER` RPC that returns a post's media, or a direct PostgREST select with an embedded resource.
3. **Component changes** to consume it, with `posts.image_urls` retained as the fallback for the 44 posts that are not in the migrated set.
4. **Nothing else.** `posts.image_urls` is not dropped, not rewritten, not deprecated in this phase.

### RLS as it already stands — correct, and privacy-aware

| table | policy | rule |
|---|---|---|
| `media_objects` | `media_objects_select` | `owner_id = auth.uid()` OR the media is referenced by a post the viewer may see (`can_view_post`) |
| `media_objects` | `media_objects_insert_own` | `owner_id = auth.uid()` |
| `post_media` | `post_media_select` | the post is visible to the viewer (`can_view_post`) |
| `post_media` | `post_media_write_own` / `post_media_delete_own` | the viewer owns the post |

These honour Only-me / Friends / Public already. Nothing about the policies needs changing.

## 2. Every read path that currently uses `posts.image_urls`

**Application (client) — 12 files that would change:**

| file | what it does |
|---|---|
| `src/hooks/feed/useFeedQuery.ts` | the feed query itself — line 114 selects `image_urls`, line 320 resolves the render list |
| `src/hooks/feed/useUserPostsQuery.ts` | profile / user post list |
| `src/pages/Feed.tsx` | two realtime insert/update paths |
| `src/pages/PostDetail.tsx` | single-post view, `allImages` |
| `src/pages/HashtagFeed.tsx` | hashtag feed, `FacebookPhotoGrid` |
| `src/components/post/PostCard.tsx` | the card's `imageUrls` |
| `src/components/profile/ProfilePostGrid.tsx` | 4 sites — tile source, fallback, slide counts |
| `src/components/WallPosts.tsx` | composer + realtime merge (write side) |
| `src/types/post.ts` | the `Post` type |
| `src/lib/imageLadder.ts` | comment: "the feed renders from `posts.image_urls` and there is no column…" — that statement stops being true |
| `src/components/post/DraftsList.tsx` | **drafts**, not posts |
| `src/components/post/ScheduledPostsList.tsx` | **scheduled posts**, not posts |

**Paths that must NOT change:**

- `DraftsList.tsx`, `ScheduledPostsList.tsx`, `usePostDrafts.ts`, `useScheduledPosts.ts` — these read `post_drafts.image_urls` and `scheduled_posts.image_urls`, different tables entirely. Out of scope.
- `WallPosts.tsx` and `MyPhotos.tsx` **write** paths — publishing still writes `posts.image_urls`. The upload engine is its own phase.
- `supabase/functions/publish-scheduled-posts` — its duplicate-detection hashes `image_urls`; changing it would change what counts as a duplicate.
- `supabase/functions/detect-orphan-files` — enumerates every URL column across 6 tables to find unreferenced storage objects. If the app starts rendering from `post_media` and this is not extended, **orphan detection would start proposing live files for deletion.** Read-only today; must be extended *before* anything ever deletes based on it.
- `supabase/functions/backfill-thumbnails`, `backfill-image-dims`, `dashboard-init` — server-side, still legitimately on `image_urls`.

## 3. The minimum grant, with `sha256` inaccessible

`media_objects.sha256` is `bytea`. Column-scoped grants are the mechanism:

```
GRANT SELECT (id, owner_id, width, height, bytes, mime, visibility, derivatives,
              state, created_at)
  ON public.media_objects TO anon, authenticated;

GRANT SELECT (post_id, ord, media_id)
  ON public.post_media  TO anon, authenticated;
```

`sha256`, `verified_at` and `quarantine_reason` are deliberately omitted. A client `select('*')` then fails loudly rather than leaking — which is the correct behaviour and must be covered by a test.

**Three things to prove before that grant is written:**

- **a. Does the RLS policy still evaluate?** `media_objects_select` sub-selects `post_media` and `posts`; `post_media_select` sub-selects `posts`. Policy expressions run as the querying role, so those reads must be permitted too. `posts` already is. This needs proving on a branch, not assuming.
- **b. Cost.** `media_objects_select` runs a correlated `EXISTS` over `post_media ⋈ posts` per row. There is **no index on `post_media.post_id` alone** — the primary key is `(post_id, ord)`, which serves it, but the join from `media_id` uses `post_media_media_id`. Measure before enabling; a feed page pulling 20 posts × N slides is the load to test.
- **c. The alternative.** A `SECURITY DEFINER` RPC returning `(post_id, ord, object_path, width, height, mime)` needs **no client grant at all** and cannot leak a column by accident. Strictly safer. The trade is one round trip and no PostgREST embedding.

## 4. The gap the switch does NOT close

D-002 stands. The `post-images` bucket is public and its `storage.objects` SELECT policy is `(bucket_id = 'post-images')` with no privacy condition. Reading a Friends-only post's media through `post_media` instead of `image_urls` changes **nothing** about who can fetch the file by URL.

**`PrivacyGapNotice` must stay shipped.** `PrivacyGapDisclosed.test.ts` enforces it, and it becomes correct to remove only when authorized delivery is live — not when this switch lands.

## 5. The 19 post-fence photographs — a separate population

Measured read-only, 2026-08-19 13:4x UTC:

```
items                 19
posts                 15
owners                12
earliest              2026-08-17 13:23:31.641699+00
latest                2026-08-19 11:50:36.227005+00
already referenced     0        (none touched by the 207 migration)
delta key-set md5     31eb7da488bab8ec4d49dfdae4339d2d
carry -wXhY in name   19 of 19
```

**This digest is a snapshot, not a fence.** The population grows daily — it was 18 this morning and 19 this afternoon. The delta cycle must: pick a new fence, re-measure with a measurement function (see §6), produce a new manifest with its own SHA-256, and be approved on its own hashes. **Do not extend the 207 manifest or move the frozen fence.**

## 6. Can `measure-post-media` be removed?

**Not yet — it is the only tool that can measure the delta.**

- It is deployed (version 1, `verify_jwt: true`) and listed in `supabase/config.toml`.
- It carries a **self-expiry: it returns 410 after 2026-09-01** without any action from anyone.
- `src/__tests__/measurePostMediaReadOnly.test.ts` pins it read-only, admin-only, and unable to fetch a caller-named URL. Deleting the function breaks that test — deliberately.
- `docs/MANIFEST_PROVENANCE.md` names it as the provenance of the 207 measurements.

**Correct sequence:** run the delta measurement first, then remove the function *and* its test in the same commit, and update the provenance doc. Removing it now would mean redeploying it to measure the delta.

Note `backfill-media-objects` — the abandoned scanner — is **not deployed** (absent from the live function list) but its source is still in the repo, referenced by tests as the negative example. Leave it.

---

# REMAINING WORK, IN THE SAFEST ORDER

| # | Cycle | Depends on | Risk | Reversible |
|---|---|---|---|---|
| **1** | **Delta measurement** — new fence, re-measure the ~19+, produce a new manifest + SHA | measure-post-media still deployed | none (read-only) | n/a |
| **2** | **Delta migration** — same engine, new manifest, hash-bound | 1 | low (engine proven on 207) | rows, deliberately |
| **3** | **Remove `measure-post-media`** — function, config entry, its test, provenance note | 2 | none | redeploy |
| **4** | **Read-path design decision** — RPC vs column-scoped grant | — | none | n/a |
| **5** | **The grant or the RPC** — proven on a Supabase branch first | 4 | **highest of all** — a wrong grant exposes `sha256`; a wrong policy read exposes private media | yes, revoke |
| **6** | **Extend `detect-orphan-files`** to know about `post_media` | 5 | must precede any deletion | yes |
| **7** | **Client switch** — 12 files, `image_urls` kept as fallback | 5, 6 | medium | yes |
| **8** | **Authorized media delivery** — closes D-002, then and only then delete `PrivacyGapNotice` | 7 | high | — |

**Why 1–3 come before 4–8:** the delta population grows every day the switch is delayed, and `measure-post-media` self-expires on 2026-09-01. Doing the client work first leaves a growing set of photographs that exist in `posts.image_urls` but not in `post_media` — precisely the inconsistency the switch must not ship with.

**Why 5 is the dangerous one:** every other step is additive or cosmetic. The grant is the only one that changes who can read member data, and `sha256` leaking would hand out content-identity fingerprints for every photograph on the platform.

**Not started, and not to be started:** Phase 3.
