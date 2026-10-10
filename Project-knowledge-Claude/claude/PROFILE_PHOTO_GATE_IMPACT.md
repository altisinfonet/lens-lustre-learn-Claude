# The profile-photo rule blocks 39% of the community — measured

**Measured on the live database, 2026-08-05.** This is a decision for the owner,
not a bug I fixed. Nothing about the rule has been changed.

---

## The rule

Two RESTRICTIVE Postgres policies, added **2026-08-01**:

| Table | Policy |
|---|---|
| `public.posts` | `Profile photo required to create posts` — `has_profile_photo(auth.uid()) OR has_role(auth.uid(),'admin')` |
| `public.post_comments` | `Profile photo required to comment on posts` — same expression |

A Google/Apple sign-in picture does **not** satisfy it. `has_profile_photo`
requires a photo the member uploaded to our own storage. (That is deliberate —
see `PROFILE_PHOTO_POLICY.md`; hotlinked OAuth pictures were 503-ing, and
`20260803210000_no_hotlinked_avatars.sql` nulled 27 of them.)

## The measured impact

| Number | Meaning |
|---|---|
| **83** | active members |
| **51** | can post and comment |
| **32** | **cannot post or comment at all** (39%) |
| **32** | of those, have no `avatar_url` at all |
| **0** | have an avatar set but still fail — the rule is coherent, not buggy |

**Four of the 32 were posting before the rule landed:**

| Member | Last post |
|---|---|
| Manish Kushari | 2026-07-30 |
| Kirit Dey | 2026-07-30 |
| Rajib Mondal | 2026-07-29 |
| Samyabrata Chakrabarty | 2026-07-28 |

The rule went live **2026-08-01**. They posted, then stopped. The other 28 have
never posted or commented — consistent with hitting the wall and giving up.

Posting is **not** globally broken: 7 posts in the last 24 hours, latest
2026-08-05 04:54.

## Why nobody could tell

Until 2026-08-05 the reply path did this:

```ts
onError: (_err, _vars, context) => {      // note the underscore — never read
  toast({ title: "Failed to comment", variant: "destructive" });   // no body
}
```

The mutation **already knew** to throw *"Please add a profile photo to your
account first — it takes a moment and is required to post or comment."* and the
error handler discarded it. So a blocked member saw four words with no reason,
no next step, and no way to tell a restriction from a dropped connection.

Fixed 2026-08-05 (`6641e59`): the real sentence is shown, and the failure is
recorded in `client_errors` as kind `reply`.

A second trap was introduced and removed in the same session:
`describeThrown()` prefixes an error's `name`, so the fix briefly rendered
*"Error · Please add a profile photo…"*. `memberFacingMessage()` now returns a
written sentence unprefixed and falls back to the diagnostic form only when
there is no human message. The log still gets the full diagnostic version.

## The decision, stated plainly

The rule is the owner's and it has a real purpose. But **39% blocked** is a
larger cost than "add a photo" usually implies, and four members lost an ability
they had been using without ever being told why.

Options, none of them taken:

1. **Leave it.** Now that the message is clear, blocked members at least know
   what to do.
2. **Grandfather the four** who posted before 2026-08-01.
3. **Comments yes, posts no** — require a photo to post, allow replies.
4. **Prompt instead of block** — let them act, with a persistent nudge.

## Do not confuse this with the 2026-08-04 outage

This rule blocks a **fixed** set of people **permanently**. The outage the owner
reported was an ~8-hour gap in which nobody posted, and the upload path tested
healthy afterwards (`s3-presign-upload` HTTP 200, real PUT HTTP 200, no RLS or
constraint errors in the Postgres logs, no 4xx/5xx in the edge logs). **No root
cause has been established for that, and none should be claimed.** The two
findings are separate; only `client_errors` will settle the second.
