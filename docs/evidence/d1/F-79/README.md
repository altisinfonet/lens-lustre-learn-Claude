# F-79 · The seeder's teardown reversed what the seed WROTE, not what the seed CAUSED

**Owner:** D1 · Database & Runtime
**Against:** `scripts/db-seed-staging.mjs` — the teardown contract
**Lane:** staging (`ztzutckwdhetphwghuzj`). Production was never involved.
**Raised:** 2026-09-04
**Severity:** would have failed the Owner's explicit condition for closing a phase — zero damage — while every individual step reported success.

---

## The one sentence that matters

**This was caught BEFORE the seed ran, not after.**

No seeded row was ever written. The defect was found by reading the catalogue
and the deployed trigger sources first, which is the whole argument of the plan:
reading the system before you change it is cheaper than repairing it afterwards.
Had the 100k run gone ahead as scheduled, roughly 80,000 rows would have been
left behind permanently on the Owner's staging database by a cleanup that
printed success, and the only way to discover it would have been to notice, at
some later date, that the notification table had grown by a factor of 76.

This is the cleanest demonstration of that argument the project has produced.

---

## The defect

`--teardown` deleted from `public.posts` and from nothing else:

```sql
DELETE FROM public.posts p
 USING generate_series($from, $to) g
 WHERE p.id = md5('50mm-seed-v1:post:' || g)::uuid
```

The file's own header claimed, of that statement:

> `* exactly reversible — --teardown deletes precisely the derived id set and`
> `  nothing else, so seeded rows can never be mistaken for real ones;`

That claim is true of the rows the seed **writes**. It is false of the rows the
seed **causes**, and it is the second that a teardown has to reverse.

`public.posts` carries nine triggers. Four of them write.

---

## Reading 1 — the Auditor's, from the foreign keys

Every foreign key that references `public.posts`, complete:

| child | `post_id` on delete |
|---|---|
| `album_photos` | **SET NULL** |
| `feed_events` | CASCADE |
| `post_comments` | CASCADE |
| `post_hashtags` | CASCADE |
| `post_media` | CASCADE |
| `post_reactions` | CASCADE |
| `post_reports` | CASCADE |
| `post_shares` | CASCADE |
| `post_tags` | CASCADE |

`user_notifications` **is not on that list**, and the direct count confirms it:

```
fk_notifications_to_posts = 0
notifications_now         = 1,060
posts_now                 = 17
```

So deleting the seeded posts removes nothing at all from `user_notifications`.

## Reading 2 — mine, from the deployed trigger sources

Read from `pg_proc.prosrc` on staging at **2026-09-04 14:29Z** — from the
running system, not from the migration files that were supposed to have produced
it. Every trigger on `public.posts`, and what each one writes:

| trigger | fires | writes to | removed by the old teardown? |
|---|---|---|---|
| `trg_rate_limit_posts` | BEFORE | — | n/a |
| `trg_detect_duplicate_post` | BEFORE | — | n/a |
| `trg_moderate_post_content` | BEFORE | — | n/a |
| `trg_validate_post_categories` | BEFORE | — | n/a |
| `trg_enforce_post_caption_only_update` | BEFORE | — | n/a |
| `trg_posts_unsync_hashtags` | BEFORE DELETE | (deletes + recounts) | n/a |
| `trg_enqueue_post_created` | AFTER | `pgmq` queue `post_jobs` | **no** — not a child of posts |
| `trg_fan_out_new_post` | AFTER | `public.user_notifications` | **NO — no foreign key** |
| `trg_flag_post_review` | AFTER | `public.post_reports` | yes, CASCADE |
| `trg_posts_sync_hashtags` | AFTER | `public.post_hashtags` | yes, CASCADE |
| | | `public.hashtags` | **no** — no foreign key |

The two readings are independent — one from `pg_constraint`, one from
`pg_proc` — and they agree. So do the counts: the Auditor measured
posts 17 · user_notifications 1,060 · post_hashtags 0 · album_photos 0, and my
own census at **14:30:06Z** returned the same four numbers.

### The line that makes the fix constructible

`fan_out_new_post()`, deployed source:

```sql
INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, actor_id)
SELECT f.follower_id, 'new_post_from_following', 'New post', 'just shared a post',
       NEW.id,          -- ← reference_id IS the post id
       NEW.user_id
  FROM public.follows f
 WHERE f.following_id = NEW.user_id AND f.follower_id <> NEW.user_id
 ORDER BY f.created_at DESC LIMIT 1000;
```

`reference_id := NEW.id`. Every notification the seed causes is therefore
reachable by the **derived id set** — the identical
`md5('50mm-seed-v1:post:' || n)::uuid` the posts delete already uses. The fix
needed no new keying discipline; it needed the existing one extended.

---

## What it would have cost

Staging holds 513 profiles and 513 follow edges, and all 17 existing posts are
public. At the default 80% public mix, a 100,000-row seed fans out to roughly
**80,000 `user_notifications` rows**, none of which the old teardown could
reach. Against a table holding 1,060 rows that is a **~76× multiplication that
the cleanup would not touch** — permanent, on the Owner's database.

Every step would have reported success. The seed would have said it wrote
100,000 posts. The teardown would have said it swept ordinals 1..100000. The
posts count would have returned to 17. Nothing in the run would have mentioned
the 80,000 rows, because nothing in the run was looking at them.

---

## The fix

Three changes, all in `scripts/db-seed-staging.mjs`.

**1. The teardown removes what the seed causes, keyed on the derived id set.**

```sql
DELETE FROM public.user_notifications n
 USING generate_series($from, $to) g
 WHERE n.reference_id = md5('50mm-seed-v1:post:' || g)::uuid;
DELETE FROM public.posts p
 USING generate_series($from, $to) g
 WHERE p.id = md5('50mm-seed-v1:post:' || g)::uuid
```

Both statements reach the server in one string, so psql runs them in a single
implicit transaction: either both apply or neither does.

**No content match, and none is possible.** `message LIKE '%seed%'` would have
been the exact trap this file's own test has forbidden for posts since it was
written — it would make a member's notification reachable by the teardown. The
id set cannot: a member's row is reached only if its `reference_id` collides
with an md5 digest of a string it has never seen.

**No type filter, deliberately.** `AND type = 'new_post_from_following'` reads
as caution and is the opposite: a member who reacts to a seeded post gets a
different type pointing at the same id, and filtering leaves that row behind
pointing at a post that no longer exists. The id set is already exact; a filter
on top of an exact key only subtracts correctness.

**2. `album_photos` — the teardown refuses rather than detaching a member's row.**

`album_photos.post_id` is `ON DELETE SET NULL`, alone among the nine. Deleting a
seeded post therefore does not reverse such a row — it silently NULLs a column
on a member's album entry and reports success. The table holds 0 rows today and
the seed never creates one, so nothing is at stake in this run. *Today it is
zero* is not a contract. `TEARDOWN_ALBUM_GUARD_SQL` looks before each batch and
**refuses** if it finds any, because the choice between deleting a member's
album entry and quietly detaching it belongs to the Owner, not to a seeder.

**3. The teardown states its own verdict — C-34 applied to the cleanup.**

The census now counts every table a posts trigger writes to. After the sweep the
teardown prints a before/after/delta on the five counts the Auditor named
(`posts_total`, `user_notifications`, `post_hashtags`, `feed_events`,
`album_photos`) and **exits 1** if any count other than `posts_total` failed to
return to its before-value. A teardown is not trusted because it exited 0; it is
trusted because the counts came back.

---

## Proof that the tests could have failed (C-34)

Seven defects planted one at a time into the fixed seeder, each run as its own
fixture. Every plant is caught, and the fixed file is clean:

```
PLANT: the original defect — teardown deletes from public.posts only
  FAIL … teardown removes the notifications the seed CAUSES, not only the posts it writes
  FAIL … the notification teardown is keyed on the DERIVED ID SET, never on content
  FAIL … notifications are deleted BEFORE the posts, in one statement string
  22 passed, 3 failed

PLANT: the trap — notifications deleted by CONTENT MATCH instead of the id set
  FAIL teardown is keyed on the derived id set, never on the content marker
  FAIL … the notification teardown is keyed on the DERIVED ID SET, never on content
  23 passed, 2 failed

PLANT: the plausible narrowing — a type filter on top of the exact id set
  FAIL … no type filter narrows the notification delete
  24 passed, 1 failed

PLANT: posts deleted BEFORE the notifications that reference them
  FAIL … the notification teardown is keyed on the DERIVED ID SET, never on content
  FAIL … notifications are deleted BEFORE the posts, in one statement string
  23 passed, 2 failed

PLANT: the album guard CALL moved below the delete, comment left in place
  FAIL … album_photos is SET NULL, so the teardown refuses instead of nulling a member's row
  24 passed, 1 failed

PLANT: a teardown that did not reverse still exits 0
  FAIL … the teardown proves its own reversal on the five named counts
  24 passed, 1 failed

PLANT: the census stops counting user_notifications
  FAIL … the teardown proves its own reversal on the five named counts
  FAIL … every table a posts trigger writes to is counted by the census
  23 passed, 2 failed

NO PLANT — the fixed seeder
  25 passed, 0 failed
```

### The control caught a defect in my own test, and that is recorded rather than tidied away

The first attempt at the album-guard plant **passed 25/25**. The plant moved the
guard CALL below the delete but left the explanatory comment
`// Look before deleting. See TEARDOWN_ALBUM_GUARD_SQL:` above it, and my
assertion searched the raw source with `indexOf('TEARDOWN_ALBUM_GUARD_SQL')` —
which found the comment at offset 348 and the delete at 473, and concluded the
guard ran first. **It was measuring prose.**

That is the same defect class as F-76, where D2's guard grepped raw SQL
including comments and my own explanation of a function made the guard believe
the function gated itself — committed again, by me, five hours later. The
assertion now strips `//` comments before searching and keys on the call
`queryOne(dsn, TEARDOWN_ALBUM_GUARD_SQL(`, not on the bare token. The plant then
correctly goes red.

Recorded here because a negative control that finds a hole in the test is the
control doing its job, and rewriting the test quietly would have thrown away the
only evidence that it needed fixing.

---

## A secondary reading, recorded because it was measured

`enqueue_post_created_job()` calls `pgmq.send('post_jobs', …)`. **The queue
`post_jobs` does not exist on staging.** `pgmq` holds only
`q_transactional_emails` / `a_transactional_emails`, and `enqueue_post_job`
swallows the failure as a `RAISE WARNING`.

So the plan's stated consequence — "expect ~N queue messages, which the
5-second cron will then work through" — is **not what happens on staging as it
stands today**; a seed produces N log warnings instead. The plan text is
corrected to say so.

**The `--ack-enqueue-jobs` flag stays required.** Standing Rule 19: the queue can
be created by any migration, and a seeder that quietly depends on a table being
absent is a seeder that breaks the day someone adds it. This is a correction to
what the plan *claims*, not a relaxation of what the seeder *demands*.

Similarly `public.hashtags`: the vocabulary rows have no foreign key to posts, so
they would survive a teardown. `extract_hashtags` matches `#[A-Za-z0-9_]{1,60}`
and the seeded content template contains no `#`, so the seed creates none —
measured, not assumed. Change the content template and that stops being true.
`trg_posts_unsync_hashtags` fires BEFORE DELETE and recounts, so the counters
repair themselves.

---

## State of the fix

| | |
|---|---|
| Teardown fix | written, `scripts/db-seed-staging.mjs` |
| Tests | 25 passed, 0 failed |
| Negative control | 7 plants, 7 caught |
| Small-seed teardown proof | **not yet run** — next, per the Auditor's ordering |
| 100k seed | **not yet run**, and will not be until the small seed proves the teardown reverses |

The before-state every after-count will be measured against:

| count | Auditor | mine, 14:30:06Z |
|---|---|---|
| `posts` | 17 | 17 |
| `user_notifications` | 1,060 | 1,060 |
| `post_hashtags` | 0 | 0 |
| `album_photos` | 0 | 0 |
| `feed_events` | — | 0 |
| `hashtags` | — | 84 |
| `post_reports` | — | 0 |
| `profiles` | — | 513 |
| `follows` | — | 513 |

Plus mine from 13:24:23Z: posts 17 · profiles 513 · post_media 5 ·
media_objects 5 · certificates 3 · user_roles 513 · database 214 MB.
