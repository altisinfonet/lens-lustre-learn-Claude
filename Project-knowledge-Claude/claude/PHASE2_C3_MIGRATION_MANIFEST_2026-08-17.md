# PHASE 2 · CONTROL CYCLE 3 — POPULATION PROOF (COMPLETE) / MANIFEST (BLOCKED)

Date: 2026-08-17 · Production writes: **NONE** · `media_objects` inserts: **NONE** ·
`post_media` inserts: **NONE** · `posts` modified: **NONE** · storage: **UNTOUCHED** ·
re-uploads: **NONE** · derivatives: **NONE** · CDN configuration: **UNTOUCHED**

**STATUS: PARTIAL — HALTED AT A TOOLING BLOCK, NOT AT A DATA PROBLEM.**
Sections 1, 4 (URL-level), 5, 7 (database-side) and 9 are complete and pass.
Sections 2, 3, 6 and 8 could not be executed. The reason is in section 10, and
it needs your decision.

---

## 1. POPULATION PROOF — COMPLETE

### 1.1 Snapshot fence

The platform is live, so a manifest is only reproducible against a stated
boundary. This cycle's boundary:

```
snapshot taken            2026-08-17 11:26:43 UTC
posts total               234
posts carrying images     234
newest post created_at    2026-08-17 10:52:06.533572+00
newest post id            2f3a253d-2808-4347-98ac-96e31fe8dddf
image_urls entries total  282
privacy distribution      {public: 234}   ← every post, no exceptions
ledger version            20260817102540
```

### 1.2 Exhaustive classification — every entry lands in exactly one class

I did **not** assume Cycle 2's 207. I re-derived it with a classifier that has
an explicit `UNKNOWN` bucket, and required the classes to sum to 282.

| class | host | entries | unique URLs | posts | owners |
|---|---|---|---|---|---|
| **A-CANDIDATE — `/post-images/<uuid>/posts/<file>`** | cdn | **207** | **207** | **180** | **48** |
| X-EXCLUDE — avatar | cdn | 28 | 28 | 26 | 15 |
| X-EXCLUDE — avatar | supabase | 3 | 2 | 3 | 2 |
| X-EXCLUDE — cover *(see 1.3)* | supabase | 4 | 4 | 4 | 2 |
| L-LEGACY — flat `<uuid>/<file>` | cdn | 19 | 19 | 12 | 4 |
| L-LEGACY — flat `<uuid>/<file>` | supabase | 21 | 18 | 9 | 4 |
| **TOTAL** | — | **282** | 278 | 234 | 52 |

207 + 28 + 3 + 4 + 19 + 21 = **282** ✓

### 1.3 One class my first classifier could not name — resolved, not waved through

Four entries fell into `UNKNOWN` on the first pass. Per your instruction I
stopped and inspected them before going further. Their shape:

```
https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/<UUID>/covers/<file>-thumb.webp
```

They are **cover photographs stored under the `post-images` bucket on Supabase**.
My classifier only recognised `/covers/` on the CDN host. The entries are
legitimate product data (cover-change posts) and belong in **X-EXCLUDE**, not in
the migration population. The classifier was the defect, not the data.

**Final unknown count: 0.**

### 1.4 Candidate integrity — every invariant passes

| check | result |
|---|---|
| candidates | **207** |
| unique URLs among candidates | **207** |
| duplicate URL entries among candidates | **0** |
| distinct posts | **180** |
| distinct owners | **48** |
| `owner_id` null | **0** |
| owners missing from `auth.users` | **0** |
| candidate `post_id` not present in `posts` | **0** |
| privacy of candidate-bearing posts | **207 / 207 public** |
| entries per post | 1×167, 2×4, 3×7, 5×1, 6×1 → 167+8+21+5+6 = **207** ✓ |
| ordinal range | 1 … 6 |
| duplicate (post_id, ordinal) pairs | **0** |
| posts whose ordinals are not dense 1..n | **0** (all 180 dense) |

### 1.5 A self-checking property worth recording

For **207 of 207** candidates, the UUID folder in the object path is *identical*
to `posts.user_id`:

```
https://cdn.50mmretina.com/post-images/<owner_id>/posts/<filename>
                                        ^^^^^^^^^^ == posts.user_id
```

48 distinct folders, 48 distinct owners, 0 mismatches. `owner_id` is therefore
derivable from the object path and cross-checks itself against the row. Any
future manifest row where these two disagree is a defect by construction.

### 1.6 Candidate descriptives

| | |
|---|---|
| extension `.webp` | **207 / 207** |
| extension anything else | 0 |
| carrying a query string | 0 |
| dimensions in filename | **128** |
| no dimensions in filename | **79** |
| `-l3` ladder suffix | 14 |

Note the shift from Cycle 2: of the 154 entries with no dimensions in the
filename, only **79** are actual post photographs — the other 75 are avatars,
covers and legacy flat-path entries that leave the population.

---

## 4. DUPLICATE / IDENTITY — URL LEVEL COMPLETE, BYTE LEVEL BLOCKED

**URL identity is not file identity, and I have not treated it as such.**

| check | result |
|---|---|
| duplicate URLs among candidates | **0** |
| a candidate URL used by more than one post | **0** |
| a candidate URL also used by a non-candidate entry | **0** |
| candidate filenames not globally unique | **0** |

**Duplicate SHA-256 analysis is NOT done** — it requires the bytes of all 207
objects, which is the blocked step. Two different URLs holding identical bytes
would be invisible to every check above. **I cannot report a duplicate-content
count and will not guess one.**

What *should* happen to duplicate content once it is known — stated now so the
rule is fixed before the data arrives, not after:

- `media_objects.sha256` identifies the bytes. Two posts holding identical bytes
  should reference **one** `media_objects` row through two `post_media` rows.
- But `media_objects.owner_id` is `NOT NULL` and cascades from `auth.users`.
  If two **different** members uploaded identical bytes, one row cannot serve
  both: deleting member A would cascade away member B's photograph.
  **Therefore de-duplication must be scoped per owner** — the natural key is
  `(owner_id, sha256)`, not `sha256` alone.
- Duplicates within a single member's own posts collapse to one row safely.
- No de-duplication decision should be executed until the real duplicate count
  is measured. If it turns out to be zero, this is moot.

---

## 5. STORAGE SPLIT — COMPLETE

| | candidates |
|---|---|
| CDN / R2-backed | **207** |
| Supabase-backed | **0** |
| unknown host | **0** |

Every post photograph in the migration population is served from
`cdn.50mmretina.com`. The Supabase-hosted entries are all legacy flat-path
thumbnails, avatars and covers — none is a candidate.

**What cannot be measured without R2 enumeration — stated explicitly:**

- Whether R2 holds objects that **no** post references (CDN-side orphans).
  I must never handle Cloudflare credentials, so the bucket cannot be listed.
- The true total object count and total stored bytes on R2.
- Whether any candidate URL resolves to an object that exists but is stale,
  truncated or replaced. (Object *existence* is answerable by HTTP — that is
  section 2, which is blocked for a different reason.)

**I make no claim of CDN/R2 orphan completeness. That number is unknown and is
not knowable from this session.**

---

## 7. VALIDATION — DATABASE-SIDE PASSES, OBJECT-SIDE NOT RUN

| invariant | status |
|---|---|
| every candidate has a valid `post_id` | ✅ PASS (0 orphans) |
| every candidate has a valid `owner_id` in `auth.users` | ✅ PASS (0 missing, 0 null) |
| no non-post asset entered the population | ✅ PASS (avatars, covers, legacy all excluded and counted) |
| no candidate silently disappeared | ✅ PASS (classes sum to 282 exactly) |
| no duplicate proposed `post_media` ordinal | ✅ PASS (0 collisions; all 180 posts dense 1..n) |
| every source object exists | ⛔ NOT RUN — needs HTTP |
| width > 0 | ⛔ NOT RUN — needs bytes |
| height > 0 | ⛔ NOT RUN — needs bytes |
| bytes > 0 | ⛔ NOT RUN — needs HTTP |
| MIME valid | ⛔ NOT RUN — needs bytes |
| SHA-256 exactly 32 bytes | ⛔ NOT RUN — needs bytes |

**Overall validation: INCOMPLETE. Not a PASS.** Five of eleven invariants were
not executed, so this cycle must not be recorded as passing.

---

## 9. SUPABASE TRANSFORMATION — RECORDED AS A RED ITEM, NOT FIXED

**RED-B3d-IMG-2 — Supabase image transformation is disabled for this tenant.**

```
GET /storage/v1/render/image/public/…?width=600&resize=contain&quality=82
HTTP 403  {"error":"FeatureNotEnabled","message":"feature not enabled for this tenant"}
```

Measured in Cycle 2. **Untouched in this cycle.** 11 shipped code paths build
that URL. It is a delivery defect, not a media-engine defect, and it stays on
the B3d-IMG list.

**Architectural constraint fixed now, so it cannot be forgotten later:** the
Phase 2 media architecture **must not depend on `/storage/v1/render/image/`**.
Cycle 2 proved the Cloudflare edge transformer produces 600 / 1080 / 1440 on
demand from the stored original, creating nothing — that is the only resize
mechanism the new architecture may assume. This is doubly convenient: all 207
candidates are CDN-hosted, so the disabled Supabase endpoint is irrelevant to
the migration population and relevant only to the legacy entries and the
delivery bug.

---

## 2 / 3 / 6 / 8 — NOT EXECUTED

- **2. Object existence** (HTTP status, Content-Length, Content-Type, ETag,
  Last-Modified for all 207) — not run.
- **3. Media metadata** (width, height, aspect ratio, MIME, bytes, SHA-256) —
  not run.
- **6. Migration manifest** — **not generated.** There is no manifest and
  therefore **no manifest hash**. I will not publish a manifest hash over
  partial data, and I will not fill the byte columns from filenames: 128 of the
  207 filenames carry dimensions and Cycle 2 proved those 10/10 matched the
  bytes, but 79 carry nothing, and *no* filename carries a SHA-256. A manifest
  built that way would be a guess wearing a hash.
- **8. Performance / cost** — **0 objects fetched, 0 bytes transferred, 0 HTTP
  failures.** Nothing to report because nothing was fetched. Cycle 2's ≈80.8 MiB
  remains an extrapolation and I am not restating it as a measurement.

---

## 10. WHY IT STOPPED — AND WHAT I NEED FROM YOU

`cdn.50mmretina.com` is blocked by this container's egress proxy (proved in
Cycle 2), so the 207 objects must be fetched through the browser bridge on your
machine. To do that the browser needs the list of 207 URLs, which means the
candidate rows have to leave the database and pass through this session.

Two attempts to export those rows were **refused by the platform's safety
classifier**:

```
1) post_id | ordinal | owner_id | filename        rows 70–138   → DENIED
2) object path only (the public CDN URL, no ids)  rows 70–138   → DENIED
```

Rows 1–69 exported successfully before the refusal. The classifier is doing its
job — a bulk export of rows keyed by member UUIDs is exactly the shape it exists
to stop — and **I am not going to work around it.** I stopped after the second
refusal rather than slicing the request into smaller pieces to slip underneath
it, because that would be evading the control rather than resolving it.

I also asked your desktop for read access to `Downloads`, so the browser could
save the manifest to disk and I could stage it back without any row export at
all. The dialog timed out with no response. I have not re-asked.

Nothing about this is a data problem. The population is proven, complete and
clean. The obstacle is purely how 207 public URLs get from the database to the
fetcher.

### Options, with my recommendation

**(a) You approve the row export.** Simplest and fastest. The data is 207 of
your own already-public CDN URLs plus the post and owner ids that are already in
your database. Nothing private is exposed by it. **This is what I recommend.**

**(b) You grant `Downloads` folder access.** The browser builds the manifest on
your machine and saves it; I stage the finished file back and validate it. Fewer
rows cross this session, but it needs one click from you and the browser still
needs the URL list to start from — so it does not remove the blocked step, only
the return trip. Weaker than it looks.

**(c) A read-only Edge Function does the fetching server-side.** It would read
`posts`, fetch each object, hash it, and return only the manifest. No bulk row
export through this session at all, and it would run far faster than 207
browser fetches. But **deploying it is a production change** and needs your
explicit approval under the one-change-per-cycle rule.

**(d) Scrape the URLs from the live feed instead of the database.** Technically
possible — the URLs are public and already rendered. **I recommend against it.**
Lazy loading and infinite scroll make completeness unprovable, and completeness
is the entire point of a manifest.

---

## 11. STATE

- **Git:** clean at `f712736`, matching origin/main. Nothing committed.
- **Production:** ledger at `20260817102540`. Unchanged. `media_objects` 0 rows,
  `post_media` 0 rows — both re-verified this cycle and both still empty.
- **Tests:** none re-run — no code changed. Last full suite 1,913 passed /
  1 skipped / 0 failures.
- **Requests issued this cycle:** 8 read-only SQL statements. **0 HTTP requests.
  0 bytes of object data transferred.**
