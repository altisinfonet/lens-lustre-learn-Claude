# Stage C — Create/Post experience, web and app

**Date:** 2026-08-12
**Status:** PLAN ONLY. Nothing built, nothing applied, nothing deployed.
**Depends on:** Stage B1 (live on production since 2026-08-12)
**Blocks:** Stage B2 (`POST-CAT-002`), Stage D (category strip)

---

## 1. Decisions, as approved

| # | Decision | Answer |
|---|---|---|
| 1 | Category UI | **Option B** — chips inline on the settings/details screen, both surfaces |
| 2 | At 5 selected | The other 41 grey out and stop responding. **The chosen 5 stay tappable** so one can be swapped |
| 3 | Toolbar | Photos and tag-people only. No location, feeling, audio, poll, prompt, AI label |
| 4 | `Save` | **Save draft.** Supersedes the earlier "Save opens scheduling" answer |
| 5 | Drafts | **On both web and app**, photos uploaded on save, **cleanup after 7 days** |
| 6 | Web presentation | Modal on desktop, full-screen on phones |
| 7 | Web steps | 3: compose → media → post settings |
| 8 | App steps | 2: photo picker → details → Share |
| 9 | App photo picker | **In-app gallery grid** (native) |
| 10 | STORY / REEL / LIVE | Out of scope, ignored |

---

## 2. The two consequences worth stating plainly

**Stage C is no longer client-only.** Drafts need a table, so this stage carries a
migration and goes through the same preflight-and-audit gate B1 did.

**Stage C now requires a new Android build.** The in-app gallery grid is native.
That is the *same* dependency Stage B2's version gate already has, so **one AAB
carries Stage C, the gallery, and the minimum-version gate together**. It does
not add a release, it shares one.

A browser cannot enumerate a photo library. So the gallery grid is app-only *by
physics, not by choice* — web keeps the OS file dialog. This is the one place
web and app are permanently different, and no design decision can change it.

---

## 3. Database

### 3a. New table `public.post_drafts`

```
id                uuid PK default gen_random_uuid()
user_id           uuid NOT NULL
content           text NOT NULL DEFAULT ''
image_url         text
image_urls        text[] NOT NULL DEFAULT '{}'
thumbnail_urls    text[]
privacy           text NOT NULL DEFAULT 'public'
indexing_disabled boolean NOT NULL DEFAULT false
categories        text[] NOT NULL DEFAULT '{}'
tagged_user_ids   uuid[] NOT NULL DEFAULT '{}'
scheduled_for     timestamptz            -- carried through if set before saving
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

**RLS: own rows only** — four policies, `auth.uid() = user_id`, for select,
insert, update and delete. No admin read path: a draft is unpublished private
work and nobody else needs to see it.

**Validation is deliberately weaker than for a post.** A draft is by definition
unfinished:

* category **slugs are validated** (same taxonomy check as posts) — a draft must
  never hold a slug that cannot exist
* the **1–5 minimum is NOT enforced** — you must be able to save a draft with
  zero categories chosen so far
* the **max of 5 IS enforced** — there is no reason to allow six

### 3b. Cleanup after 7 days

Two halves, because a row and its images live in different places.

1. **Rows** — a `pg_cron` job, following the same shape as
   `prune_activity_minutes` and the notification-retention job already in this
   repo, deleting drafts whose `updated_at` is older than 7 days.
2. **Images** — deleting the row does not delete the file. Storage is routed
   dynamically: S3 when enabled, Supabase storage otherwise
   (`src/lib/storageUpload.ts`). This repo already has
   `purge-s3-orphans`, `detect-orphan-files` and `s3-delete` — **the draft
   cleanup extends that existing machinery rather than inventing a parallel one**,
   so there is one orphan story, not two.

⚠ **Ordering matters.** Images must be removed *before or with* the row, never
after — once the row is gone there is no record of which files to delete, and
they become permanent orphans. The job collects the URLs, deletes the objects,
then deletes the rows, in that order, and tolerates a partial failure by leaving
the row for the next run.

⚠ **Publishing a draft must NOT delete its images** — the published post
references the very same URLs. The publish path deletes the draft row only.

---

## 4. Web

**New**
* `src/components/post/CreatePostModal.tsx` — 3-step shell. `Dialog` on desktop,
  full-screen on phones via the existing `useIsMobile()`.
* `src/components/post/CategoryChips.tsx` — the inline chip grid. Shared with the
  app. Owns the 1–5 rule: at 5, unselected chips are disabled and non-responsive;
  selected chips stay live so a member can swap one.
* `src/components/post/PostSettingsStep.tsx` — preview, `Post audience ›`,
  `Scheduling options ›`, the chips, then `Save draft` / `Post`.
* `src/hooks/feed/usePostDrafts.ts` — list, create, update, delete, publish.

**Changed**
* `src/components/WallPosts.tsx` — the inline "What's on your mind" box becomes
  the modal trigger. `createPost` carries `categories` in **both** inserts, the
  immediate `posts` insert and the `scheduled_posts` branch. Same statement, no
  extra round trip — the atomicity requirement from the original ruling.
* `src/hooks/feed/useScheduledPosts.ts` — pass `categories` through (the optional
  field already exists from B1).

**Drafts entry point — a decision I am making, flag it if wrong:** a `Drafts (n)`
link in the composer's step 1 header, visible only when the member has any.
Resuming loads the draft back into the modal at step 1.

---

## 5. App

**Screen 1 — picker.** `✕` / `New post` / `Next`, large preview, `Recents`,
`Drafts` tab, multi-select, device grid.

**Screen 2 — details.** `←` / `New post`, thumbnail, caption, `Tag people ›`,
the same `CategoryChips`, `Share`.

**Native work required**
* a Capacitor plugin to read the device media library
* `READ_MEDIA_IMAGES` on Android 13+, `READ_EXTERNAL_STORAGE` below it
* thumbnail paging — a member with 20,000 photos must not load them all
* graceful denial: if permission is refused, fall back to the OS picker rather
  than showing an empty grid

**App-only behaviours**
* the Android hardware **back** button steps back through the flow and closes the
  composer — it must never drop the member out of the app mid-post
* safe-area insets so the header clears the status bar and `Share` clears the
  gesture bar

---

## 6. Not touched

Hashtag parsing and rendering. `post_tags` people-tagging with coordinates. The
feed RPC and its fairness ordering. The category strip (Stage D). `POST-CAT-002`,
which stays inactive until B2.

---

## 7. Tests

* chips: select 1, select 5, attempt a 6th is refused, deselect at 5 then pick
  another, unknown slug never renders
* both insert paths carry categories — immediate and scheduled
* `Post` / `Share` disabled at zero categories, with the reason shown
* draft round trip: save → reload → resume → publish, categories intact
* draft cleanup: a row older than 7 days goes, its images go **first**, a
  published draft's images survive
* RLS: a member cannot read, update or delete another member's draft — proved by
  row count, not by absence of error, per the B1 lesson
* the `postCategoriesPhaseB.test.ts` tripwire **flips**: it currently asserts the
  composer sends no categories, and will assert it sends 1–5 and blocks at 0

---

## 8. Sequence and risks

```
Stage C  ─┬─ migration (post_drafts + cron)      ← needs its own audit
          ├─ web deploy
          └─ new AAB  ──────────────┐
                                    ├─ also carries B2's minimum-version gate
Stage B2 ─ activate POST-CAT-002 ───┘   after adoption is measured
Stage D  ─ category strip
```

| Risk | Severity | Handling |
|---|---|---|
| Draft images orphaned in storage | Medium | Delete objects before rows; reuse existing purge machinery; tolerate partial failure |
| Publishing a draft deletes its images | High if wrong | Publish deletes the row only; covered by a test |
| Gallery permission refused | Low | Fall back to the OS picker |
| Huge photo libraries | Medium | Paged thumbnails, never load-all |
| 7 days is short | Low | Member-visible: show the expiry date on each draft so nobody is surprised |
| Stage C slips → B2 waits | Accepted | B2 is gated on Stage C by design |

---

## 9. What I need approved

1. This plan.
2. The `post_drafts` schema in §3a.
3. The 7-day cleanup design in §3b, in particular deleting images before rows.
4. The drafts entry point in §4.

Then: build → full suite → show the diff and the migration → your approval →
apply and deploy.
