# VID-1 · 20261013_0004 — `video_publish_post()` no longer reads `post_media` as the member

**Unit:** VID-1 follow-up (plan REV4 §6 Stage A "VID follow-ups (a)"; independent review of PR #424). D1.
**State:** code only. Nothing applied to any database, no workflow dispatched.

**Gate:** `PROBE_20261013_0004_vid1_publish_post_media_definer.sql` passes on staging through
`apply-migration.yml` after `20261013_0004` is applied; a member can publish a video post with no
table privilege on `post_media`; a member cannot reach another member's `post_media` through the
helper, and `anon` cannot execute it.

Where each statement below comes from:

| mark | meaning |
|---|---|
| **V-staging** | read by this session, read-only (`begin read only; … rollback;`, catalog `SELECT`s only), staging `fpszggreishhuvdpkmdr`, 2026-10-13 11:26Z–11:40Z |
| **V-dump** | read by this session from the read-only production collector dump `_control/forensic/supabase-20261013-121953/live/db/*.json` (files; production was never connected to) |
| **V-fixture** | produced by this session on a throwaway database (`scripts/db-vid1-publish-fixture.mjs`) |
| **V-repo** | read from this tree |

## 1. The defect, exactly

`public.video_publish_post(uuid,text,text,text[],text)` (20261011_0003) is `SECURITY INVOKER`.
Every table access it makes runs with the member's privileges (V-repo, the 20261011_0003 body):

| table | access | where in the body | production privilege for `authenticated` |
|---|---|---|---|
| `posts` | SELECT | replay lookup (own `user_id` + key); `image_urls`/`image_url` check | yes — `authenticated=arwdm/postgres` (V-dump) |
| `posts` | INSERT | the new post | yes |
| `post_videos` | SELECT, INSERT | link lookup; the link | table arrives on production with VID-1; staging `authenticated=ard` (V-staging) |
| **`post_media`** | **SELECT** | `EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = _post)` in the replay branch | **none** — `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`, no column grants (V-dump) |

Nothing in it writes `post_media`.

PostgreSQL checks the privileges of **every** relation in a statement before running it, so the whole
`IF … OR EXISTS (… post_media …)` raises 42501 — even when its first half (`image_urls`) is already
true (V-fixture, B2).

**Scope of the failure — narrower than "every publish".** Affected: a replay (same member, same
idempotency key) that finds the member's post **not linked** to a video — a post left by the older
two-step publish, or a photo post holding that key. It raises `42501 permission denied for table
post_media` instead of linking / refusing with VID-PUB-003. **Not** affected: a first publish, and a
replay of a publish that already linked — neither reaches the statement (V-fixture, B4).

Staging hid it: 20261013_0001 kept `authenticated` SELECT on `post_media` for this one function
(staging relacl `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}`, V-staging).

## 2. The change

1. `public.video_publish_own_post_has_media(_post_id uuid) RETURNS boolean` — `SECURITY DEFINER`,
   `STABLE`, `LANGUAGE sql`, `SET search_path = ''`. Its WHERE clause is the whole control:
   `pm.post_id = _post_id AND p.user_id = (SELECT auth.uid())` (joined to `posts`), no `OR`. It
   answers only about the caller's own post; false for any other post, for no session, for NULL. It
   returns a boolean, never a row. EXECUTE: `authenticated`, `service_role`; never `PUBLIC`, never
   `anon` (the migration revokes from all four first, because Supabase's default privileges grant
   every new function in `public` to the API roles).
2. `video_publish_post()`: the same body with the `post_media` EXISTS replaced by a call to the
   helper. Still `SECURITY INVOKER`; ACL unchanged.
3. `REVOKE ALL ON public.post_media FROM PUBLIC, anon, authenticated` — staging's last `post_media`
   keep goes, so staging's ACL = production's. On production: nothing to remove. POST-001 asserts the
   effect (`has_table_privilege`), not the statement's success (F-62).

**Why `PROBE_20261013_0001` changes in this PR.** That PROBE asserted the post-20261013_0001 state,
which included the keep (`post_media / authenticated / SELECT`, 6 keeps). After 20261013_0004 the
keep is gone, so its row now expects no privilege (5 keeps) and its informational G5 fingerprint
names both states. Computed on staging (V-staging): today 3733 lines, md5
`9d0aa7be29390cec83399062bb593d61` (= 20261013_0001's recorded post-state, nothing moved since);
with the one line `T|post_media|authenticated|SELECT|postgres|false` removed: 3732 lines, md5
`782148147c2883ecb00d91ec21c72661`. Consequence: `PROBE_20261013_0001` fails on staging until
20261013_0004 is applied, and passes after it. 20261013_0001's ROLLBACK refuses once 20261013_0004
is applied (its RB-PRE-001 fingerprint includes `post_media`) — roll 20261013_0004 back first.

## 3. Callers of `authenticated` SELECT on `post_media` (checked before revoking)

| place | finding | source |
|---|---|---|
| functions naming `post_media`, staging | 8 `SECURITY DEFINER` + `video_publish_post` (the only `SECURITY INVOKER`) | V-staging |
| functions naming `post_media`, production | the same 8, all `SECURITY DEFINER`; no `SECURITY INVOKER` one | V-dump |
| RLS policies naming `post_media` | `post_media`'s own 3 + `media_objects_select`; anon/authenticated hold no privilege on `media_objects` on either lane | V-staging, V-dump |
| views / matviews | none | V-staging, V-dump |
| publications | `post_media` in none | V-staging, V-dump |
| INSERT triggers on `posts` | all `SECURITY DEFINER` except `enforce_post_categories()`, which does not name `post_media` | V-staging, V-dump |
| `src/**`, `functions/**` | no `.from("post_media")`, no embedded `post_media(...)` select; client reads go through `post_media_for()` | V-repo (grep, b93444b5) |
| `supabase/functions/**` | 5 `.from("post_media")` calls in `backfill-media-objects`, `detect-orphan-files`, `migrate-post-media` — every one on the service-role client (`adminClient` / `admin`) | V-repo (grep, b93444b5) |
| `pg_stat_statements` on staging | not read by this session | — |

PRE-005 re-reads the catalog half at apply time and refuses if a caller has appeared.

## 4. Proof on a database shaped like each lane

`scripts/db-vid1-publish-fixture.mjs` runs the **real files verbatim** (20261011_0003,
20261013_0004, its PROBE and ROLLBACK, 20261011_0002's `detect_duplicate_post()`) over
`supabase/tests/vid1-publish-post-media/` in two shapes, acting as `authenticated` / `anon` through
`SET ROLE` + JWT claims as PostgREST does:

* **production shape** — `post_media`: nothing for anon/authenticated (V-dump);
* **staging shape** — the same plus 20261013_0001's keep (V-staging).

CI: `d1-vid1-publish-fixture.yml` (postgres:17.6 service container, psql). Local run (PGlite
0.3.16, in-process PostgreSQL 17):
[`vid1-publish-post-media-definer-transcript.txt`](vid1-publish-post-media-definer-transcript.txt) —
**45 steps, 0 failed** (V-fixture).

What the fixture reduces is listed in `10_production_shape.sql`'s header (columns, policy helper
functions, the other `SECURITY DEFINER` triggers on `posts`; its owner is a superuser where
Supabase's `postgres` is a non-superuser owner with BYPASSRLS — both bypass RLS in the helper).

## 5. Failing first

**Fixture (V-fixture).** The AFTER assertions (`40_after.sql`) are run against the **unfixed**
20261011_0003 body as a step of the fixture, in a rolled-back transaction, and the run is red
unless they fail there:

```
══ PRODUCTION SHAPE ══
PASS  BEFORE: the 20261011_0003 body as a member
        ✓ B1 replay of an unlinked post (the older two-step publish): 42501: permission denied for table post_media
        ✓ B2 replay of a photo post whose image_urls already say so: 42501: permission denied for table post_media
        ✓ B3 replay of a photo post known only by post_media: 42501: permission denied for table post_media
        ✓ B4 a first publish never reaches the statement: ok
        ✓ B5 a member reading post_media directly: 42501: permission denied for table post_media
PASS  FAIL-FIRST: the AFTER assertions are red on the unfixed body  → refused with permission denied for table post_media
        ✗ ERROR:  permission denied for table post_media
PASS  PROBE fails before the apply  → refused with PROBE FAIL VID-PM

══ STAGING SHAPE ══
PASS  FAIL-FIRST: the AFTER assertions are red on the unfixed body  → refused with FIXTURE FAIL A7
        ✓ A1 … A6   (the keep lets the unfixed body work on staging — which is how staging hid the defect)
        ✗ ERROR:  FIXTURE FAIL A7 a member reading post_media directly is refused: got [ok] want [42501: permission denied for table post_media]
```

After 20261013_0004, on **both** shapes: A1–A13c all pass — the replay links and returns the post
(A1/A2), photo posts are refused through the helper (A4/A5), a first publish writes post + link (A6),
direct read/write of `post_media` → 42501 (A7/A7b); **cross-member → false both ways (A8c: A asks
about B's post; A9b: B asks about A's)**, owner → true (A8/A9), no session → false (A12b),
**anon → 42501 on the helper, on `video_publish_post` and on `post_media` (A13/A13b/A13c)**.
Refusals fire: no lane (`APPLY REFUSED`), wrong lane (`VID-PM-PRE-003`), re-run (`VID-PM-PRE-001`),
PROBE before the apply and after the rollback (`PROBE FAIL VID-PM`), rollback twice
(`VID-PM-RB-PRE-001`). The ROLLBACK restores each shape's own pre-state (production shape: the 42501
returns; staging shape: the keep returns), the file re-applies after it, and 20261011_0003's own
PROBE still passes.

**Static tests (V-repo).** `src/__tests__/videoPublishPostMediaDefiner.test.ts` + the updated C2
test in `videoPublishAtomic.test.ts`, with `20261013_0004_…sql` held out of the tree:
**12 failed / 17 passed (29)**. With it: **29 passed**.

**The PROBE on live staging.** It was **not run** by this session (a PROBE is dispatched through
`apply-migration.yml`; this session reads catalogs only). That it fails on today's staging follows
from catalog readings (V-staging, 2026-10-13 11:26Z), each of which is one of its checks:

| PROBE check | today's staging | fails? |
|---|---|---|
| G2 helper exists | `to_regprocedure('public.video_publish_own_post_has_media(uuid)')` is NULL | yes |
| G1 `authenticated` holds nothing on `post_media` | relacl has `authenticated=r/postgres` | yes |
| G3 `video_publish_post` body md5 = `243e37c6c8bd8403b19d43ad4c57220d` | md5 `2f326237f4df8c1d33b647dfd4ab81bc` (= the 20261011_0003 file) | yes |
| G4 no `SECURITY INVOKER` function names `post_media` | `video_publish_post(uuid,text,text,text[],text)` does | yes |
| G5 has something to test with | 6 `post_media` rows on 2 posts — the cross-member check is not vacuous | — |

and the same PROBE file does fail before the apply and pass after it on both fixture shapes (§4).
Dispatching the PROBE **before** the apply (command in §7) records the live failure.

## 6. Preconditions the migration relies on, as read on staging (V-staging)

* `video_publish_post`: md5 `2f326237f4df8c1d33b647dfd4ab81bc`, `SECURITY INVOKER`,
  `search_path=""`, owner `postgres`, ACL `{postgres=X,authenticated=X,service_role=X}` (PRE-002).
* `post_media`: owner `postgres`, the relacl in §1, no column grants (PRE-003, PRE-004).
* `postgres` may `SET ROLE authenticated` / `anon` (PRE-007; POST-005 and PROBE G5 test by effect).
* Production (V-dump): `postgres` is not a superuser, holds BYPASSRLS, owns `posts`/`post_media`;
  RLS is on and **not forced** on both — so the helper bypasses RLS and its WHERE is the only control.

## 7. Order and commands (not run — the main session dispatches)

Staging, after this PR is merged to `staging`:

```
# 1. (optional, read-only) the PROBE before the apply — expected to FAIL
gh workflow run apply-migration.yml --ref staging -f target=staging \
  -f migration=supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql \
  -f confirm=supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql
# 2. the migration
gh workflow run apply-migration.yml --ref staging -f target=staging \
  -f migration=supabase/migrations/20261013_0004_vid1_publish_post_media_definer.sql \
  -f confirm=supabase/migrations/20261013_0004_vid1_publish_post_media_definer.sql
# 3. the PROBE — expected to PASS
gh workflow run apply-migration.yml --ref staging -f target=staging \
  -f migration=supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql \
  -f confirm=supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql
# 4. 20261013_0001's PROBE with its updated expectation (5 keeps) — expected to PASS
gh workflow run apply-migration.yml --ref staging -f target=staging \
  -f migration=supabase/migrations/PROBE_20261013_0001_align_staging_locks_to_live.sql \
  -f confirm=supabase/migrations/PROBE_20261013_0001_align_staging_locks_to_live.sql
```

Production: only with the VID-1 promotion, directly after 20261011_0003 (PRE-002 refuses until it
is there; PRE-006 until `post_videos` and its grants are), same files with `target=production`.

## 8. Not verified

* The PROBE and the migration have not run against any live database.
* Production was read from the collector dump only; whether production holds any `post_media` row
  (PROBE G5 fails by design on a lane with none) was not readable from the dump.
* The caller inventory in §3 is static (source grep + catalogs). Runtime statement history
  (`pg_stat_statements`) was not read; PRE-005 covers the catalog half at apply time.
* The fixture is a slice of the schema (§4); it does not carry every production trigger or policy.
