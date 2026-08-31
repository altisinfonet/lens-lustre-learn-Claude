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
Alongside them, `PrivacyGapNotice` renders for restricted audiences only. As
decided, it stated that the photo file can still be opened by anyone holding
its direct link; that sentence was removed on 2026-08-29 — see the update at
the end of this entry.

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
photograph that is still fetchable by direct link. That is a real gap. Until
2026-08-29 the notice said so in plain words; see the update below, which
changed the wording and not the gap. The mitigation is temporary by design —
Phase 2's media authorization engine is built and migration-ready, and closing
it is what ends this entry.

⚠ THE NOTICE IS NOT COSMETIC. Removing it while keeping the chooser lands
exactly where D-001 started — a control promising more than the platform can
keep — while looking, in a diff, like a tidy-up. The pinning test fails if
either composer offers the chooser without it.

### Update, 2026-08-29 — the UI copy was shortened; the gap was NOT closed

`PrivacyGapNotice` read, for a restricted audience:

> {who} will see this post on 50mm Retina World. The photo file itself can still
> be opened by anyone who has its direct link — we are still building that
> protection.

The owner chose to drop the second sentence. It now reads only:

> {who} will see this post on 50mm Retina World.

**This is a UI-copy decision and nothing else.** It is recorded here because a
later reader finding a shortened disclosure in a diff would otherwise have two
equally plausible readings — that somebody deleted it by accident, or that the
underlying fault had been fixed — and neither is true.

What is unchanged, and re-stated so it cannot be inferred away:

- `post-images` is still a public bucket. Its `storage.objects` SELECT policy
  is still `(bucket_id = 'post-images')` with no privacy condition.
- The photograph behind an "Only me" or "Friends" post is still fetchable by
  anyone holding its URL, with no server-side check.
- **D-002 remains ACTIVE.** It closes when authorized media delivery is live and
  the Media-URL cell of the Cross-Surface Visibility Invariant is green — see
  D-003 — at which point `PrivacyGapNotice.tsx` and its pinning test are deleted
  and this entry is closed, exactly as the Restore-when line above already says.

What DID change, and should be said plainly: the notice no longer discloses the
file-level gap. It states who can see the post. A member choosing "Only me" is
therefore no longer told, in the product, that the photograph itself remains
reachable. That is the owner's call to make — it is his to make precisely
because it touches what the platform promises its members — and the cost of it
is written here rather than left implicit.

`PrivacyGapDisclosed.test.ts` was NARROWED to pin the new copy exactly, not
deleted and not weakened to a check that would pass on anything. Restoring the
dropped sentence is as much a decision as removing it was, and the test fails if
it reappears without one.

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

---

## D-005 — The legacy insert stays as the airbag, and is now told apart from the steering

- **Status:** ACTIVE
- **Decided:** 2026-08-20
- **Decided by:** Owner (Workstream 2, Priority 3: *"Do NOT use a legacy fallback to hide a failure of the new media path"*), implemented by Assistant
- **Pinned by:** `src/__tests__/mediaWritePath.test.ts`
- **Restore when:** Nothing to restore — this ENDS when the legacy `image_urls`-only insert is deleted from `WallPosts.tsx` altogether, which is only safe once the Android binary reads `post_media` (see D-004's third condition). At that point this entry is closed and its pin deleted in the same commit.

### What was decided

`createPost` still falls back to `.from("posts").insert(...)` when the media
path does not complete. But `publishViaMedia` now returns **why**, and the two
reasons are treated as different things:

| failure | meaning | signal |
|---|---|---|
| `unmigratable-slides` | a slide has no `StoredObjectFacts` — in practice a RESUMED DRAFT, whose original bytes are gone. Legacy-only **by design**, permanently. | `MEDIA-4006` per slide, then `MEDIA-4001` |
| `media-path-failed` | every slide was describable and the path still did not complete. **A defect.** | `MEDIA-4010` at **ERROR**, then `MEDIA-4001` |

`MEDIA-4001` still counts **both**, because both land in the legacy-only
population and the delta must agree with the database.

### Why the fallback was not simply deleted

The stated goal is that the legacy insert must not become "the normal recovery
mechanism for a media-post failure". Deleting it does not achieve that — it
converts every media-path fault into total post loss for the member, which is
what RED-1 actually did in production for four days and is strictly worse than
a legacy-only post. The failure mode to design against is not the fallback
existing; it is the fallback being **indistinguishable from success**.

### Why the classification is decided from the INPUT, before anything is tried

An undescribable slide is detected from `photo.stored === null` up front, not
inferred afterwards from a refusal. Inferring it would make a server outage
look exactly like a resumed draft — the same conflation, one layer down.

### What it costs

One more branch on the publish path, and a second error code for reviewers to
learn. In exchange, `MEDIA-4010 > 0` is a fact about the write path being
broken, which `MEDIA-4001 > 0` never was.

⚠ THE FIX FOR A NON-TRIVIAL `MEDIA-4010` RATE IS THE MEDIA PATH, NEVER A WIDER
FALLBACK. Widening the fallback makes the delta grow more quietly, which is the
one outcome every control in Phase 2 exists to prevent. The pinning test fails
if the two conditions are merged, if `MEDIA-4010` stops being an error, if the
composer stops branching, or if `MEDIA-4001` stops counting either kind.

---

## D-006 — The 29 remaining legacy slides are permanently excluded from migration

- **Status:** ACTIVE
- **Decided:** 2026-08-20
- **Decided by:** Owner ("PHASE 2 — EXECUTE APPROVED CLOSURE DECISIONS", Decisions 1 and 2), on the Workstream 3 audit and the Final Decision Package
- **Pinned by:** `src/__tests__/candidatePatternWidening.test.ts`
- **Restore when:** Never restored — this ENDS only if a future owner explicitly commissions a Supabase→R2 copy-and-rewrite programme for the 27 (new scope, outside Phase 2), or explicitly accepts an ownership-control widening for the 2 covers. Either would be its own reviewed decision superseding this one.

### What was decided

Two decisions, one register (`docs/PERMANENT_LEGACY_EXCLUSIONS.md`):

1. The **27 Supabase-hosted thumbnail slides** (15 posts, 23 objects) are accepted as
   permanent legacy. Not copied to R2, no `image_urls` rewrite beyond the separately
   approved Class-F repoint, no `media_objects`/`post_media` rows created.
2. Migration of the **2 R2 cover photographs** is rejected, because it would require
   widening an ownership control (`MIG-1019` / MEDIA-2102's owner-at-segment-2 rule)
   for 2 slides out of 310.

### Why

The 27 are 600px derivatives on the wrong host: migrating them requires a prohibited
byte copy AND a prohibited URL rewrite, and would enshrine thumbnails as canonical
originals. The 2 covers are refused by the engine's ownership proof, and weakening an
ownership proof is the highest-consequence change this engine admits.

### What it costs

35 posts remain legacy-only forever, rendering via the `image_urls` fallback — exactly
as they render today. Members see no change. The delta detector's `migratable_legacy_*`
labels lag this register until its classifier is updated (optional follow-up).

⚠ THE PIN IS THE REFUSAL ITSELF. The pinning test asserts the real production keys are
not migration candidates, that `CDN_HOST` is the CDN by value, and that
`media_mark_ready` still pins the owner to path segment 2 — with mutations W1–W5
proving each assertion bites. Deleting this entry while those tests stand would leave
guards enforcing a rule with no written reason, which the register forbids.
