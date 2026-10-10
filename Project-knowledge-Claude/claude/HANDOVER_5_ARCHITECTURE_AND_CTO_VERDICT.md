# Architecture and CTO verdict

Condensed from the full forensic audit of 2026-08-13 (commit `962570d`), with
every item that has since been fixed marked as such. The long version, with
file-and-line evidence for every claim, is in the claude.ai project at
`claude/ARCHITECTURE_AUDIT_2026-08-13.md`.

**Read this before anyone proposes a rewrite.**

---

## The stack, as it actually is

| Layer | What it is |
|---|---|
| Frontend | React 18.3.1 · TypeScript 5.8.3 · Vite 7.3.6 (SWC) |
| UI | Tailwind 3.4.17 + Radix UI (26 primitives, shadcn-style wrappers) |
| Server cache | TanStack Query 5.62.0 (exact pin) |
| Routing | react-router-dom 6.30.1 · `BrowserRouter` · 50 pages, **all 50 lazy** |
| Backend | Supabase Postgres + Auth + RLS + Realtime · ~68 Deno edge functions |
| Storage | Cloudflare R2 via browser presigned PUT, behind `cdn.50mmretina.com` |
| Web hosting | Cloudflare Pages + 7 Pages Functions (SEO `<head>` injection) + 1 Worker |
| Mobile | **Capacitor, bundled** — `webDir: 'dist'`, **no `server.url`** |
| iOS | **Does not exist.** No `ios/`, no `@capacitor/ios`, no workflow. |
| Native code | **Zero hand-written.** No `.java`, `.kt`, `.swift`, `.gradle` in the repo. |

### It is not a PWA wrapper, and that is provable

`capacitor.config.ts` sets `webDir: 'dist'` and does **not** set `server.url`.
The web build is compiled into the APK, and CI asserts it twice — that the
assets exist at `android/app/src/main/assets/public`, and that
`assets/public/index.html` is inside the APK binary.

Eight native plugins are genuinely wired, not decorative: FCM push with
server-side token registration, OAuth through the system browser returning via
an `app.fiftymmretina://` deep link, Google Play in-app updates, native
multi-select gallery, native share sheet with file attachment, Filesystem writes
to Documents, hardware Back handling, and app lifecycle events.

### Web ↔ mobile

```
WEB                                   ANDROID
Cloudflare Pages                      com.fiftymmretina.app
  └─ React SPA (dist/)                  └─ Capacitor WebView
       ├─ supabase-js → Postgres             └─ assets/public/  ← THE SAME dist/
       ├─ supabase-js → Realtime                  (byte-identical build)
       ├─ invoke      → edge functions       └─ bridge → 8 native plugins
       └─ presigned PUT → R2 → CDN      └─ FCM → Firebase → send-push-* fn
  └─ SEO Pages Functions (web only)
```

**~100% of the application layer is shared.** One `dist/`, one React tree, one
Supabase client, one storage path. That is this architecture's strongest
property, and it is exactly what a migration would destroy.

---

## Verdict

> **CURRENT STACK:** React + Capacitor, bundled, Android-only, zero native code.
>
> **VERDICT: YELLOW** — correct foundation, specific and identified
> architectural work required before scale.
>
> **SHOULD I MIGRATE NOW? NO.**

### Why not — ten reasons

1. The top five bottlenecks are all in **Postgres and image delivery**. A
   migration fixes none of them and delays fixing them by a year.
2. The **web product is load-bearing** — SEO, journal, courses, competitions,
   certificates, admin. Every alternative means keeping the React web app *and*
   building a second thing.
3. ~100% code sharing today. React Native drops it to ~60%; Flutter to ~0%.
4. Capacitor is not what made the feed slow. **No windowing** and an **eager
   full-resolution image fetch** were — both now fixed, in days, not months.
5. The existing native integration is real: FCM, deep-link OAuth, Play in-app
   updates, native picker, native share. Months of work to rebuild.
6. Already shipping to Play (versionCode 1073+ in production). A migration
   restarts distribution.
7. Instagram-class *feel* on a photo feed is achievable in a WebView. It needs
   recycling and correct image sizing — nothing framework-level.
8. Video is the one place a WebView genuinely loses, and there is **zero video**
   here plus a standing **NO REELS, NO LIVE** rule. Nothing to migrate for.
9. The build system is already the fragile part. A second toolchain makes it
   worse.
10. Fixes ≈ 4–6 weeks. Migration ≈ 6–18 months — and most of the fixes would
    still be needed afterwards.

### Scored against the alternatives

| | React + Capacitor *(current)* | React Native | Flutter | Fully native |
|---|---|---|---|---|
| Code sharing web↔mobile | **~100%** | ~60–70% | ~0% | 0% |
| Web + SEO | **Native — it IS the web app** | separate build | not competitive | separate |
| Image-heavy feed | weakest point, fixable | good | good | best |
| Video | poor | good | good | best |
| Trees to maintain | **1** | 2 | 2 | 3 |
| Score for an Instagram-like platform | 7 / 10 | 8 / 10 | 8 / 10 | 9.5 / 10 |
| **Score for *this* situation** | **8.5 / 10** | 5 / 10 | 3.5 / 10 | 2 / 10 |

The gap between those last two rows is the entire decision. The alternatives win
on raw capability and lose badly here, because they double the maintenance
burden to fix problems that are 80% in Postgres.

---

## What fails first, in order

1. **Database — first to fail, ~10k–50k users / ~100k posts.** Not Supabase the
   product; the feed RPC. A `count(DISTINCT)` LATERAL over *every* visible post
   to return 10, plus a non-sargable privacy filter that forces a sequential
   scan, plus an exclude-id array that grows without bound. Feed cost is
   O(total_posts) per page view. ⚠ **Measure before fixing** — see the backlog.
2. **Realtime — same scale, different reason.** *Substantially reduced:* the
   `feed-live` channel went from 9 unfiltered bindings to 5, dropping two entire
   high-frequency tables out of the broadcast set. Server-side `filter:` on what
   remains is still worth doing.
3. **Client / WebView — was failing today, now fixed.** No windowing plus an
   eager full-res decode was an out-of-memory crash in a long scroll on a
   mid-range Android at the *current* user count. Both shipped.
4. **CDN egress — a cost problem, not an outage.** Serving 2560px originals to
   phones is a ~6–8× bandwidth multiplier. The measured saving when transforms
   were briefly active was 89%. This is the derivative pipeline, still open.
5. **Image processing — a UX problem that becomes a support problem.**
   Main-thread compression and non-resumable uploads. Still open.
6. **Notifications / edge functions / API — comfortable to ~1M** once the above
   are handled.

**Honest scale summary.** 100k users: reachable with the fixes listed. 1M: also
reachable, but the feed must become fan-out-on-write rather than
computed-per-request, with a read replica. 10M: a different backend and a
different company — and picking Flutter today would not change that.

---

## Already closed since the audit

| Audit item | Status |
|---|---|
| RPC returns no author identity — root cause of "names showing as ?" | **Fixed in production.** `get_broadcast_feed` now returns `author_name`, `author_avatar`, `thumbnail_urls`, `categories`. |
| `COALESCE(_exclude_ids, '{}')` guard reverted | **Restored** in the same migration. |
| No virtualization, no `maxPages` | **Fixed.** `FeedCardWindow` unmounts cards ~2 screens away; `maxPages: 5`. |
| `loading="eager"` on a 14.7 MB backdrop; LQIP falling through to the original | **Fixed.** |
| Realtime fans every write to every client | **Halved.** 9 bindings → 5; counters now server-absolute, one writer per field. |
| Capacitor versions unpinned | **Pinned**, with a CI step that fails the build if a pin did not take. |
| Vacuous guard test pinned to a superseded migration | **Fixed** — tests now resolve the newest definition at run time. |
| Three dead files importing `@capacitor/*` | **Deleted.** |

⚠ **One audit recommendation was wrong and the owner corrected it.** The audit
said to commit `android/`. It should not be committed — determinism comes from
**pinned versions**, not from checking generated output into the repository. CI
regenerates it every build. Do not re-open this.

---

## The five-year recommendation

Stay on React + Capacitor.

- **Now:** finish the database and image-delivery work in
  `status-done-and-remaining.md`. That is where product quality actually lives.
- **Then:** add **iOS** through the same Capacitor project — once the feed is
  fast, it costs one workflow rather than a codebase. iOS would otherwise
  inherit every problem above.
- **Around ~500k users:** move the feed from computed-per-request to
  **fan-out-on-write** (a `feed_items` table filled by a worker). Every social
  platform makes this change eventually, and it is independent of the client
  stack.
- **If vertical video ever becomes core strategy:** build **that one screen**
  natively as a Capacitor plugin. Do not migrate the app. A WebView renders a
  video scroll-feed badly, and that is the *only* screen where it is true.

## What not to waste time changing

React → React Native or Flutter · the Radix + Tailwind UI kit · TanStack Query ·
Supabase → self-hosted Postgres · R8 full mode (deferred deliberately; stay
deferred) · route code-splitting (already 50/50 lazy with better stale-chunk
healing than most production apps) · the Cloudflare Pages SEO layer · adding
iOS before the feed work is done.

---

**The line to remember from the audit:**

> You did not pick the wrong ship. You were sailing it with the anchor down.
> Every genuinely serious problem is a query, an index, an `<img>` attribute, or
> a missing `filter:` — not a framework.
