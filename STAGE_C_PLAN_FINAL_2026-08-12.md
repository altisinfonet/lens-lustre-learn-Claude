# Stage C — final implementation plan

**Date:** 2026-08-12 · **Supersedes** `STAGE_C_PLAN_2026-08-12.md`
**Status:** FINAL. Implementation follows this document. B2 stays untouched.

Approved and closed: drafts, 7-day expiry, safe cleanup lifecycle, explicit-Save
persistence, atomic publish, 1–5 picker with `n/5`, `Drafts (n)`, web + app.

---

## 0. Correction carried into this plan

The earlier draft schema had `tagged_user_ids uuid[]`. **Wrong.** A tag is not a
user id — `PendingTag` is `{taggedUserId, taggedUserName, taggedUserAvatar,
photoIndex, xPosition, yPosition}`. Storing only ids loses *which photo* and
*where on it* each person was tagged, so a resumed draft would silently drop
tag positions. Now `pending_tags jsonb`.

---

## 1. Schema

### `public.post_drafts`

```
id                uuid PK default gen_random_uuid()
user_id           uuid NOT NULL references auth.users on delete cascade
content           text        NOT NULL DEFAULT ''
image_url         text
image_urls        text[]      NOT NULL DEFAULT '{}'
thumbnail_urls    text[]
privacy           text        NOT NULL DEFAULT 'public'
indexing_disabled boolean     NOT NULL DEFAULT false
categories        text[]      NOT NULL DEFAULT '{}'
pending_tags      jsonb       NOT NULL DEFAULT '[]'
scheduled_for     timestamptz
expiring_at       timestamptz                      -- phase-1 cleanup marker
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

`CHECK (cardinality(categories) <= 5)` — max enforced, **minimum deliberately
not**: a draft is unfinished by definition.

`idx_post_drafts_user` on `(user_id, updated_at DESC)` — the drafts list query.
`idx_post_drafts_expiring` on `(updated_at)` where `expiring_at IS NULL` — the
cleanup scan.

**RLS — own rows only.** Four policies, all `auth.uid() = user_id`. No admin
read path: an unpublished draft is private work.

**Slug validation** via `BEFORE INSERT OR UPDATE` trigger reusing the same
taxonomy check as posts. Invalid slug rejected; count-of-zero accepted.

**20-draft cap** enforced in the same trigger. Beyond that, drafts become an
unbounded upload channel.

---

## 2. Draft lifecycle

```
compose (nothing stored)
    │  member presses Save
    ▼
draft row created + images uploaded          ← FIRST persistence point
    │  autosave keeps it current
    ▼
resume ──► edit ──► Save … ──► Publish
                                  │
                                  ▼
                         publish_post_draft()
```

**Nothing exists before Save.** No row, no upload. This is what stops every
abandoned compose session from costing storage and cluttering the drafts list.

**Autosave** only ever *updates an existing* draft — it never creates one.
Debounced at 3 s after the last change, and on modal close. If the row has been
deleted elsewhere, autosave stops silently rather than resurrecting it.

**Resume** loads content, images, privacy, categories, `pending_tags` and
`scheduled_for` back into the composer at step 1, with tag coordinates intact.

---

## 3. Storage lifecycle and cleanup

Images upload on Save via the existing `storageUpload.ts`, which routes to S3
when enabled and Supabase storage otherwise. Draft images live in the same
`post-images` bucket — **publishing must not move or re-upload them**, the post
simply references the same URLs.

### Cleanup — three phases, retry-safe

```
1. MARK     expiring_at := now()  for drafts idle > 7 days
              → row immediately stops appearing and stops being resumable
2. PURGE    delete the storage objects for marked rows
3. REAP     delete rows whose objects are gone
```

Why not the two-phase order originally proposed: images-then-row leaves, on a
failed row delete, **a visible draft pointing at images that no longer exist** —
member-visible data loss dressed as a working draft. Marking first makes every
intermediate state consistent.

**Idempotent by construction:** each phase is a no-op if already done. A crash
anywhere is picked up by the next run. Storage delete failures leave the row
marked and are retried; the row is only reaped once its objects are confirmed
gone.

**Publishing deletes the row only** — never the objects. Covered by a test.

Implemented as edge function `prune-post-drafts`, reusing the existing
`purge-s3-orphans` / `detect-orphan-files` / `s3-delete` machinery rather than a
second parallel orphan story. Daily `pg_cron`, following the shape already used
by `prune_activity_minutes`.

---

## 4. Publish transaction

`supabase-js cannot span a transaction` — proved during the Phase B architecture
work, and the reason we chose the array over a join table. So publish is a
`SECURITY DEFINER` RPC:

```
publish_post_draft(_draft_id uuid) RETURNS uuid
  ├ load the draft, assert auth.uid() owns it
  ├ INSERT INTO posts (…, categories, post_kind='member')
  ├ INSERT INTO post_tags  ← wrapped in EXCEPTION block: a bad tag must never
  │                          cost the member their post (today's behaviour)
  └ DELETE the draft row   ← same transaction
```

Either the post exists and the draft is gone, or neither happened. No state
where the same content is both published and sitting in Drafts.

**The direct (non-draft) posting path is unchanged.** It is live, proven and
working; rewriting it for symmetry would risk a working path for no gain.

---

## 5. Category picker state machine

```
        ┌──────────── selected = 0 ─────────────┐
        │  all 46 enabled · "Select 1–5" · 0/5  │
        │  Post DISABLED                        │
        └───────────────┬───────────────────────┘
                    tap │  ▲ untap
                        ▼  │
        ┌──────────── 1 ≤ selected ≤ 4 ─────────┐
        │  all 46 enabled · n/5                 │
        │  Post ENABLED                         │
        └───────────────┬───────────────────────┘
                    tap │  ▲ untap  ← re-enables all 46 immediately
                        ▼  │
        ┌──────────── selected = 5 ─────────────┐
        │  the other 41 DISABLED, non-responsive│
        │  the chosen 5 remain tappable to REMOVE│
        │  "5/5" · Post ENABLED                 │
        └───────────────────────────────────────┘
```

The chosen 5 must stay tappable — if all 46 went dead at 5 there would be no
exit and the first five choices would be permanent.

`Post` / `Share` is disabled at zero with the reason shown, so the requirement is
never discovered at submit time. B2 later enforces the same rule in the database
as a backstop, not as the primary gate.

---

## 6. Failure and retry

| Failure | Behaviour |
|---|---|
| Image upload fails during Save | Draft not created; member keeps their work in the open composer and is told |
| Autosave fails | Silent retry on next change; never blocks typing |
| Autosave finds the row deleted | Stops; does not recreate |
| Publish RPC fails | Nothing committed; draft intact; member can retry |
| Tag insert fails inside publish | Post survives, tags skipped, logged — today's behaviour preserved |
| Storage delete fails in cleanup | Row stays marked, retried next run |
| Cron run overlaps previous | Phases are idempotent; safe |

---

## 7. Files, tables, functions

**Database (new migration)**
`post_drafts` table · RLS ×4 · slug + cap trigger · `publish_post_draft()` RPC ·
`mark_expiring_post_drafts()` · `pg_cron` daily job

**Edge function (new)** `supabase/functions/prune-post-drafts/index.ts`

**Web — new**
`src/components/post/CreatePostModal.tsx` · `CategoryChips.tsx` (shared with app)
· `PostSettingsStep.tsx` · `DraftsList.tsx` · `src/hooks/feed/usePostDrafts.ts`

**Web — changed**
`WallPosts.tsx` (inline box becomes trigger; `categories` in both inserts) ·
`useScheduledPosts.ts` (pass categories) · `postCategoriesPhaseB.test.ts`
(tripwire flips)

**App — new**
`src/components/post/native/GalleryPicker.tsx` · `NewPostDetails.tsx` ·
Android back-button and safe-area handling

**Native:** media-library plugin · `READ_MEDIA_IMAGES` (13+) /
`READ_EXTERNAL_STORAGE` below · paged thumbnails · fall back to the OS picker if
permission is refused.

**Untouched:** hashtag parsing · `post_tags` people-tagging behaviour · the feed
RPC and its fairness ordering · the category strip (Stage D) · `POST-CAT-002`.

---

## 8. Dependency

The native gallery ships only in a new AAB — **which the owner builds and
uploads**. That is the same Android release B2's version gate needs, so one build
carries Stage C, the gallery and the gate together.
