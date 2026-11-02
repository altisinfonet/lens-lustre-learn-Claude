# Smart Photo Plan — U7 delete the old big files (LAST unit)

Owner decision 7 ("delete originals yes", 2026-11-02), with its three
conditions, each enforced by `20261110_0104_photo_retire_old_posts.sql`:

| Condition | Enforced by |
|---|---|
| (a) every photo has all new copies, verified by a census on that lane | PRE-004: refuses while ANY post photo still shows an old in-scope file — which only becomes 0 after census PASS (every set recorded, each `done` HEADs every copy) and the swap |
| (b) the Owner has switched the new photos on live himself; the live site reads only new copies | PRE-003: on production refuses unless `photo_set_v2` = All members; PRE-004 as above |
| (c) a dry run lists the exact count + bytes | 0104 deletes nothing; `photo-retire.yml` kind `post_old`, mode dry-run prints count + bytes; only then mode run |

Never automatic: the daily schedule deletes competition full sizes only
(`comp_full`); old post files go only by hand. Competition files are never
touched by U7.

## What is queued per swapped photo

The old photo, its old thumbnail (same member folder, not a v2 copy), and for
an old `-l3` photo its `-l3-r1080` / `-l3-r1440` rungs. Any of these still named
anywhere in the public schema (a notification, another post, a featured photo …)
is **kept**, with the place named. The route refuses any key that is a v2 copy.

## Reversible until the deleter runs

`20261110_0104_photo_retire_old_posts_ROLLBACK.sql` removes every queued row
not yet deleted. The swap rollback (0102) now skips any post with queued or
deleted old files, so no post is ever pointed back at a file that is gone.

## The dry-run list, per lane

**Staging** (run 2026-11-02, see the status PR): measured by `photo-retire.yml`
dry-run after 0104.

**Production — estimate, read-only, 2026-11-02 20:34 UTC** (`u7-estimate.mjs`
in this folder: anon read of PUBLIC posts + CDN HEAD; friends-only posts are 1
more photo by the database's count, 598 vs 597):

| | |
|---|---|
| old public post photos in scope | 597 |
| candidate files (photo + old thumb + `-l3` rungs) | 1,899 |
| present on the CDN | 1,844 |
| never stored (rungs of small photos) | 55 |
| **bytes to free** | **556,702,446 (≈ 531 MB)** |

The exact production list (minus anything kept because it is still named) is
what `photo-retire.yml` dry-run prints after the Owner-gated 0104 run.
