# Do tagged people get like / comment notifications? — checked 2026-08-11

Owner's question: *"if someone tagged with anyone, on that posts both person will
get notifications?? if tagged 19 persons, then total 20 persons will get like
comment notifications (in app, email)"*

## Answer: NO. Only the post owner is notified. Checked against production, not the repo.

The repo's migration file for these triggers is **stale** — the live functions
were replaced by a job-queue design that never got written back into
`supabase/migrations`. Everything below was read from the live database
(`jtdtehuqtinjxropkkcn`) with `pg_proc` / `pg_trigger`.

## How the live chain actually runs

```
INSERT post_reactions  → trg_notify_post_reaction → notify_post_reaction()
INSERT post_comments   → trg_notify_post_comment  → notify_post_comment()
INSERT post_tags       → trg_notify_post_tag      → notify_post_tag()
        ↓ all three only call
    enqueue_post_job(jsonb …)
        ↓
    process_post_jobs()
        ↓ dispatches by job type
    pj_handle_reaction_notification   (1257 chars, 1 notification insert)
    pj_handle_comment_notification    (2041 chars, 2 notification inserts)
    pj_handle_tag_notification        (1015 chars, 1 notification insert)
    pj_handle_recount_engagement      (0 notification inserts)
```

## The decisive check

Across **every function in the `public` schema**, exactly one reads `post_tags`
AND writes `user_notifications`:

| function | writes notifications | reads post_tags |
|---|---|---|
| `pj_handle_comment_notification` | 2 | **false** |
| `pj_handle_reaction_notification` | 1 | **false** |
| `pj_handle_recount_engagement` | 0 | false |
| `pj_handle_tag_notification` | 1 | **true** |

So the like and comment handlers have no knowledge that tags exist. Recipients:

- **like / reaction** → the post owner only (and not the actor themself)
- **comment** → the post owner, plus the parent comment's author on a reply
- **tag** → the tagged member only, once, at tag time ("X tagged you in a photo.
  Approve or decline?")

## Real production data confirms it

One post currently carries a tag (`da13f68b-…8b45`, 1 tag):

| type | distinct recipients |
|---|---|
| `post_reaction` | **1** |
| `post_tag` | 1 |
| `new_post_from_following` | 89 |

A like on that post reached one person, not two.

## In-app, push and email all follow the same rows

`user_notifications` carries exactly two triggers:

- `trg_push_on_notification` → `push_on_notification()`
- `trg_send_notification_email` → `send_notification_email()`

One notification row = one bell entry + one push + one email (subject to that
member's preferences). No row = nothing on any channel. So the answer above
holds identically for in-app, push and email — there is no separate email
fan-out that could behave differently.

## So on a post with 19 tags

A single like today produces **1** notification. If the fan-out he described
were built, it would produce **20** — and 19 of them would be for a photo the
member did not post. With 16 likes and 8 comments on such a post that is 480
notifications and up to 480 emails from one post.

For reference, Instagram behaves the way the site behaves now: being tagged
notifies you once, at tag time; it does not subscribe you to every like on
someone else's post.

## Not changed

Nothing was modified. This was a read-only investigation.

## If the owner wants it changed

The change would live in `pj_handle_reaction_notification` and
`pj_handle_comment_notification` — add an insert loop over
`post_tags where post_id = … and status = 'approved'`, excluding the actor and
the post owner. Approved-only matters: a pending tag is not consent, and
notifying on pending tags would let anyone subscribe a stranger to their post's
traffic. Volume control (batching, or notifying only the first like) should be
decided at the same time.
