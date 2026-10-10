# B3d-IMG — IMAGE DELIVERY (added to the final engineering plan)

Owner's specification, 2026-08-17, based on `CDN_Image_Delivery_Measured.docx`.
Recorded here **with three corrections**, each backed by a measurement taken
after the spec was written. The owner's requirement numbers are preserved.

---

## THE OWNER'S SPEC IS ADOPTED

It is stronger than the four-line fix list I gave him. Five things it adds that
mine did not have, and all five are right:

- **One canonical resolver (1, 2)** — my list said "route plain `<img>` through
  the resizer", which is a hundred-odd edits with no rule preventing the
  hundred-and-first. A resolver plus a ban on requesting originals is a rule.
- **Named surface audit (5)** — mine would have fixed the feed and left Search,
  Discover, Journal and Competition quietly unfixed.
- **One architecture, not two (12)** — stored derivatives *and* on-the-fly
  transformation both exist. Nothing said which wins. That ambiguity is how a
  platform ends up with two half-built image systems.
- **Privacy after transformation (15, 16)** — I did not think of it at all. See
  correction C: it is right, and it is not this phase's work.
- **A regression alarm and a DONE definition (Regression rule)** — "Do not mark
  B3d-IMG DONE from source-code inspection alone" is the exact discipline that
  was missing when the resizer was switched off in August and nobody noticed
  every phone had started downloading originals.

---

## CORRECTION A — the spec bundles a one-week win with a multi-week migration

Requirements **6 and 7** say dimensions must stop coming from the filename and
must come from canonical media metadata instead.

**Measured 2026-08-17:**

```
media_objects rows          0
media_objects with width/height   0
post_media links            0
photos actually stored      275   (as text URLs in posts.image_urls)
```

`media_objects` exists and is **completely empty**. For 122 photos the filename
is the only dimension source there is; for the other 153 there is **no source at
all**. Doing 6 and 7 before a backfill removes the only working source and
replaces it with nothing.

**Measured, and this is what breaks the deadlock** — the CDN resizer never
upscales:

```
original is 960x1440
ask width=320   -> 320x480
ask width=640   -> 640x960
ask width=1280  -> 960x1440   (capped, not upscaled)
ask width=2400  -> 960x1440   (capped, not upscaled)
```

So a correct `srcset` can be built **without knowing a photo's dimensions**.
Right-sized delivery does not depend on the metadata backfill at all.

**Therefore split the phase:**

- **B3d-IMG-1 — Delivery (no migration, no re-upload).** Requirements 1, 2, 3,
  4, 5, 9, 10, 14. Ships the whole measured win: the 716 KB tile stops being
  716 KB. Nothing in it needs `media_objects`.
- **B3d-IMG-2 — Metadata and derivatives.** Requirements 6, 7, 8, 11, 12, 13.
  Backfill `media_objects` for the 275 photos, then flip the dimension source
  and turn on layout reservation. Layout reservation (8) genuinely needs
  dimensions and belongs here.

Requirement 10 already says do not wait for the backfill. This split is that
sentence made structural.

---

## CORRECTION B — requirement 3 and requirement 4 pull against each other

**3** asks the resolver to choose a width from *actual rendered width × DPR*.
**4** asks for browser-native `srcset`/`sizes`.

A component cannot know its rendered width before it lays out; that is precisely
the problem `srcset` exists to solve, and the browser knows the DPR we cannot
read at render time. Measuring first would mean rendering twice on every photo.

**Resolution:** requirement 4 is the mechanism, requirement 3 is the *intent*.
The resolver emits a candidate ladder and a per-surface `sizes` string that
declares the slot honestly (`(max-width:768px) 100vw, 590px` for the feed;
`148px` for a Trending tile). The browser then does exactly what requirement 3
asks, using information we do not have. Requirement 3's "defined maximum" is
kept as a hard cap in the resolver.

---

## CORRECTION C — requirements 15 and 16 are not enforceable in this phase

They ask that authorization survive CDN transformation and that a privacy change
invalidate the old public representation.

**The state today:** every image on `cdn.50mmretina.com` is publicly readable by
address, transformed or not. There is no authorization to preserve. This is the
known **B5 / Media-URL red cell** — the same reason the privacy chooser is
currently withheld from both composers, recorded in `WallPosts.tsx`.

A transformed URL therefore cannot "bypass" visibility, because the untransformed
URL does not enforce it either. Writing 15 and 16 into B3d-IMG would let the
phase be marked DONE with a privacy claim it cannot honour.

**Resolution:** 15 and 16 move to **B5**, and B3d-IMG carries a blocking note:
*the resolver must not be described as privacy-preserving until B5 lands.* One
thing does belong here now — the resolver must be built so that swapping its
base URL for an authorized delivery endpoint is a one-file change, so B5 does
not require touching every surface again.

---

## ACCEPTANCE TESTS — adopted as written, with baselines

The owner's tests A–G stand. They need starting numbers or "improved" is
unprovable. Measured 2026-08-17 on the live feed, signed in:

| Gate | Baseline today |
|---|---|
| CDN images on one feed screen | 51 |
| no responsive choice | 42 (82%) |
| pointing at full original | 32 (63%) |
| reserving layout space | 3 (6%) |
| image bytes, 19 no-choice photos | 3.18 MB |
| average photo | 171 KB |
| largest single photo | 716 KB (960×1440 in a ~148px tile) |
| CDN response, forced network | 137 / 224 / 223 / 226 ms |
| photos with a 1080/1440 derivative | 9 of 275 |

Gate D ("no obviously insufficient resolution") needs a number, not a judgement.
Proposed: **a delivered image is a failure if its pixel width is below 1.0× or
above 2.0× the slot's device-pixel width.** Below is soft, above is waste.

Gate G's p50/p95, decode time, LCP and layout shift have **no baseline yet** —
the CDN sends no `Timing-Allow-Origin`, so the browser reports 0 bytes for every
CDN image and the site is blind to its own image performance. Getting that
header added is a prerequisite for gate G, not an afterthought.

---

## REGRESSION RULE — adopted, and made concrete

`tools/uishot/repro-crop-upload.mjs` is the pattern: drive the real page, read
the real network, fail on a number. The image equivalent must fail CI when any
photo-card surface requests an original unnecessarily, and must report which
surface — not just that the total went up.

## DONE

Unchanged from the owner's definition: implementation + a real network trace +
privacy test + real-device verification + a live regression alarm. **Not from
reading the source.**
