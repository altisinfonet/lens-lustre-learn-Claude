# THE REMAINING LEGACY-ONLY MEDIA — EVIDENCE, PER SLIDE

**Measured:** 2026-08-20, live production. **Population:** 35 posts / 47 slides.

Nothing in this document has been copied, re-pointed or deleted. It exists so the
next decision is made from measurement rather than from the shape of a URL.

---

## THE SPLIT THAT MATTERS

| | Posts | Slides | Can it ever carry a media object? |
|---|---|---|---|
| **Permanent floor** (D, D′) | 18 | 18 | **No.** The object is overwritten in place. |
| **Migratable backlog** (E, F) | 17 | 29 | In principle yes; each has a specific blocker below. |

`media_write_path_delta()` reports these separately (`permanent_legacy_*` vs
`migratable_legacy_*`) so a healthy floor can never be mistaken for a leak.

---

## CLASS D + D′ — MUTABLE PROFILE MEDIA · 18 slides / 18 posts · **RETAIN**

`avatars/<owner>/avatar.webp?t=…` (16) and `avatars/<owner>/cover.webp?t=…` (2).

| Field | Finding |
|---|---|
| Owner | segment 2 — derivable, correct |
| Mutability | **MUTABLE.** Overwritten in place on every profile-photo change |
| Query string | present on all 18 (`?t=` cache-buster) |
| Kind | 16 `member` (predate `post_kind`), 2 `system` |
| Dates | 2026-03-13 → 2026-08-18 |
| Referenced by | one post each |
| Safe to migrate | **NO** |
| Rollback | n/a — nothing done |

**Why not, in one sentence:** a media object is a promise that a sha256 describes
the bytes at a key, and for this key that promise is false the moment the member
changes their picture again.

Measured proof that this is not theoretical: one class-D key's two cache-busted
URLs return **different images** (400×267 and 400×400). Migrating it would cement
whichever substitution the CDN cache happened to be holding.

**Recommended action:** retain, and keep counting them (`MEDIA-4007`). They are the
floor of the legacy-only population, not a fault in it. The only thing that would
change this is a product decision that a profile-update announcement should
*snapshot* the image to an immutable path rather than point at the live avatar —
which changes what the post means, and is the owner's call, not a cleanup.

---

## CLASS E — COVER PHOTOS AT AN OFF-BY-ONE OWNER PATH · 2 slides / 2 posts · **RETAIN**

`avatars/covers/<owner>/<timestamp>-<name>.jpg`

| post_id | ord | dimensions | owner at seg 3? | in Supabase bucket? | live on CDN? |
|---|---|---|---|---|---|
| `6ec9d6e6…` | 1 | **1500 × 1000** | yes | no (already on R2) | **yes** |
| `72f52db2…` | 1 | **2000 × 1333** | yes | no (already on R2) | **yes** |

Both belong to member `569aa88e…`, both dated 2026-03-19, both `.jpg`, neither
carries a query string. One filename contains a space (`Faces of the World.jpg`).

**These are real, immutable, full-size photographs on the CDN.** They are excluded
for one narrow reason: the migrator's `MIG-1019` requires the owner at path
**segment 2** (`split('/')[1]`), and here `covers` occupies that position.

**Why they are being retained rather than migrated.** Admitting them needs
`MIG-1019` to become conditional — "the owner is at segment 2, unless the prefix is
`avatars/covers/`, in which case segment 3". That rule is the single most
safety-critical check in the migrator: Cycle 5A found it catching **three real
ownership violations** in avatar rows that the abandoned backfill would have
migrated. Making it conditional, for two slides belonging to one member, is a poor
trade — conditional ownership rules are how spoofing gets in.

**Recommended action:** retain and report. If the owner wants them migrated, the
safe design is a fourth candidate class with its **own** explicit ownership
extractor and its own mutation tests, not a widening of `MIG-1019`.

---

## CLASS F — THUMBNAILS SERVING AS THE PHOTOGRAPH · 27 slides / 15 posts

Host `jtdtehuqtinjxropkkcn.supabase.co` (Supabase storage, **not** the R2 CDN).

**Every one of the 27 slides ends in `-thumb.webp`.** The post is displaying a
600-pixel thumbnail where the member's photograph should be. 23 distinct objects.

### F-1 — original present and VERIFIED · 17 slides · repair proposed, **not applied**

For each, the sibling original was found in `storage.objects` and both files were
fetched and measured from their header bytes:

| Object | Thumb | Original | Original bytes |
|---|---|---|---|
| `5745a9c9…/1773424319982_0` | 600×600 | **1920×1920** | 433,806 |
| `622dada0…/1774282445398_0` | 600×451 | **1920×1442** | 221,922 |
| `622dada0…/1774282446964_1` | 600×451 | **1920×1442** | 468,332 |
| `622dada0…/1774282447963_2` | 600×451 | **1920×1442** | 381,964 |
| `622dada0…/1774282448896_3` | 600×451 | **1920×1442** | 479,718 |
| `622dada0…/1774282570868_0` | 600×451 | **1920×1442** | 409,716 |
| `622dada0…/1774282572294_1` | 600×451 | **1920×1442** | 444,466 |
| `622dada0…/1774282573375_2` | 451×600 | **1442×1920** | 264,632 |
| `622dada0…/1775128259145_0` | 450×600 | **1440×1920** | 160,416 |
| `622dada0…/1775128262290_1` | 600×450 | **1920×1440** | 221,802 |
| `622dada0…/1775128263920_2` | 450×600 | **1440×1920** | 132,084 |
| `622dada0…/1775128265519_3` | 450×600 | **1440×1920** | 199,306 |
| `622dada0…/1775128354335_0` | 450×600 | **1440×1920** | 230,670 |
| `85250f9f…/1775108953146_0` | 600×270 | **1920×864** | 152,694 |
| `85250f9f…/1775108955138_1` | 270×600 | **864×1920** | 140,280 |
| `85250f9f…/1775108956335_2` | 600×270 | **1920×864** | 139,960 |
| `cc691988…/1774194807552_0` | 502×600 | **1605×1920** | 82,666 |

**The pairing is proven, not assumed.** Every thumb is exactly 600px on its long
edge; every original is exactly 1920px on its long edge; every aspect ratio matches
to within integer rounding at 600px (max Δ 0.0011). That is the uploader's
thumbnail rule, applied 17 times.

Two of these objects are referenced by **two posts each** — any repair must handle
shared references rather than assuming one referrer.

### F-2 — original GONE · 6 slides · **RETAIN**

| Object | Why there is no original |
|---|---|
| `83f6d083…/avatar-thumb.webp` | avatar original overwritten/removed |
| `85250f9f…/avatar-thumb.webp` | avatar original overwritten/removed |
| `85250f9f…/covers/1775110594127-1000651117-thumb.webp` | cover original gone |
| `85250f9f…/covers/1775110611198-1000656054-thumb.webp` | cover original gone |
| `85250f9f…/covers/1775110653428-1000652488-thumb.webp` | cover original gone |
| `622dada0…/covers/1774283068622-…_n-thumb.webp` | cover original gone |

The thumbnail is **all that survives** of that moment. It is the photograph now.
Retain untouched — regenerating is impossible and deleting would destroy the only
copy.

### What class F is NOT

It is **not** a migration backlog. These objects are on `supabase.co`, and the
migrator only ever accepts `cdn.50mmretina.com` (`MIG-1015`, `MIG-1080`). Even
after a repair they remain outside the candidate population until someone decides
whether to copy them to R2 — a separate question, deliberately not answered here.

Class F is a **quality defect**: 17 slides are showing a 600px thumbnail while the
member's 1920px photograph sits in storage, reachable, intact.

---

## THE ONE THING AWAITING A DECISION

`supabase/migrations/UNAPPLIED_20260820140000_classF_repoint_originals.sql` is
written, reversible, and **deliberately not applied**. It re-points those 17
slides from `-thumb.webp` to the verified original, recording the before-state in
its own audit table so it can be undone exactly.

It is not applied because it rewrites what 15 posts show to their members. That is
the owner's call, not a cleanup — and rule 4 of the closure command is "no blind
reference rewriting". The rewriting would not be blind, but it would be unasked.
