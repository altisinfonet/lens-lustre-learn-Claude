# PHASE 2 — CLASS B/C MIGRATION PROVENANCE

**Cycle date:** 2026-08-20 · **Fence:** `2026-08-20T07:44:42.350401+00`

This is the audit record for the cycle that migrated the class B and C populations. It
exists so the run can be re-derived and checked by someone who was not here.

---

## 1. THE FENCE

| | |
|---|---|
| Function | `public.media_migration_fence_digest_wide(timestamptz)` |
| `key_set_md5` | `9c6dfe1ed1972ec7a04bb503c6fd5a2f` |
| `item_count` | 263 |
| `post_count` | 217 |

The frozen v1 (`media_migration_fence_digest`) was **not modified**. At the same instant it
read `64b5bd7c7683052b97926a47e72daf34` / 229 / 198.

> ⚠ Worth recording: the narrow fence's **count** was unchanged from Cycle 4's `229/198`
> while its **digest** differed (`c6173052…` → `64b5bd7c…`). One post left the population
> (owner deletion at 07:07) and another arrived (the 07:08 post). This is exactly the
> scenario `MIG-1040` exists for, and exactly why `assertFence` compares sets and never
> lengths.

---

## 2. THE MANIFEST

| | |
|---|---|
| Rows | 263 |
| Bytes | 109,663 |
| sha256 | `ae389eb148b365bdfa2b26c090117219539bda3917a89347cf2693829d47037f` |
| Columns | the same 13 as the Cycle-4 manifest |
| Order | `post_id` ascending, then `ord` ascending |
| `visibility` | `public` for all 263 (no non-public post is a candidate) |

### It is reproducible from the database

The manifest is a deterministic function of the fence timestamp, the three candidate
regexes, and the committed `post_media` ⋈ `media_objects` facts. Regenerating it in SQL and
hashing the result yields `ae389eb1…` — verified `true` against the executed digest.

```sql
with cand as (
  select p.id::text as post_id, p.user_id::text as owner_id, u.ord::int as ord, u.url
  from public.posts p
  cross join lateral unnest(p.image_urls) with ordinality as u(url, ord)
  where p.image_urls is not null and p.privacy = 'public'
    and p.created_at <= timestamptz '2026-08-20 07:44:42.350401+00'
    and ( u.url ~ '^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/posts/[^/?]+$'
       or u.url ~ '^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/[^/?]+$'
       or u.url ~ '^https://cdn\.50mmretina\.com/avatars/[0-9a-f-]{36}/my-photos/[0-9a-f-]{36}/[^/?]+$')
),
j as (
  select c.post_id, c.owner_id, c.ord, c.url,
         replace(c.url,'https://cdn.50mmretina.com/','') as object_path,
         mo.width, mo.height, mo.bytes, mo.mime, encode(mo.sha256,'hex') as sha_hex
  from cand c
  join public.post_media pm on pm.post_id = c.post_id::uuid and pm.ord = c.ord - 1
  join public.media_objects mo on mo.id = pm.media_id
),
a as (
  select j.*,
    -- See the rounding note below: these two are exact .0000005 ties.
    case when (width = 1387 and height = 640)  then '2.167187'
         when (width =  938 and height = 1280) then '0.732812'
         else to_char(round(width::numeric / height::numeric, 6), 'FM0.000000') end as aspect
  from j
),
lines as (
  select post_id||E'\t'||owner_id||E'\t'||ord||E'\t'||url||E'\t'||'cdn.50mmretina.com'
      ||E'\t'||object_path||E'\t'||width||E'\t'||height||E'\t'||aspect||E'\t'||mime
      ||E'\t'||bytes||E'\t'||sha_hex||E'\t'||'public' as line, post_id, ord
  from a
),
txt as (select string_agg(line, E'\n' order by post_id, ord)||E'\n' as t from lines)
select encode(digest(t, 'sha256'), 'hex') from txt;
-- ae389eb148b365bdfa2b26c090117219539bda3917a89347cf2693829d47037f
```

### The rounding note, in full

Exactly **four** of 263 rows needed the `case`. `1387/640 = 2.16718750` and
`938/1280 = 0.73281250` are exact ties at the seventh decimal. JavaScript's `toFixed(6)`
rounds half-to-even (`2.167187`, `0.732812`); Postgres `round(numeric, 6)` rounds half-up
(`2.167188`, `0.732813`). Both satisfy `MIG-1026`, whose tolerance is `1e-6` and whose
error here is exactly `5e-7`. The manifest carries the JavaScript form because that is the
file that was approved and executed. The rows are:

```
333e4492-71ee-4c59-be91-cc6d1f582e07 ord 1  1387x640
333e4492-71ee-4c59-be91-cc6d1f582e07 ord 2  1387x640
54b1c92e-5f1f-4f33-b2d2-4f3eeea5e984 ord 1   938x1280
df6fe4a8-53e1-43b6-bd1a-df804c773965 ord 3   938x1280
```

---

## 3. MEASUREMENT

All 263 objects were read **whole** and hashed whole by `measure-post-media` v2
(`ezbr 990043d2…`), in 11 pages of 25 over public HTTPS from `cdn.50mmretina.com`.

```
returned 263 · not-ok 0 · missing dimensions 0 · missing MIME 0
```

### Three independent derivations of the population agreed

| Derivation | Result |
|---|---|
| SQL — `media_migration_fence_digest_wide` | 263 slides / 217 posts |
| Edge function — `measure-post-media`'s own scan | `total_candidates: 263` |
| Client-side re-derivation from `posts.image_urls` | 263 candidates / 217 posts, **0 unmeasured, 0 measured-but-not-a-candidate** |

That third one matters: it was written from the regexes rather than calling either of the
other two, so agreement is corroboration and not tautology.

---

## 4. DRY RUN

All 217 posts, 9 batches of 25. Every object re-fetched from the CDN by the migrator and
compared against the manifest — bytes, sha256, MIME, width, height.

```
would-migrate                        20 posts
would-verify-existing-references    197 posts
refused                               0
failed                                0
```

`fence_fn: media_migration_fence_digest_wide`, `wide: true`, echoed in every response so
the transcript records which population the run was gated on.

---

## 5. REAL RUN

```
migrated        20 posts  (35 slides)
verified-skip  197 posts
refused          0
failed           0
```

A session token expired mid-sweep at offset 100 and the batch returned `401` before doing
any work. The migrator is bounded per batch and idempotent, so the sweep was simply resumed
from that offset after the session refreshed. No partial state was possible: each post is
one transaction inside `media_migrate_post`.

---

## 6. RECONCILIATION AFTER

```
post_media_rows           263      media_objects_rows        264
non_ready_media             0      refs_to_non_ready           0
posts_with_gapped_ords      0      refs_with_owner_mismatch    0
unreferenced_media          1
ref_set_md5   8312dcc2b35fb9cbbb5355fd98115858
```

The run's `reconciliation_check` reported two failures, **both explained by one
pre-existing orphan** and neither caused by this cycle:

- `MIG-1071` — `media_objects` has 264, manifest expects 263
- `MIG-1072` — 1 `media_objects` row referenced by nothing

That row is `18b96d23-82a3-4e7e-abc2-ab5fe681d938` (owner `c2f9619d…`, created
2026-08-19 15:23, object `post-images/c2f9619d…/posts/1787114392867-…-l3.webp`). It lost
its reference when the owner deleted that post at 07:07 today: `post_media` cascaded,
`media_objects` did not. Nothing deletes storage objects and there is no reaper — by design.

**`MIG-1070` and `MIG-1075` did not fire.** `post_media` is exactly 263, and the actual
(post, position, content) **set** equals the manifest. That is the assertion that count
equality alone could not have made.

---

## 7. POPULATION MOVEMENT

| | Before | After |
|---|---|---|
| `post_media` | 228 | **263** |
| `media_objects` | 229 | **264** |
| posts with media | 197 | **217** |
| legacy-only posts | 55 | **35** |
| legacy-only slides | 82 | **47** |
| partial posts | 0 | **0** |

Coverage: **263/310 slides (84.8%)**, **217/252 posts (86.1%)**.

The 07:08 legacy-only post was inside the widened population and was migrated by this
cycle, so today's delta is repaired as well as stopped.

---

## 8. WHAT WAS NOT TOUCHED

- `media_migration_fence_digest` (v1) — **frozen, unmodified**
- the 228/229 approved manifests — **unmodified**
- `posts.image_urls` — **not written**
- any storage object — **not copied, not re-pointed, not deleted**
- classes D, D′, E, F — **no action; evidence only**
