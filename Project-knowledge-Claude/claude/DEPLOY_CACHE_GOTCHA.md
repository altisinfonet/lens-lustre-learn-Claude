# Deploy stack + session record (2026-07-29 → 2026-07-31)

> Read this together with `PROJECT_MASTER_RECORD.md`. Where the two disagree about
> **how the web deploys**, THIS file is right — the master record's older text said
> Lovable, which the owner has explicitly retired.
>
> **Amended 2026-08-03:** two items below were superseded — the "deliver zips" line in §1
> (the assistant commits itself now, see the runbook) and the blank-profile item in §4
> (partly root-caused). Both are corrected in place and marked.

---

## 1. THE DEPLOY STACK (corrected 2026-07-30 by the owner)

**There is NO Lovable involvement any more.** Everything is owner-controlled:

```
GitHub main  ->  Cloudflare Pages (auto-build ~1-2 min)  ->  50mmretina.com
                 project: lens-lustre-learn-claude
                 CNAME 50mmretina.com -> lens-lustre-learn-claude.pages.dev (proxied)
                 Worker "seo-edge-injector" rewrites HTML (ORIGIN_HOST = the pages.dev)

Supabase (own project jtdtehuqtinjxropkkcn)  — DB, auth, storage, edge functions
Brevo — email.   Firebase Cloud Messaging — push.   R2 (cdn.50mmretina.com) — media.
```

- **Edge functions still do NOT auto-deploy from git.** Supabase dashboard →
  Edge Functions → function → Code → Deploy updates. (Unchanged, still the #1 gotcha.)
- **Migrations do NOT auto-apply.** Paste the SQL into Supabase → SQL Editor → Run
  (destructive-DDL confirm dialog is normal — click through, never "Run and enable RLS"),
  **or run them headlessly via the pg-meta platform API** — recipe in
  `NEXT_RELEASE_RUNBOOK.md`, "Traps added 2026-08-03".
- **The sandbox cannot `git push` — but it CAN commit.** *(Superseded 2026-08-02: do NOT
  deliver zips.)* Route A: browser `file_upload` into GitHub's Upload files page (exact
  bytes); Route B: CodeMirror splice for `.github/workflows/**`. Full recipes + traps:
  `NEXT_RELEASE_RUNBOOK.md` → "Committing from the sandbox". Zips are the last resort only
  if the browser bridge is unavailable.

## 2. THE IMMUTABLE-BUNDLE CACHE TRAP (cost hours on 2026-07-30)

Vite/Rollup here can change a hashed bundle's **content** without changing its
**filename** (dependency chunk renames don't always cascade into the entry hash).
Pages serves `/assets/*` as `immutable, max-age=1y`, so the edge and every browser keep
serving the old `index-<hash>.js`. Symptom: GitHub has the commit, Cloudflare shows a
green deploy, and the site still runs old code.

**Prevention, now in place:** `src/main.tsx` carries
`(window as any).__APP_BUILD = "YYYY-MM-DD-n"`. **Bump it on any release.** It must stay a
window side-effect — a bare `export const` gets tree-shaken and the hash does not change
(the first attempt failed exactly that way). Current marker as of 2026-08-03:
**`2026-08-03-07`**.

**If stale content is already at the edge:** Cloudflare dash → 50mmretina.com → Caching →
Configuration → **Purge Everything**.

**How to verify a deploy for real** (do this, don't trust "it deployed"):
fetch `https://50mmretina.com/?cb=<random>`, read the `index-*.js` filename, and check
feature strings inside the **route chunks** (`Friends-*.js`, `Feed-*.js`, `WallPosts-*.js`,
`AdminGallery-*.js`) — route code lives in lazy chunks, not the entry bundle.

## 3. SHIPPED AND LIVE-VERIFIED (2026-07-30 → 31)

**Feed — broadcast + never-repeat** (`get_broadcast_feed` RPC + `useFeedQuery` rewrite)
Every visible post is eligible: no 48-hour window, no ~370-post cap, no friends bias.
Order: unseen first, **fewest distinct viewers first**, then newest (fairness — equalises
reach). When unseen runs out it recycles least-recently-seen so the feed never ends.
No repeat within a scroll session; no same-author back-to-back. The old
`get_feed_candidates` + `rank-feed` are left in place but **no longer called**.

**Feed — a fast scroll no longer burns a photo** (migration `20260731140000`)
A genuine `view` (≥2s) retires a post permanently. A **first `skip` (0.5–2s) lets it
return once, after a 12-hour cooldown**; a **second skip retires it**. Invisible to users
— the owner explicitly rejected any "You're all caught up" divider or "seen" badge.

**Stories — public + view counts** (migration `20260731000000`)
`get_feed_stories_bar()` no longer filters to follows; every user with a live story
appears for everyone, ordered purely newest-first (the official-account pin was removed
per the owner's "last update first"). New `get_my_story_view_counts()` returns **counts
only** — viewer identities are not retrievable through it by construction.

**Push notifications — the missing plumbing built**
`src/lib/native/push.ts` was **rewritten to the `window.Capacitor` runtime-global pattern**
(the `authDeepLink.ts` pattern). CRITICAL: `@capacitor/*` packages are **not in
package.json** — they are installed only in the Android CI job — so a static import breaks
the WEB build. That is why nothing could ever import push.ts before.
New `PushNotificationsGate.tsx` registers the device on login; `useAuth.signOut()`
unregisters. DB trigger `trg_push_on_notification` on `user_notifications` calls the
`send-push` edge function through `pg_net` with the `x-internal-secret` header (async, so a
push failure can never block a notification insert). Config row lives in `public.push_config`
(RLS: service_role only). Per-user `push_*` columns added to `notification_preferences`.
**Rollback = one line:** `DROP TRIGGER trg_push_on_notification ON public.user_notifications;`

**Notification links fixed** — comment/reaction notifications open `/post/<id>` (the DB
already stored `post_id` in `reference_id`); friend requests open `/friends`, which lands on
the new Awaited tab. Routing moved to `src/lib/notificationLinks.ts` so the bell and the
push-tap handler share one rule set. Photo-comment and comment-reply still open `/discover`
— there is no route that opens a single gallery photo by id.

**Social** — "Add friend" button on Suggested feed posts (sends request + auto-follows);
`/friends` split into **Awaited** (received, accept one by one, first tab) and **Pending**
(sent). "Awaited" is English-only in all 7 languages.

**"Photo of the Day" → "The Curated Wall"** — text only, 12 code spots + the
`notify_potd_featured` SQL + the `ask-anything` edge function redeployed. Table
`photo_of_the_day`, type `potd_featured`, query keys and the admin URL tab key `potd`
are all UNCHANGED on purpose.

**Admin Gallery** — category is now a free-text field with the 20 built-ins plus any
already-used custom names as suggestions. Custom names appear on the home page filter bar
automatically (Index.tsx derives it from categories present on visible images, and `t()`
falls back to the raw value). Caveat: custom names show in English in every language.

**Profile photo is now genuinely mandatory** — the onboarding gate in `Layout.tsx` checked
`onboarding_completed`, `user_type` and `custom_url` but **NOT `avatar_url`**, so accounts
completed back when the photo was optional were never asked again. Now a missing photo
re-opens the unskippable modal on the next login/app open. Measured effect of the earlier
28-Jul work: no-photo accounts went from ~90% to **8 of 74 overall, 5 of 58 in the last
7 days**. The residual are register-and-never-return users; only signup-time capture or
hiding incomplete profiles would reach zero.
*(See also `PROFILE_PHOTO_POLICY.md` — and the 2026-08-03 follow-up: Google now 503s all
hotlinked OAuth pictures; migration `20260803210000` stopped storing them and blanked the
27 affected rows.)*

**Cache-buster bug fixed** — the legacy `runCacheBuster` fired `location.replace()` with
`?cb=<n>` **while React was mounting**, which was the "blank on first visit, fine after
refresh" report, and left `?cb=2` stuck in the address bar forever. First-time browsers
(localVersion 0) now record the version and skip the reload entirely — they have nothing
stale to bust. `stripCacheBusterParam()` cleans a leftover param with `history.replaceState`.
Reproduced and re-verified with a simulated first visit.

**Footer** — Google Play badge (inline SVG, links to the store listing, fires a conversion
event) sits under the social icons; the duplicated `home.rights` copyright line under the
newsletter was removed (the bottom bar keeps it).

**Add friend duplicate-key bug (regression, found by owner screenshots)** — the button was
shown on any Suggested post, but "suggested" stays true for someone you already requested,
so tapping inserted a duplicate `friendships` row and the raw Postgres error
`duplicate key value violates unique constraint "friendships_requester_id_addressee_id_key"`
was displayed. Fixed in three layers: the feed now resolves friendship state for every post
author in one query and the button only shows for `friend_state === "none"`; **unknown state
hides the button** (realtime-inserted posts and localStorage-cached posts carry no state —
treating unknown as "none" is what let it through the second time); and a 23505 is caught and
shown as "Friend request already sent". Raw DB text can no longer reach a user.

## 4. OPEN / UNRESOLVED

- **Blank page on the PROFILE tab (app) — UPDATED 2026-08-03, partly root-caused.** Current
  code renders all six suspect routes fine at 412px (0 console errors). Three real
  contributors were found and fixed that day: **27/81 members' avatars were Google hotlinks
  returning HTTP 503** (migration `20260803210000` — server-side, benefits all installed
  builds), `/photos` genuinely rendered a blank body logged-out (now redirects to `/login`
  via RequireAuth, PR #56), and the owner's handset was on an old installed build at
  **29.8 KB/s**. Final verdict deferred to build **1044 on-device** — if a page is still
  blank there, get the PAGE NAME. The 2026-07-28 `lazyRetry` + `AppErrorBoundary` fix is in
  place on all lazy routes. **Still: do not ship a speculative fix for this.**
- **AGP 9 upgrade** — see `NEXT_RELEASE_RUNBOOK.md`. Deliberately deferred.
- **App vs Web indicator in Admin Users** — designed, not built. `activity_logs` already
  stores `user_agent` on every login, and `push_tokens.platform` identifies app users who
  allowed notifications. Clean approach: record `app`/`web` explicitly at login (the app can
  self-identify with zero user interaction) plus a `last_platform` column on profiles.
  **Google Analytics cannot do this** — it sees both as "web" without a custom marker, and
  it cannot show a per-user value in the admin list.
- **Photo/comment-reply notifications** can't deep-link (no single-photo route).
- **feed_events has no retention job.** IMPORTANT: naive time-based deletion is WRONG — it
  would make old posts look unseen and resurface them. Correct design when it matters: split
  the permanent "who saw what" ledger (composite PK, ~40 bytes/row) from the verbose
  analytics log, and prune by **post age tied to feed eligibility**, never by event age.
  Irrelevant at current scale (74 users × 103 posts ≈ 7.4k rows max).

## 5. PLATFORM SIZE (measured 2026-07-31)

103 public posts (46 in the last 7 days), 74 profiles, 233 reactions, 48 comments.
(By 2026-08-03: ~81 members.)
**The feed's real constraint is supply, not ranking** — ~10 screenfuls of content total, and
only ~6 new photos a day. The biggest available lever is pulling competition entries and
Curated Wall photos into the feed, not further algorithm tuning.
