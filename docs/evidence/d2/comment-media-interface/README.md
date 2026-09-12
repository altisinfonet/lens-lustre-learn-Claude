# Interface request — media on a comment (image attach and GIF)

**From:** D2 (Client & Delivery) · **For:** the Auditor, to schedule as a D1 unit
**Raised:** 2026-09-12 · **Blocks:** the two composer controls in the owner's
reference screenshot, deferred out of PR #236

---

## Why this is a request and not a patch

The owner's reference composer carries an image-attach control and a GIF
control. Both were built out of PR #236 rather than shipped, because:

```
post_comments = id · post_id · user_id · content · parent_id
                created_at · updated_at · is_pinned
```

There is **no media column and no comment-media table**. Nothing the controls
produced could be stored or read back, and `supabase/**` is D1's lane. A greyed
"coming soon" button, or a URL smuggled inside `content`, were both refused —
the first is a hidden operation, the second invents an encoding a real column
would later have to undo.

---

## The shape being asked for, and why it is this shape

**Do not add `image_url` / `image_urls` to `post_comments`.** That is the shape
posts are being migrated AWAY from, and it would put a second media path in the
codebase two months after the first one was consolidated.

The engine already exists. A post attaches media through a join table:

```sql
post_media (post_id uuid, ord integer, media_id uuid)   -- PK (post_id, ord)
  media_id → media_objects(id) ON DELETE RESTRICT
```

`media_objects` already carries ownership, `sha256`, dimensions, `mime`,
`bytes`, `visibility`, `derivatives`, `state`, verification and quarantine. A
comment needs none of that re-implemented — only the same join, keyed to a
comment:

```sql
post_comment_media (
  comment_id uuid NOT NULL,   -- → post_comments(id) ON DELETE CASCADE
  ord        integer NOT NULL,
  media_id   uuid NOT NULL    -- → media_objects(id) ON DELETE RESTRICT
);
-- PK (comment_id, ord); UNIQUE (comment_id, media_id)
```

Deliberately mirrors `post_media` field for field, including `ord`, so an
attachment is ordered the same way a post's photographs are and a future
multi-attachment comment needs no second migration.

`ON DELETE CASCADE` on `comment_id` (deleting a comment must not strand rows)
and `ON DELETE RESTRICT` on `media_id` (matching `post_media` — an object still
referenced is not deletable).

### A GIF is not a separate feature

A GIF is `mime = 'image/gif'`, already recognised by
`src/lib/fileSecurityScanner.ts` (magic-byte check) and by
`src/lib/native/gallery.ts`. It needs **no separate table, column or provider**.
If the owner later wants a GIF *search* picker (Giphy/Tenor), that is a
different unit with its own third-party review — and it still lands in
`media_objects` through the same upload path. Nothing in this request assumes
it.

---

## What the client must be handed back — and what it must not

Per the standing rule, a media read reaches the client as:

```
comment_id · ord · media_id · width · height · mime · url
```

**Never** `sha256`, `derivatives`, `state`, `verified_at`, `owner_id` or
`quarantine_reason`. Those are internal storage and integrity fields; if a
proposed view or RPC returns them, D2 will raise it rather than consume it.

---

## RLS, stated as a question rather than assumed

**A comment's attachment must be exactly as visible as the comment itself, and
no more.** Whatever policy governs `SELECT` on `post_comments` must govern this
join, so a Friends-only post's comment attachment is not readable by anyone who
cannot read the comment.

⚠ **D-002 is still open and bears directly on this.** `post-images` is a public
bucket whose storage SELECT policy has no privacy condition, so a file is
fetchable by URL regardless of which table the client reads. Adding comment
attachments to that bucket widens an already-open gap. **D2's position: comment
media should not go to a public bucket until authorized delivery is live.** This
is the Auditor's call, not D2's, and it is the reason this request names it
rather than leaving it to be discovered.

---

## What D2 does once the column exists

Small, and none of it is speculative:

1. `usePostComments` selects the join alongside the comment rows — one extra
   query keyed on the same `commentIds` array it already builds for reactions,
   not an N+1.
2. `CommentThread`'s row renders the attachment under the comment body through
   `OptimizedImage` (never a bare `<img>` — the lint rule rejects it).
3. `CommentComposer` gains the two controls, wired to the existing
   `src/lib/storageUpload.ts` path and the existing security scanner. No new
   upload path.
4. Tests for: an attachment-only comment (empty `content`), a failed upload
   leaving no orphan row, and a comment whose attachment is missing still
   rendering its text.

Estimated client work once unblocked: one unit, one PR.

---

## Status

**Open.** Nothing in the client calls or assumes any of this today; PR #236
ships without the two controls and says so in its own evidence file. This
document is the handoff artefact — an interface agreed in conversation does not
exist.
