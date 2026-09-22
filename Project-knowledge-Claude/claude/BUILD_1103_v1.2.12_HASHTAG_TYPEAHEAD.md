# BUILD 1103 / v1.2.12 — THE HASHTAG TYPEAHEAD

Date: 2026-08-17 · Commit `53e7465` · Android Build run **#103** → versionCode **1103**

The owner said **GO** on 2026-08-17. The database half was applied and verified
first; the code half was pushed second; the build was cut last, with exactly one
trigger-path edit so the run number lands on 103.

---

## 1. WHAT WAS APPLIED TO PRODUCTION

Migration `20260816T1900_hashtag_index.sql`
(hash `cbb3efaecc9a82fe4da1c9adb497e93461a9b1a2`), rollback
`20260816T1900_hashtag_index_ROLLBACK.sql` (`f377fbef5d644309fe7185fb41cd1dc2f259a6f1`).

### Pre-flight, measured before touching anything

| Metric | Value |
|---|---|
| posts | 223 |
| posts containing `#` | 43 |
| distinct hashtags in captions | 81 |
| hashtag tables present | 0 |
| non-internal triggers on `posts` | 8 |

### After

| Metric | Value |
|---|---|
| `hashtags` rows | **81** |
| `post_hashtags` rows | 158 |
| posts | **223 — untouched** |
| indexes created | 7 |
| hashtag triggers on `posts` | 2 |
| **stored counts vs truth recomputed from captions** | **0 disagreements** |

### The live trigger probe

A post was created, edited and deleted **on the real database, inside a
transaction that was deliberately aborted**, so it never existed for members.
Every other trigger on `posts` was checked first for anything that escapes a
transaction (`net.http`, `pg_notify`, `dblink`) — none do.

```
baseline        #nature = 2 users / 2 posts
after create    #zzprobetag = 1u/1p   #nature = 2u/3p   links = 2
                caption held #ZzProbeTag #Nature #ZZPROBETAG — three tags,
                two rows: the casing collapsed correctly
after edit      #zzprobetag = 0u/0p   ← zeroed, not left stale
after delete    #nature = 2u/2p       ← exactly back to truth, 0 orphans
```

Production after the probe: 223 posts, 81 hashtags, no probe row left.

### The RPC

`suggest_hashtags(prefix, max_results)` — prefix only, never fuzzy.

- `50mm` → `#50mmretinaworld (1 person / 11 posts)`, `#50mmretina (1 / 6)`
- `#PHOTO` → 5 photography tags, nothing unrelated
- asked for 99 → returned **10** (hard cap), asked 5 → 5, asked 0 → 1
- `#` alone, or `zzzqqq` → nothing
- plan: **Index Scan**, 2 buffer reads, **0.111 ms**

**Ranked by PEOPLE, not posts.** `#50mmretinaworld` has 11 posts from exactly
one person — by post count the second most popular tag on the platform. Ranking
by posts would teach every new member one person's private tag.

---

## 2. WHAT WAS BUILT

New: `src/lib/captionHashtags.ts`, `src/hooks/feed/useCaptionHashtags.ts`,
`src/components/post/HashtagSuggestions.tsx`,
`src/lib/__tests__/captionHashtags.test.ts`.

Wired into **four caption surfaces and no others**:

1. WallPosts — the web composer (Feed and My Wall are one component)
2. WallPosts — the app's caption screen (screen 2)
3. PostCard — inline caption edit
4. EditScheduledPostDialog — scheduled-post caption edit

A test enforces that list. Adding a fifth surface is a CI failure.

### Two things learned while building

**The app's caption box never had a ref.** That is why the @mention list has
never appeared on a phone — `pick` and `refresh` both read the web composer's
ref, which is null while the app screen is showing. The hashtag list has its own
ref and its own hook instance. The mention list was left exactly as it is.

**Placement was decided by screenshot, not by guess.** The first attempt floated
the list upward inside the scheduled-post dialog. At 360px the capture showed it
covering the dialog title *and* its close button — trading a covered Save for a
covered ×. The "above" option was deleted from the component rather than left
available. Where Save and Cancel sit under the box, the list now takes real
layout space and pushes them down; nothing is ever hidden.

---

## 3. VERIFICATION

```
typecheck                0
tests                    1,890 passed, 1 skipped (19 new)
production build         0 errors
screenshots              140 across 4 viewports, 0 non-fixture errors
layout problems          1, and it is not this feature's — see below
```

---

## 4. FLAGGED, NOT FIXED — the owner's call

**PostCard's inline-edit Cancel and Save are 63×31 and 59×29** — under the 44px
thumb floor. Pre-existing, unrelated to hashtags, surfaced because the new scene
uses PostCard's real classes instead of substituted ones. Fix is one class on
each button. Not changed, because changing shipped button sizing is a visual
decision that belongs to the owner.

**`svgo` is not a declared dependency**, so `vite-plugin-image-optimizer` cannot
optimise SVGs during the build. The build succeeds; the SVGs simply ship
unoptimised. Not touched — the owner's rule forbids background dependency
changes.

---

## 5. STILL OPEN

- Journal / featured-artist PDF download — instrumented, cause not found.
- Pinch-to-zoom on a real handset — hardened, unproven.
- Create Post from pages other than Feed — the app now mounts one global
  composer; unproven on a real handset.
- NO REELS. NO LIVE.
