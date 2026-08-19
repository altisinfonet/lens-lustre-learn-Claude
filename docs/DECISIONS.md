# The decision register

**Why this file exists, 2026-08-19.**

The owner found that the Only Me / Friends / Public chooser had vanished from
the composer and said, reasonably:

> "All posts are public now, only me and friends options are vanished both app
> and web — dont know when you damaged that too"

It was not damage. It was a deliberate, defensible decision taken on
2026-08-16 (commit `c19a0ce`), for a reason that is still true today: the
database honours a post's privacy but the direct CDN image URL does not, so a
member choosing "Only Me" would have been handed a promise this platform
cannot yet keep.

**The decision was right. Burying it was not.** The reasoning existed in
exactly two places a person would only find by accident — a comment block
inside `WallPosts.tsx`, and a test file named after the thing it was hiding.
The owner was never told. So from his side a working control disappeared
between builds with no explanation, which is indistinguishable from breakage,
and it cost his trust in everything else that had changed at the same time.

This file is the fix. **A deliberate removal, withholding, disabling or
narrowing of anything a member can see or use is not done until it is written
down here**, with what was withheld, who decided it, why, what it costs, and
the exact condition that ends it.

`src/__tests__/decisionRegister.test.ts` enforces this. It is not a
convention anyone has to remember: an entry with a missing field, an entry
whose pinning test does not exist, a pinning test that has drifted away from
its entry, or a `@decision` marker naming an entry that was quietly deleted —
each of those fails the suite.

---

## How to add one

1. Add a `## D-NNN — <title>` section below, with every field filled in.
2. Write the test that pins the behaviour, and put `@decision D-NNN` in it.
3. Both in the same commit as the change itself, and say so in the message.

**Status** is one of:

| Status | Meaning |
|---|---|
| `ACTIVE` | The withholding is in force right now. Its pinning test must exist and must carry the `@decision` marker. |
| `CLOSED` | The condition in "Restore when" was met and the thing was restored. The pinning test is normally deleted in the same commit. |
| `SUPERSEDED` | Replaced by a later decision, which must be named in the entry. |

**Restore when** must name a condition somebody can *check*, not a feeling.
"Once the CDN authorizes media" is checkable. "When it seems safe" is not, and
a reviewer cannot tell whether it has happened.

---

## D-001 — The privacy chooser is withheld until the CDN can keep the promise

- **Status:** ACTIVE
- **Decided:** 2026-08-16
- **Decided by:** Assistant, holding build 1102 before the first public release, under the owner's instruction "Final build give me after checking as it will in Public."
- **Commit:** `c19a0ce`
- **Pinned by:** `src/components/__tests__/PrivacyChooserWithheld.test.ts`
- **Restore when:** Authorized media delivery (B5) is live and the Media-URL cell of the Cross-Surface Visibility Invariant is green — i.e. fetching a post's image URL without permission is refused by the server, not merely hidden by the app.

### What is withheld

The Only Me / Friends / Public control in the composer. Both of them — writing
the pinning test found a **second** chooser on composer screen 2, which is the
only one an Android member ever reaches. Without that test this would have been
withheld on the website while shipping live in the app.

`newPrivacy` stays wired end to end and defaults to `public`, so nothing
downstream changed and restoring it is a small change rather than a rebuild.

### Why

Checked against production rather than read from a plan:

    select privacy, count(*) from posts   ->   public: 218, and nothing else

The database honours privacy. The feed honours it. Eight of the nine surfaces
in the visibility invariant honour it. **The direct image URL does not.** The
`post-images` bucket is public and its `storage.objects` SELECT policy is
`(bucket_id = 'post-images')` with no privacy condition at all — so anyone
holding the URL can fetch the photograph regardless of what the post says.

That was harmless only by luck: every post was public, so nothing private
existed to leak. Going public is precisely the event that ends the luck.
Offering a control that does not do what it says is worse than not offering it.

### What it costs

Members cannot restrict a post. Nobody *lost* a capability — all 218 posts were
already public — but nobody gains one either, and the platform looks less
capable than it is.

### Update, 2026-08-19 — the owner has decided to restore it

Told plainly that a restored "Friends" or "Only Me" post keeps a publicly
fetchable image URL until the media engine is live, and that hiding the link in
the app does not change that, the owner chose to restore the chooser anyway,
with the gap disclosed honestly in the UI.

That decision is **not yet executed**. When it is, this entry moves to
`SUPERSEDED`, names its successor, and the successor records the accepted risk
and its own restore condition. Until then this entry stays `ACTIVE` and the
pinning test stays, because the chooser is in fact still withheld.
