# The media write path — trace, diagram, and the decision

**Written 2026-08-20, before any code changed.** Phase 2 closure, Priority 1.

The audit that opened this workstream said the write path "does not create
media rows". That is true, but it is not the useful sentence. The useful
sentence is: **the server-side machine is complete, correct and already
deployed — and nothing walks through it.** What follows is the trace that
establishes that, the one hard blocker it uncovered, and the design that
follows from both.

---

## 1. The lifecycle as it runs in production today

```
  MEMBER                    BROWSER / APP                     EDGE                    STORAGE (R2)            DATABASE
  ──────                    ─────────────                     ────                    ────────────            ────────

  picks photo ─────────────▶ selectedImages[i]
                             imagePreviews[i]        (index-aligned, moved together)

  presses Post ────────────▶ uploadPhotos()
                             ├─ scanFileWithToast          (+ stale-handle rebuild)
                             └─ uploadImageWithThumbnail()
                                ├─ compressImageToFiles → webp, ⟨w,h⟩ known HERE
                                ├─ generateImagePath  → <uid>/posts/<ts>-<rand>.webp
                                ├─ + dimsSuffix ⟨w×h⟩ + LADDER_MARKER '-l3'
                                ├─ compressThumbnail  → <same>-thumb.webp
                                ├─ rungPlan → 1080 / 1440 siblings
                                └─ storageUpload ──────────▶ s3-presign-upload
                                                              └ isPathAllowed: uid MUST be a path segment
                                                              └ presigned PUT, 5 min ────▶ object written
                                   ◀── { url, thumbnailUrl }        (public CDN URL)

                             posts.insert({ user_id, content, privacy,
                                            image_url, image_urls[], thumbnail_urls[],
                                            categories, indexing_disabled }) ──────────────────────▶ posts row
                                                                                                     ▲
                                                                                    NOTHING ELSE HAPPENS
```

### Where each property is established

| property | established | where |
|---|---|---|
| storage object | presigned PUT to R2 | `s3-presign-upload` ← `storageUpload` |
| image URL | `<public_url>/<path>`, path built from uid + timestamp + `w×h` + `-l3` | `src/lib/imageUpload.ts:310–329` |
| post row | client `INSERT INTO posts` | `WallPosts.tsx:1207` |
| **media readiness** | **nowhere — no byte is ever re-read** | — |
| ownership | (a) uid must be a segment of the upload key; (b) `posts.user_id` client-supplied, RLS-checked | `s3-presign-upload:isPathAllowed`; posts RLS |
| ordering | array index of `image_urls`, aligned by convention with `thumbnail_urls` | `WallPosts.tsx` |
| privacy | `posts.privacy` only — the object is public regardless (D-003) | `WallPosts.tsx:1211` |

### Why media rows are not created

Not a defect. A door nobody opens. Verified against production:

| component | exists | deployed | called by anything |
|---|---|---|---|
| `media_objects` / `post_media` + RLS | ✅ | ✅ | migration engine only |
| `trg_media_state_transition` (pending→verified→ready, terminal quarantine, `owner_id`/`sha256` frozen) | ✅ | ✅ | — |
| `trg_post_media_requires_ready` | ✅ | ✅ | — |
| `media_begin_upload` → `authenticated` | ✅ | ✅ | **nothing** |
| `media_mark_verified` / `media_mark_ready` / `media_quarantine` → `service_role` | ✅ | ✅ | migration engine only |
| `post_publish_with_media` → `authenticated` | ✅ | ✅ | **nothing** |
| `media-verify-upload` (the only thing that may move pending→ready for a live upload) | ✅ in repo | ❌ **not deployed**, absent from `config.toml` | — |

So exactly two things are missing: a deployed verifier, and a client that calls
any of it.

---

## 2. THE BLOCKER: two incompatible object layouts

`media-verify-upload` derives the storage key **from the row**:

```ts
originalKeyFor(owner, mediaId, mime) → post-images/<owner>/media/<mediaId>/original.<ext>
```

That is the right instinct — a caller-supplied key would let a member point the
verifier at somebody else's object. But measured against production:

```
media_objects rows                                      229
  … stored as post-images/<owner>/media/<id>/original.*    0
  … stored as post-images/<owner>/posts/<name>.webp      229
  … carrying any rung derivative (1440/1080/600)           0
  … carrying the '-l3' ladder marker in the filename      32
```

**Deploying `media-verify-upload` as written would look for an object that does
not exist, and every upload would sit at `pending` for ever.** That is the
"do not blindly deploy" trap, and it is not hypothetical.

Two further consequences of the same fact:

- `derivatives` holds **only** `original`. The responsive ladder is served from
  the *filename* (`-l3` marker + `w×h` suffix), which `imageLadder.ts` and the
  renderer parse. An object stored as `media/<id>/original.webp` has no ladder
  and no `-thumb` sibling, so switching layouts silently disables responsive
  images and thumbnails for every new post — a regression no unit test would see.
- `post_media_for` returns `derivatives->>'original'`, which is exactly why the
  Item E read switch was pixel-identical. Preserving that is a hard requirement,
  not a nicety.

**Decision: keep the production layout (M). Register the object that was
actually uploaded; do not re-route storage.** This is the same thing
`media_migrate_post` already does for the 229 rows, so the live path and the
migrated path converge on one shape instead of creating a second one.

`media-verify-upload` is therefore **superseded, not deployed.** Its byte-check
logic is kept verbatim; only key derivation changes, and the caller-supplied-key
danger is closed a different way (§4).

---

## 3. The target state machine

```
                       media_begin_upload(sha256,w,h,bytes,mime)     ← authenticated
                                    │  UNIQUE(owner,sha256) ⇒ retry-idempotent
                                    ▼
                              ┌───────────┐
                              │  pending  │
                              └─────┬─────┘
        object PUT to R2            │  media-register-upload(media_id, object_path)   ← authenticated
        at <uid>/posts/…            │  · row.owner_id = caller            (else 404)
                                    │  · object_path ∈ post-images/<owner>/  (else 400)
                                    │  · READ the bytes back out of R2
                                    │
                    sha mismatch ───┤─── sha + size match
                    or size mismatch│         │
                                    ▼         ▼   dims re-derived from the bytes
                            ┌─────────────┐  media_mark_verified          ← service_role
                            │ quarantined │       │
                            │ (terminal)  │       ▼
                            └─────────────┘  ┌──────────┐
                                             │ verified │
                                             └────┬─────┘
                                                  │ media_mark_ready({original: <path>})
                                                  ▼
                                             ┌────────┐
                                             │ ready  │ ── the ONLY state post_media may reference
                                             └────┬───┘        (trg_post_media_requires_ready)
                                                  │
                       post_publish_with_media(media_ids[], …, idempotency_key)   ← authenticated
                                                  │
                    ┌─────────────────────────────┴──────────────────────────────┐
                    │ ONE TRANSACTION                                            │
                    │  · auth.uid() required, 1..10 ids, no repeats              │
                    │  · every id: exists ∧ owner = caller ∧ state = ready       │
                    │  · idempotency key short-circuits BEFORE any write         │
                    │  · INSERT posts                                            │
                    │  · INSERT post_media  ord 0..n-1 FROM WITH ORDINALITY      │
                    │  · dual-write image_urls / thumbnail_urls  (§5)            │
                    │  · completeness gate: count(post_media) = n                │
                    │  · COMMIT — or the post never existed                      │
                    └────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
                                     post_media_for  →  the client read path
```

---

## 4. Closing the caller-supplied-key danger without the layout

The verifier's key derivation existed to stop a member pointing it at another
member's object. Keeping layout M means the path *must* come from the caller,
so the same danger is closed by three checks that do not depend on derivation:

1. **`object_path` must begin `post-images/<row.owner_id>/`** — and `row.owner_id`
   comes from the row, which is checked to belong to the caller. A member can
   therefore only ever name an object inside their own folder. This is the same
   invariant `MIG-2006` enforces for the migration, and the same one
   `s3-presign-upload` enforces on the way in.
2. **The bytes must hash to the fingerprint declared *before* the upload.**
   Pointing at a different object in your own folder fails the hash, and fails
   into `quarantined`, which is terminal.
3. **`sha256` and `owner_id` are frozen after insert** by
   `trg_media_state_transition`, so a row cannot be re-aimed after the fact.

Naming somebody else's object is refused at (1). Naming a *different* object of
your own is refused at (2). Re-pointing a `ready` row is refused at (3).

---

## 5. The dual-write, why it is mandatory, and exactly how it ends

`post_publish_with_media` as shipped writes `image_urls = '{}'`. **Publishing
that today would blank the photograph** for:

- the **Android app** — a separately released binary that reads
  `posts.image_urls`, cannot be updated from this repository, and is in members'
  hands right now;
- `Feed.tsx`, `PostCard`, `ProfilePostGrid`, `DraftsList`, `ScheduledPostsList`,
  `useScheduledPosts` — Item E switched the four feed/detail producers, not
  every consumer;
- **every thumbnail everywhere** — `thumbnail_urls` has no representation in
  `media_objects` at all; `post_media_for` returns `derivatives.original` only.

So the new path writes **both**, and the legacy arrays are *derived or
constrained server-side* rather than trusted:

- `image_urls[i]` is **derived** inside the transaction from
  `media_objects.derivatives->>'original'` of the media at `ord = i`. The client
  cannot supply it, so it cannot publish media A while showing URL B.
- `thumbnail_urls[i]` **cannot** be derived — `-thumb` is a filename convention
  and the documented fallback reuses the full-size URL when thumbnail encoding
  fails. It is therefore *supplied but constrained*: each value must equal the
  derived original **or** that original with `-thumb` inserted before the
  extension. Anything else is refused. Constrained, not trusted.

**How the dual-write ends.** Three conditions, all checkable:

1. every remaining `image_urls`-reading consumer in this repository is switched
   to `resolvePostImageUrls` (6 files, listed above);
2. `thumbnail_urls` is represented in the media schema — the honest shape is a
   `thumb` key in `derivatives`, which requires widening
   `media_mark_ready`'s rung allow-list, a security-control change with its own
   review;
3. the Android binary in members' hands reads the new path — a store release,
   not a deploy, and the long pole.

Until all three hold, removing the dual-write blanks photographs. Registered as
**D-004** in `docs/DECISIONS.md` and pinned, so it cannot be dropped quietly and
cannot be forgotten.

---

## 6. What this design deliberately does NOT do

- It does not touch `posts.image_urls` for any existing post.
- It does not change the storage layout, the ladder, or any published URL.
- It does not deploy `media-verify-upload` (§2).
- It does not make the bucket private or pretend to close D-003. A newly
  published photograph is exactly as publicly fetchable as it was yesterday;
  that gap is D-003's and is unchanged by this work.
