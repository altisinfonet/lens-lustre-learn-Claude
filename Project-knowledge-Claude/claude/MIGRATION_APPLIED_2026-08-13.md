# The feed author-identity migration is APPLIED — 2026-08-13

**Applied to production** (`jtdtehuqtinjxropkkcn`, Postgres 17.6) at version
`20260813171159`, name `feed_author_identity`, via the official Supabase
connector after the owner authorised it through OAuth.

`get_broadcast_feed` now returns **15 columns** on all three signatures.

---

## The pre-flight caught my own security claim being wrong — twice over

The migration header asserts: *"Any logged-out visitor can already run `select
id, full_name, avatar_url from profiles_public_data` directly from the browser.
Reading those two columns here exposes exactly zero fields that were not already
public."* That is the paragraph the whole security argument rests on.

Checking it on production produced **three contradictory answers** in a row:

| Check | Result |
|---|---|
| `information_schema.role_table_grants` | `anon` has **no** SELECT → claim looked FALSE |
| `SET LOCAL role anon; SELECT count(*)` | returned **all 94 rows** → claim looked TRUE |
| `has_table_privilege('anon', …, 'SELECT')` | **false** → claim looked FALSE again |

Two of the three said the migration would newly expose author names to
logged-out visitors. That would have made the header a lie and the change
something the owner had not agreed to.

**Resolved by testing what a logged-out visitor actually experiences** — a real
PostgREST call with the public anon key, exactly as the browser makes it:

```
GET /rest/v1/profiles_public_data?select=id,full_name,avatar_url&limit=3
→ 200 OK, real names returned
```

So the claim holds in practice, and the join discloses nothing new. The catalog
checks were the misleading signal, not the app's behaviour.

**The lesson worth keeping: for "can this role read this", the authoritative
test is the request the client actually makes.** `has_table_privilege` on a bare
role name did not reflect how PostgREST reaches the table.

---

## Verified after applying, not assumed

| Check | Result |
|---|---|
| Signatures | 3 (2-arg, 3-arg, 4-arg) |
| OUT columns | **15** on all three (was 11) |
| `EXECUTE` for `anon` / `authenticated` | restored on all three — grants do not survive a DROP |
| `COALESCE(_exclude_ids)` guard | present on the 4-arg |
| Live RPC as anon | 200, 5 rows, **every row carrying a real name and avatar** |
| `_exclude_ids: null` | **3 rows** (was 0 before the guard — the "empty feed reported as success" class) |
| Supabase security advisor | no new finding attributable to this change |

Sample of the live response — name, avatar, thumbnails and categories all
arriving in the same payload as the post:

```
Shaikh Jan Mohammad   avatar: yes  thumbs: 1  cats: 3  tier: newest
AVIJIT SHEEL          avatar: yes  thumbs: 1  cats: 1  tier: newest
SUVRAJIT SARKAR       avatar: yes  thumbs: 3  cats: 1  tier: newest
```

### On the advisor output

538 findings total: 4 ERROR, 528 WARN, 6 INFO. **None caused by this change.**
The 4 ERRORs are pre-existing `SECURITY DEFINER` *views* in the judging system.
517 of the WARNs are one blanket pattern — "anon/authenticated can execute a
SECURITY DEFINER function" — covering 269 + 248 functions project-wide.
`get_broadcast_feed` contributes 6 of those and contributed the same 6 before,
because it was already `SECURITY DEFINER` with the same grants.

That blanket pattern is worth its own review someday. It is not this change.

---

## What members get now

The author's name and avatar are **welded to the post row**. "Post visible, name
missing" is no longer a state the system can be in — there is no second request
left to fail. The `posts?select=id,thumbnail_urls` round trip is gone.

The client half (`47b7c68`) shipped earlier and detects the new columns from the
row shape (`"author_name" in row`), never a version flag — so it needed no
coordination with this apply, and installed APKs on the old bundle keep working
untouched.

---

## Rollback

`supabase/rollback/20260813120000_feed_author_identity_ROLLBACK.sql`, round-trip
tested. ⚠ Do **not** try re-running `20260812070000_post_categories.sql` to undo
this — it fails with the same `cannot change return type` error, proven on
Postgres 16.

## Housekeeping

The owner connected the Supabase connector via OAuth to enable this. It can be
disconnected in claude.ai connector settings at any time; nothing in the app
depends on it.
