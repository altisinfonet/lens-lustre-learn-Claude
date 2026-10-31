# N4 push picture (0210): fixture (local Postgres 16, never run against a lane)

**Base.** The 0170 fixture (`n170_prod`: the real 0170 `push_on_notification`, md5 2ee2553f…, a recording `net.http_post`,
centre 0110 and gate 0140), copied as `n210_stg` (staging) and `n210_prod` (production), plus a `posts` table
(`image_url`, `thumbnail_url`). `likes_comments` is on for member A only.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL (md5 2ee2553f…, the 0170 body) | FAIL |
| apply | OK | OK |
| PROBE after apply | PASS (md5 cc27b8bc…) | PASS |

Each case shows the push request body minus data, user, title and body:

| Case | Result |
|---|---|
| A (group on), reaction on a post with a thumbnail | `{"image_url": "…p1_600.webp"}` |
| A, post with no thumbnail | `{"image_url": "…p2.jpg"}` |
| B (group off), same post | `{}`: **no image key at all**, exactly today's request |
| A, post missing | `{}` |
| A, new follower (not a post type) | `{}` |
| A, a fault reading posts (column renamed) | push sent, `{}` (no picture) |
| rollback | md5 back to 2ee2553f…, push without a picture (0170 behaviour); re-apply → PROBE PASS |
| apply with the live body not 0170 | refused `NC-0210-PRE-001` |

The first run of the fault case printed "NO PUSH". The centre log showed `{duplicate}`: the same member, post
and type had been sent within 60 seconds in an earlier case, and the gate correctly skipped it. Re-run with a
fresh post, the push was sent.
