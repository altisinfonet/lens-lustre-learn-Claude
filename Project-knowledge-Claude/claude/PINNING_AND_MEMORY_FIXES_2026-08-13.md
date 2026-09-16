# Capacitor pinning + the two memory fixes — 2026-08-13

`origin/main` = `0dd6620`. Android build **SUCCESS** (all 36 steps).
**The feed migration is pushed but NOT applied.** See §5.

---

## 1. The pin caught a live time bomb, one build after it was introduced

The Android workflow installed eleven `@capacitor/*` packages with **no version at
all**, and `android/` is generated fresh by `cap add android` and never committed —
so the entire native layer floated. Whatever npm published that morning went into
the Play AAB with no PR, no diff, no review.

Pinned to exactly what CI was already resolving (Capacitor 8.5.0 line), verified
as a mutually compatible set with `npm install --strict-peer-deps`, plus a new
step that re-reads the installed versions and **fails the build if the pin did not
take** — a pin that silently floats is worse than none.

**The very next build failed:**

```
[fatal] The Capacitor CLI requires NodeJS >=22.0.0
```

`@capacitor/cli` had raised its Node floor. The workflow was on Node 20.

⚠ **The pin did not cause this — it revealed it.** The install was previously
unpinned and always took the newest CLI, which is the same 8.5.0 the pin names.
That build would have failed identically with no pin at all. The difference is
that the cause is now a version number written down in the workflow instead of
"what day is it".

Fixed by moving to Node 22 (Vite 7 accepts `^20.19.0 || >=22.12.0`, vitest `>=22`).
Build green again.

**This is the argument for pinning, made by the repository rather than by anyone's
opinion: a floating dependency broke the Android build of a live app with no code
change behind it.**

### Why NOT package.json + lockfile

Tried it first. Regenerating the lockfile against this repo's caret ranges pulled
in **414 new packages, removed 122, changed 193** — a mass upgrade of the whole
dependency tree of a live site, riding along with a Capacitor pin. Reverted.
That upgrade deserves its own change, its own review and its own build. Pinning in
the workflow buys the determinism today for a four-line diff and touches nothing
the website ships.

---

## 2. The 14.7 MB backdrop

`PostMedia.tsx`'s LQIP expression ended `: src`. With no stored thumbnail the
blurred decorative layer fetched the **2560px original**, `loading="eager"`,
ignoring the viewport — roughly **14.7 MB of decoded bitmap per card**, to paint a
layer that is `scale-125 blur-2xl` with `imageRendering: pixelated`.

Fourteen megabytes spent on pixels deliberately destroyed before anyone sees them.

Three common paths hit it, so it was not an edge case: realtime-inserted posts
(never get `thumbnail_urls`), thumbnail/image array length mismatches, and **every
scheduled post** (`scheduled_posts` has no thumbnail column at all).

Now: thumbnail or LQIP if one exists, otherwise **no backdrop element at all**,
plus `fetchPriority="low"` so decoration stops competing with the real photo.

**Caught while doing it:** moving the intrinsic-size measurement onto the sharp
layer alone was a real regression — that layer is `loading="lazy"`, so legacy
photos would reflow late. Both layers report it now; the handler already took the
first answer and ignored the rest, so it is idempotent by construction.

---

## 3. `maxPages: 5`

React Query retained every page forever; ten scroll-loads meant 100 live
`PostCard`s, never released. Five pages is 50 posts — more than fits on any
screen, so nothing visible is dropped.

⚠ **This is not virtualization and the code comment says so.** It bounds pages
RETAINED, not cards MOUNTED. Windowing is still outstanding. It also does not
touch the server side: `excludeByPageRef` still grows without limit and page 20
still uploads 200 UUIDs — that is keyset pagination's job.

---

## 4. Three dead modules deleted

`src/lib/native/{share,camera,platform}.ts` — zero importers, and each statically
imports `@capacitor/core`, which is not installed for the web build. A loaded gun:
harmless only while nobody imported them. Deleted via GitHub's per-file delete
flow (the upload page cannot express a deletion).

---

## 5. ⚠ STILL NOT APPLIED: the feed author-identity migration

`supabase/migrations/20260813120000_feed_author_identity.sql` is on `main` and
tested against a real Postgres 16, **but has not been run against production.**
Claude is blocked from the Supabase dashboard and the repo has no Supabase secret
or migration workflow, so there is no path for it to apply this. It needs the
owner, and it is about 30 seconds of work.

Until it runs, the client half is inert — `useFeedQuery` detects the new columns
from the row shape (`"author_name" in row`), not a version flag, so the two halves
ship in either order with no flag day.

Rollback: `supabase/rollback/20260813120000_feed_author_identity_ROLLBACK.sql`,
round-trip tested. **Do NOT** try re-running `20260812070000_post_categories.sql`
to undo it — that fails with the same return-type error, proven.

---

## Gates

Typecheck clean · **1,309 tests pass** · production build clean · security gate
PASS (0 critical, 0 high) · Android build SUCCESS, 36/36 steps.

## Transport notes

Two corrupted chunks caught by the per-group rolling hash this session (that is
now five times). One GitHub commit click swallowed by the documented
first-input-after-navigation trap. Every file byte-verified against `origin/main`
afterwards; `git diff HEAD origin/main` empty.
