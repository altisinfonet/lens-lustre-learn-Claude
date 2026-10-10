# Realtime feed — investigated, NOT changed, and why. Plus a latent bug found.

Status: **no code changed.** `origin/main` = `42fc550`. This is the write-up of
what the investigation found and the exact plan, deliberately left for its own
session rather than half-done at the end of a long one.

---

## The bug found on the way (this one matters regardless)

`Feed.tsx:122 handleUpdatePost` does:

```js
patchPost(rawPost.id, (current) => ({ ...current, ...rawPost, image_urls: … }))
```

The raw `posts` row carries `likes_count`, `comments_count`, `shares_count`.
`FeedPost` (`src/types/post.ts:29-31`) uses `like_count`, `comment_count`,
`share_count` — **singular**.

So the spread lands the server's counts as three unused keys and **the displayed
counters are never updated by a `posts` UPDATE.** They are maintained purely by
client-side ±1 deltas from the child-table subscriptions.

Consequence: a post's counts can drift from the truth for as long as a member
keeps the feed open — a missed or duplicated realtime event never self-corrects,
because the authoritative number arrives on every update and is thrown away.
`WallPosts.tsx:164` has the same shape (it picks content fields only, no counts).

This is worth fixing on its own, independently of any traffic work.

---

## What the realtime channel actually costs

`useRealtimeFeed.ts` opens `feed-live` with **9 bindings and zero server-side
filters**: `posts` INSERT/UPDATE/DELETE, `post_reactions` INSERT/DELETE,
`post_comments` INSERT/DELETE, `post_shares` INSERT/DELETE.

Every write to the four busiest tables in the product is broadcast to every
connected client and discarded in JavaScript. Every one of the six child-table
handlers opens with `if (x.user_id === userIdRef.current) return;`.

**Verified on production** — triggers maintaining the counters:

| Table | Trigger |
|---|---|
| `post_reactions` | `trg_update_post_likes_count` |
| `post_comments` | `trg_update_post_comments_count` |
| `post_shares` | `trg_update_post_shares_count` |

So every reaction, comment and share **already** produces a `posts` UPDATE
carrying the authoritative count. The child subscriptions are redundant for
counting — they are load-bearing today only because of the field-name mismatch
above.

---

## The plan, and the trap in it

**One writer per field.** That is the whole design:

| Field | Source after the change |
|---|---|
| `like_count`, `comment_count`, `share_count` | `posts` UPDATE — absolute, server truth |
| `reaction_counts`, `top_reactions` | `post_reactions` — delta, per-type breakdown only |

Steps:

1. `handleUpdatePost` (both consumers) maps `likes_count → like_count`,
   `comments_count → comment_count`, `shares_count → share_count`.
2. `handleReactionChange` **stops touching `like_count`** and maintains only the
   per-type breakdown.
3. Drop the `post_comments` and `post_shares` bindings — 4 of 9 — and their
   `onCommentChange` / `onShareChange` props.
4. `posts` UPDATE currently does `if (p.user_id === userIdRef.current) return;`,
   which skips own-post EDITS but also skips **counter changes on your own
   posts**. It must let counters through for own posts while still not
   clobbering a local content edit — apply counter fields only in that case.

### ⚠ THE TRAP, WRITTEN DOWN BEFORE ANYONE HITS IT

Do **not** map the absolute counts while leaving the delta handlers in place.
A single reaction fires **both** a `post_reactions` INSERT (+1) and a `posts`
UPDATE (absolute). Apply both and the count is wrong by one whenever the
absolute lands first. Step 2 is not optional and it is not tidying — it is what
makes step 1 safe.

Two consumers must be changed together: `src/pages/Feed.tsx` and
`src/components/WallPosts.tsx`. Changing one leaves the other double-counting.

---

## Why this was not done today

- It changes live counter semantics on a live app, across two consumers, and the
  failure mode — likes counting up by two, or counts freezing — is visible to
  every member and lands on the owner, not on whoever wrote it.
- The audit ranked realtime fan-out as a **scale** problem (meaningful at ~500+
  concurrent). Current scale is 94 profiles and 210 posts. It is costing traffic,
  not user experience.
- A subtle counter refactor slotted in at the tail of a long session, unwatched,
  is precisely how the "sknaht" class of bug gets introduced. The same reasoning
  that kept a 414-package upgrade from riding along with the Capacitor pin
  applies here.

It needs about half a session with tests that specifically pin the
double-count case, and a build.
