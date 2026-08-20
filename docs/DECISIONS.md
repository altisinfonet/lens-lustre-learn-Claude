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
| `CLOSED` | The condition in "Restore when" was met and the thing was restored. **The pinning test MUST be deleted in the same commit** — enforced, because an entry marked closed while its pin still stands is the register claiming something untrue about the product. |
| `SUPERSEDED` | Replaced by a later decision, which must be named in the entry. |

**Restore when** must name a condition somebody can *check*, not a feeling.
"Once the CDN authorizes media" is checkable. "When it seems safe" is not, and
a reviewer cannot tell whether it has happened.

---

## D-001 — The privacy chooser is withheld until the CDN can keep the promise

- **Status:** SUPERSEDED
- **Decided:** 2026-08-16
- **Decided by:** Assistant, holding build 1102 before the first public release, under the owner's instruction "Final build give me after checking as it will in Public."
- **Commit:** `c19a0ce`
- **Superseded by:** D-002, on 2026-08-19
- **Pinned by:** `src/components/__tests__/PrivacyGapDisclosed.test.ts`
- **Note:** the original pin was `PrivacyChooserWithheld.test.ts`, deleted when this entry was superseded — its successor's test above replaces it.
- **Restore when:** Superseded before its condition was met — see D-002. The condition it named (authorized media delivery live, Media-URL cell green) is NOT yet true and is now carried by D-002.

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

### Closed, 2026-08-19 — superseded by D-002

Told plainly that a restored "Friends" or "Only Me" post keeps a publicly
fetchable image URL until the media engine is live, and that hiding the link in
the app does not change that, the owner chose to restore the chooser with the
gap disclosed in the UI. Executed the same day. The reasoning above is kept
verbatim because it is still the reason the gap exists — only the response to
it changed.

---

## D-002 — The audience chooser ships with its limit stated in the UI

- **Status:** ACTIVE
- **Decided:** 2026-08-19
- **Decided by:** Owner (Neil Basu), after being told the file-level gap in full and that hiding the link in the app does not close it
- **Supersedes:** D-001
- **Pinned by:** `src/components/__tests__/PrivacyGapDisclosed.test.ts`
- **Restore when:** Nothing to restore — this ENDS when authorized media delivery is live and the Media-URL cell of the Cross-Surface Visibility Invariant is green, i.e. fetching a post's image URL without permission is refused by the server rather than merely hidden by the app. At that point delete `PrivacyGapNotice.tsx`, delete the pinning test, and close this entry in the same commit.

### What was decided

Only Me / Friends / Public are offered again in both composers — the web's
first screen and screen 2, which is the only one an Android member reaches.
Alongside them, `PrivacyGapNotice` states, for restricted audiences only, that
the photo file can still be opened by anyone holding its direct link.

### Why, and what is accepted

The gap D-001 describes is **unchanged and still verified**: `post-images` is a
public bucket whose `storage.objects` SELECT policy is
`(bucket_id = 'post-images')` with no privacy condition. The database, the feed
and eight of the nine visibility surfaces honour a post's privacy; the direct
image URL does not, and hiding the link client-side changes nothing because the
file is served with no server-side check — a URL obtained at any point keeps
working.

D-001 answered this by withholding the control. D-002 answers it by offering
the control and **telling the truth about its limit**, which is the owner's
call to make: it touches what the platform promises its members, and that is
not a decision to be taken quietly inside a component.

### What it costs

A member choosing "Only me" gets a post hidden everywhere in the product, and a
photograph that is still fetchable by direct link. That is a real gap and the
notice says so in plain words. The mitigation is honesty, not engineering, and
it is temporary by design — Phase 2's media authorization engine is built and
migration-ready, and closing it is what ends this entry.

⚠ THE NOTICE IS NOT COSMETIC. Removing it while keeping the chooser lands
exactly where D-001 started — a control promising more than the platform can
keep — while looking, in a diff, like a tidy-up. The pinning test fails if
either composer offers the chooser without it.

---

## D-003 — Authorized media delivery: the architecture is chosen, the dependency is not ours

- **Status:** ACTIVE
- **Decided:** 2026-08-20
- **Decided by:** Assistant, closing the Phase 2 workstream, on measured evidence rather than on design preference
- **Pinned by:** `src/__tests__/authorizedMediaDelivery.test.ts`
- **Restore when:** Nothing to restore — this ENDS when byte retrieval is authorized at the delivery edge and the negative test below returns "refused" instead of "retrieved". At that point `PrivacyGapNotice.tsx` and its pin are deleted, D-002 is closed, and this entry is closed in the same commit.
- **Specification:** `docs/D003_AUTHORIZED_DELIVERY_SPEC.md` — Worker behaviour, token contract, endpoint contract, DNS/R2 binding, and the 15 tests that close D-002. Added 2026-08-20.
- **Update, 2026-08-20:** the dependency is **not** unreachable in principle. The MCP registry carries a `Cloudflare Developer Platform` connector (`workers_list`, `accounts_list`, …), currently NOT installed on this account. Connecting it turns §2–§7 of the specification from work that can only be described into work that can be done. Re-measured the same day: the negative test still RETRIEVES, the control still refuses, and 0 production posts are non-public, so live exposure remains zero.

### The measurement that forced this entry

Executed 2026-08-20 from `https://example.com` — a third-party origin with no
session, no cookie, and `credentials:'omit'` so none could be attached:

```
migrated post media   https://cdn.50mmretina.com/post-images/…/posts/…webp   RETRIEVED  2560x1165
a second post's media https://cdn.50mmretina.com/post-images/…/posts/…webp   RETRIEVED  1023x1537
a key that does not exist                                                     refused
Supabase-hosted object (fetch, credentials:'omit')      HTTP 200, 18,094 bytes, image/webp
```

The control refuses, so the method discriminates. **Byte retrieval is
unauthenticated.** `post_media_for` decides which ADDRESSES a viewer learns; it
does not and cannot decide who may fetch them. Item E did not change this and
no client change ever can: anything a browser renders, a browser can be told to
fetch.

### The architectures considered, and why one wins

| approach | privacy | performance / caching | effect on the 229 live public images | complexity | verdict |
|---|---|---|---|---|---|
| Private Supabase bucket + `createSignedUrl` | strong | good | **breaks them** — live media is on R2; Supabase cannot sign an R2 object | medium | ✗ wrong store |
| R2 presigned URLs for everything | strong | **destroys CDN caching** — every URL unique per viewer; kills `srcset`, the `-l3` ladder and `/cdn-cgi/image` transforms | breaks every existing URL, including the Android app's | high | ✗ |
| Edge-function media proxy | strong | every byte through Deno: latency, bandwidth, no CDN, 25 MB originals | none | medium | ✗ ruinous for a photography feed |
| **Two stores: public bucket stays public; restricted media on a private prefix with authorized delivery at the Cloudflare/R2 edge** | strong where it is needed | **zero impact on public images or caching** | **none** | medium | ✓ **chosen** |

The chosen shape is the one the schema was already built for.
`media_objects.visibility` exists today with `('public','restricted','private')`
and **defaults to `private`** — added in `20260814084711` with the note
*"friends-privacy objects moved off the public bucket"*. Nothing new has to be
invented; the column is waiting.

### The dependency that blocks it, stated exactly

Authorization has to happen **where the bytes are served**, and that is
Cloudflare in front of R2 (`cdn.50mmretina.com`). That configuration lives
outside this repository — `src/lib/cdnImage.ts` already records the lesson:
*"this is Cloudflare zone configuration, it lives outside this repository, no
deploy or test here can see it change, and it HAS changed."*

So the remaining work is not code that was skipped. It is:

1. a Cloudflare Worker (or equivalent) bound to the R2 custom domain that, for
   objects under the restricted prefix, requires a short-lived token minted by
   the application after `can_view_post`, and passes public objects through
   untouched;
2. an application endpoint that mints that token — the natural home is beside
   `post_media_for`, which already performs exactly the right check;
3. the upload path routing `visibility <> 'public'` media to the restricted
   prefix.

(1) cannot be built, deployed or tested from this repository. Until it exists,
(2) and (3) would be a lock with no door: media written to a "restricted"
prefix on a bucket that serves everything publicly is not protected, it merely
looks protected — which is worse, and is precisely what D-001 refused to ship.

### What is true in the meantime

All 254 production posts are `privacy = 'public'`, so live exposure is **zero**
and the negative test above retrieves nothing a visitor could not already see.
The gap becomes real the first time a member uses the audience chooser, which
is why `PrivacyGapNotice` is not cosmetic and stays until this entry closes.

---

## D-004 — New posts dual-write the legacy arrays, because a binary this repository cannot deploy still reads them

- **Status:** ACTIVE
- **Decided:** 2026-08-20
- **Decided by:** Assistant, building the Phase 2 live write path, on measured consumer evidence rather than on preference
- **Pinned by:** `src/__tests__/mediaWritePath.test.ts`
- **Restore when:** Nothing to restore — this ENDS when all three conditions below are true, at which point `post_publish_with_media` stops writing `image_urls`/`thumbnail_urls`, this entry is closed and its pin deleted in the same commit.

### What was decided

`post_publish_with_media` writes `post_media` rows **and** `posts.image_urls` /
`posts.thumbnail_urls`. The shipped version wrote `image_urls = '{}'`.

Neither legacy array is trusted:

- `image_urls[i]` is **derived inside the transaction** from
  `media_objects.derivatives->>'original'` of the media at `ord = i`, prefixed
  with `site_settings.s3_storage_settings.public_url`. The caller cannot supply
  it, so publishing media A while displaying URL B is not expressible.
- `thumbnail_urls[i]` is **supplied but constrained** to exactly two honest
  values: the derived original, or that original with `-thumb` inserted before
  the extension (`MEDIA-2113` refuses anything else). It cannot be derived
  because `-thumb` is a filename convention and the documented fallback reuses
  the full-size URL when thumbnail encoding fails.

### Why — measured, not assumed

Publishing with an empty `image_urls` today blanks the photograph for:

| consumer | reads | reachable from this repo |
|---|---|---|
| **the Android app** | `posts.image_urls` | **no** — a separately released binary, in members' hands now |
| `Feed.tsx`, `PostCard.tsx`, `ProfilePostGrid.tsx`, `DraftsList.tsx`, `ScheduledPostsList.tsx`, `useScheduledPosts.ts` | `image_urls` directly | yes, not yet switched |
| every thumbnail, everywhere | `thumbnail_urls` | yes — but `thumbnail_urls` has **no representation in `media_objects` at all**; `post_media_for` returns `derivatives.original` only |

### What it costs

Two representations of the same fact, which can in principle drift. The
mitigation is that only one of them is writable by anyone: `image_urls` is
derived from the media rows in the same transaction that creates them, so drift
is not expressible on the write path either.

### Restore when — all three, each checkable

1. the six repository consumers above read through `resolvePostImageUrls`;
2. `thumbnail_urls` is represented in the media schema — the honest shape is a
   `thumb` key in `derivatives`, which requires widening `media_mark_ready`'s
   rung allow-list (`original,1440,1080,600`), a security-control change with
   its own review;
3. the Android binary in members' hands reads the new path — a store release,
   not a deploy, and the long pole.

⚠ REMOVING THE DUAL-WRITE BEFORE ALL THREE BLANKS PHOTOGRAPHS, and it does so
in a diff that looks like a tidy-up. The pinning test fails if
`post_publish_with_media` stops writing either array, or if `image_urls` ever
becomes a supplied parameter rather than a derived one.
