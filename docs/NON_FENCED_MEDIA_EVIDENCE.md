# The non-fenced media: evidence before any copying

**2026-08-20.** Phase 2 closure, Priority 2, classes D, E and F.

The brief was explicit: *"Do not copy or rewrite anything until you have a
complete impact matrix"* and *"Produce the evidence first."* This is that
evidence. **Nothing in these classes has been copied, rewritten, re-pointed or
deleted.** Two of the three findings below change what the right answer is.

Counts are as of 2026-08-20 06:30 UTC. Two posts (2 slides — one class E, one
class F) were deleted from production by the owner during this session; the
numbers below are the current ones, not the ones in the previous report.

---

## Classes D and E — the complete impact matrix

**18 objects, 20 slide references, 18 posts.** Every object listed; nothing
aggregated away.

| object | kind | slide refs | posts | owner at seg 2 | distinct `?t=` values |
|---|---|---:|---:|:---:|---:|
| `avatars/569aa88e…/avatar.webp` | D profile photo | **2** | **2** | ✓ | **2** |
| `avatars/cdf50078…/cover.webp` | D cover photo | **2** | **2** | ✓ | **2** |
| `avatars/319d26bf…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/39759f18…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/4fc3b0c0…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/5745a9c9…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/581963f3…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/7f234925…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/85250f9f…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/9dc31151…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/c270d9d9…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/c3117063…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/cc691988…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/cdf50078…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/d907db0c…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/f0e517be…/avatar.webp` | D profile photo | 1 | 1 | ✓ | 1 |
| `avatars/covers/569aa88e…/1773897608964-….jpg` | **E** | 1 | 1 | ✗ (`covers`) | — |
| `avatars/covers/569aa88e…/1773897806339-….jpg` | **E** | 1 | 1 | ✗ (`covers`) | — |

All 18 posts are `privacy = 'public'`. 16 are `post_kind = 'member'`, 2 are
`system` — every one is an *"updated their profile picture"* / *"updated their
cover photo"* announcement, not a photograph the member composed.

### ⚠ THE FINDING THAT DECIDES THIS CLASS

`avatars/569aa88e…/avatar.webp` is referenced by two posts **five months apart**:

```
2026-03-18 10:45  member post  "updated their profile picture."          ?t=1773830746125
2026-08-17 10:31  system post  "updated their profile picture. ME but…"  ?t=1786962673065
```

One mutable key, two posts, two different photographs. Probed today:

```
…/avatar.webp?t=1773830746125   (the MARCH post's url)    400 x 267
…/avatar.webp?t=1786962673065   (the AUGUST post's url)   400 x 400
…/avatar.webp                   (no cache-buster)         400 x 400
```

**The two URLs return different images.** Cloudflare is still serving a
five-month-old cached copy under the March cache-buster, while the origin
object is the August photograph. So the March post looks correct today **only
because of a CDN cache entry**, and will silently start showing the August
photograph the moment that entry is evicted.

**This is why class D must not be migrated as it stands.** A migration hashes
the ORIGIN bytes. Doing that today would record the August photograph as the
content identity of the March post — cementing, permanently and immediately,
the substitution that the cache is currently postponing. Migration would not
preserve the March photograph; it would destroy the last thing keeping it
visible.

The cover pair is the benign case: `?t=1783171206205` and `?t=1783171289706`
are 83 seconds apart and both return 1920×640 — one editing session, one image.

### Recommendation for D and E — and what it depends on

| question the brief asked | answer |
|---|---|
| are they actually post media? | **No.** All 18 are auto-generated *"updated their profile/cover photo"* announcements. The photograph belongs to the profile; the post merely announces it. |
| all posts referencing each object | in the table above; two objects have two posts each |
| current owner | path segment 2 for all 16 D; segment **3** for both E |
| is the object mutable? | **D: yes** — overwritten on every profile-photo change, proven above. **E: no** — `covers/<owner>/<timestamped-file>` is content-addressed by timestamp. |
| is copying to a canonical immutable path safe? | **Not for D as it stands.** A copy taken now copies *today's* photograph, which for at least one post is not the photograph that post was about. Safe only if the owner accepts that. **For E: yes** — immutable, but the owner is at segment 3, so `MIG-1019`/`MIG-2006` refuse it until the path shape is handled. |
| must the old URL stay valid? | **Yes.** It is the live profile photo URL, used everywhere avatars are shown. Nothing may move or remove it. |
| does cache-busting create historical ambiguity? | **Yes, and it is already realised** — see above. The `?t=` value records *when the post was made*, not which bytes were there; the CDN cache is the only thing currently making it look otherwise. |

**Proposed answer, for the owner to decide — not for me to take:**

1. **Do not migrate D.** These are profile-photo announcements whose photograph
   is, by design, the member's *current* one. Recording a content hash for a
   mutable key is a category error: the row would claim a permanence the object
   does not have, and `media_objects.sha256` is immutable after insert.
2. **A better repair than migration exists**, if the owner wants one: at the
   moment a profile photo is *changed*, copy the outgoing image to an immutable
   path and re-point the announcement post at that copy. That preserves history
   going forward. It cannot recover the March photograph, which is already gone
   from the origin.
3. **E is migratable in principle** — 2 slides, immutable, but needs the owner
   at segment 2. The cheapest honest route is a server-side copy to
   `post-images/<owner>/posts/<file>` and a re-point, designed as its own
   operation with source hash, destination hash, byte equality, owner
   verification, reference rewrite and rollback. **For two slides.** Recorded
   as available, not recommended.

**No copy has been designed or performed.** Per the brief, that waits on this
matrix being read.

---

## Class F — 27 references, 23 objects, and the finding that changes everything

```
slides                                                    27
posts                                                     15
distinct objects                                          23
ending in `-thumb`                                        27  (ALL of them)
where image_urls[i] === thumbnail_urls[i]                 27  (ALL of them)
under the post-images prefix                              27
distinct owners                                            5
post dates                            2026-03-13 … 2026-04-02
```

### ⚠ EVERY ONE OF THESE POSTS IS SHOWING ITS OWN THUMBNAIL

For all 27, `image_urls[i]` is byte-identical to `thumbnail_urls[i]`, and both
end in `-thumb.webp`. The post's main photograph *is* the 600px thumbnail.

Probed all 23 distinct objects on Supabase, thumbnail and original side by side:

```
originals present          17 of 23
sample:
  …/1773424319982_0-thumb.webp   600x600     …/1773424319982_0.webp   1920x1920
  …/1774282445398_0-thumb.webp   600x451     …/1774282445398_0.webp   1920x1442
  …/1774282573375_2-thumb.webp   451x600     …/1774282573375_2.webp   1442x1920
  …/1775128259145_0-thumb.webp   450x600     …/1775128259145_0.webp   1440x1920
CDN (cdn.50mmretina.com), same keys:
  thumb    refused
  original refused
```

The 6 without an `-original` sibling are the 2 `avatar` and 4 `covers/…` keys —
profile media, named differently, the same category as class D.

**So these 15 posts have been serving 600px thumbnails as the photograph for
five months, while the 1920px originals sat beside them the whole time.**

### Recommendation for F — and it is not "copy the thumbnails"

| question the brief asked | answer |
|---|---|
| do the Supabase objects exist? | **Yes**, all 23 thumbnails, measured. |
| are they referenced elsewhere? | Yes — each is also its own `thumbnail_urls[i]`. 4 objects are referenced by 2 posts each. |
| do they correspond to canonical originals? | **17 of 23 do, and the originals are present and 3.2× larger.** |
| should they be copied to R2? | **Not the thumbnails.** Copying a 600px file to R2 would make a bad state permanent and CDN-served. |
| are they thumbnails that should be regenerated? | No regeneration is needed — the originals were never lost. |
| should the post reference the original instead? | **Yes, for the 17.** That is the actual defect: `image_urls` points at the thumbnail. |

**The honest sequence, for the owner to approve:**

1. **Re-point** `image_urls[i]` at the original for the 17 objects that have one,
   leaving `thumbnail_urls[i]` as the thumbnail — which is what it is for. This
   is a *repair*, and members' photographs go from 600px to 1920px.
2. **Then copy** those originals from Supabase to R2 under
   `post-images/<owner>/posts/<file>`, with source hash, destination hash and
   byte equality verified before the reference is rewritten.
3. **Then migrate** them normally: once they are CDN-served under a class-A path
   they need no new pattern at all.
4. The remaining 6 (avatar/cover shapes) belong with class D and follow whatever
   is decided there.

⚠ Step 1 rewrites `posts.image_urls`. The brief forbids *deleting* it; this is a
correction, not a deletion — but it is member-visible and it is the owner's call,
so it is proposed here and **not done**.

⚠ NOTHING WAS DELETED. No Supabase object, no thumbnail, no post. The
thumbnails stay exactly where they are and stay referenced by
`thumbnail_urls`.

---

## What this class-by-class evidence adds up to

| class | slides | posts | migratable as-is | what it actually needs |
|---|---:|---:|:---:|---|
| B | 19 | 12 | **yes, now** | the widened pattern (shipped) + a migration cycle |
| C | 15 | 7 | **yes, now** | as B |
| D | 18 | 16 | no | a decision about mutable profile media; migrating it would cement a substitution |
| E | 2 | 2 | no | a copy to segment-2 shape; 2 slides, low value |
| F | 27 | 15 | no | **a repair first** — the posts point at thumbnails while the originals exist |

**34 of the 81 remaining slides are migratable data.** Of the other 47, 27 are a
data defect worth fixing on its own merits, 18 are profile media that arguably
should never be post media at all, and 2 are a rounding error.
