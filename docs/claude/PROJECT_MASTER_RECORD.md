# 50mm Retina World — Project Master Record

> **Purpose:** single cold-start reference. Anyone (human or AI) should be able to read this
> and continue work **without asking a question.** Keep it updated (see §15).
>
> **⚠ READ `HANDOFF_2026-08-06.md` FIRST, THEN `START_HERE.md`.** The handoff carries the
> live state, the paused task and the decisions waiting on the owner. START_HERE carries
> current traps and standing rules. This file remains the deep record: accounts, stack,
> backend detail, gotcha catalogue (§12) and the session log (§15). **Where they disagree,
> the handoff is newest and right.**
>
> **Also read `SUPERSEDED_DOCS.md`** — six project docs are stale and one
> (`PROFILE_PHOTO_GATE_IMPACT.md`) is actively wrong.
>
> **Security rule for this file (never break it):** document *where* every secret lives and
> *what it is for* — **never** paste actual passwords, tokens, API keys, or keystore
> passwords here. This file has none.
>
> **Honesty note:** facts below were read directly from the repo or measured live. Items that
> cannot be derived are marked **UNKNOWN — verify**. Do not replace those with guesses.
>
> **⚠ TOP CONTRIBUTORS:** `TOP_CONTRIBUTOR_POLICY.md` is the SINGLE AUTHORITATIVE policy for the
> Contributor Score, the Top Contributors list and Active Engagement. Where any other doc
> disagrees with it, it wins.
>
> **⚠ TOP CONTRIBUTORS:** `TOP_CONTRIBUTOR_POLICY.md` is the SINGLE AUTHORITATIVE policy for
> the Contributor Score, the Top Contributors list and Active Engagement. Where any other
> document disagrees with it, **it wins.** The live score is 45% Posts + 35% Comments = **80%**
> of the model; the 20% Active Engagement slice is COLLECTING but NOT SCORED.
>
> **⚠ COMPANION DOCS:** `HANDOFF_2026-08-06.md` · `START_HERE.md` · `WORKING_RULES.md` ·
> `LOGGING_STANDARD.md` · `NEXT_RELEASE_RUNBOOK.md` · `BUILD_1053_PROGRESS.md` ·
> `SUPERSEDED_DOCS.md` · `NOTIFICATIONS_SYSTEM.md` · `DEPLOY_CACHE_GOTCHA.md` ·
> `BLANK_PAGE_ROOT_CAUSE.md` · `ANDROID_NOTIFICATION_ICON.md` · `PROFILE_PHOTO_POLICY.md` ·
> `TEXT_ENCODING_CORRUPTION.md` · `SESSION_2026-08-03_FULL_LOG.md` ·
> `LANGUAGE_PLAN_WEB_AND_APP.md` · `GOOGLE_OAUTH_BRANDING_CHECK.md` · `PERFORMANCE_AUDIT.md`.
>
> **⚠ The copies of these docs sitting in the REPO ROOT are STALE** — see §4.

---

## 0. Development rules (MANDATORY — read before touching anything)

The owner's standing rules. They override any default "helpful" behaviour. Follow literally.

**ABSOLUTELY NO:**
- ❌ **Guesswork** — read the actual value from the dashboard/DB/source first, then act.
- ❌ **Assumptions** — verify, or mark UNKNOWN. Never fill gaps with plausible defaults.
- ❌ **Implicit behavior** — no silent side effects.
- ❌ **Hidden operations** — never make changes the owner wasn't told about.
- ❌ **Recursive actions** · ❌ **Fan-out execution** · ❌ **Bulk modifications**
- ❌ **Auto-fix behavior** · ❌ **Background dependency changes**
- ❌ **"Probably safe" logic** · ❌ **Casual AI shortcuts**

**REQUIRED for every change:**
1. **Verify current state first**, make ONE deliberate change, **verify end-to-end** before
   reporting done.
2. **Never mark something "Done" without proof.** This is the single worst failure mode here.
3. **One thing at a time**, explicitly described.
4. **(2026-08-03) A fix that cannot be SEEN is indistinguishable from no fix.**
5. **(2026-08-03) Every members-only route goes inside `<RequireAuth>`** in `App.tsx`.
6. **(2026-08-06) Enterprise structured logging on every function you write or modify** —
   coded, expected/actual/reason/next-step, timing, redaction, never `console.log`, never
   generic messages, never secrets. See `LOGGING_STANDARD.md`.
7. **(2026-08-06) A Completion Verification Report after EVERY task** — a checklist marking
   each item ✅ DONE / ❌ NOT DONE / ⚠️ PARTIALLY DONE / N/A with concrete evidence, and an
   explicit explanation of anything incomplete. **Never simply say "Done".**

> History note: past sessions lost trust by marking OTP/email work "Done" that wasn't wired,
> and by guessing an OTP length instead of reading it.
>
> **2026-07-31:** (a) "Add friend" shipped without a constraint check → raw Postgres error on
> screen; the first fix treated *unknown* state as "no friendship" and let it through again.
> **Absence of information must disable an action, never enable it.** (b) Overlapping zips
> confused delivery — commit it yourself instead. (c) **A rule enforced in one component is
> not a rule** — policy belongs at the lowest layer that can enforce it (a DB trigger).
>
> **2026-08-01:** a silent `EXCEPTION WHEN OTHERS` hid total push failure for weeks.
> **A catch-all that returns normally must always `RAISE LOG` first.**
> Also: **an error whose shape you recognise is a hypothesis, not a finding** — the broadcast
> "gateway rejection" was actually Supabase's Hello World template deployed.
>
> **2026-08-05:** I relaxed the post-requires-photo rule after the owner asked only to remove
> the **profile-photo** wall. **Two different rules; extending one to the other by inference
> changed what the product IS.** See §12.25.
>
> **2026-08-06:** I listed a file as "converted" in a test's allow-list while it still held
> two `console.log` calls. **Only claim a file done after doing it** — my own test caught the
> over-claim, which is the argument for writing the test.

---

## 1. What this is
A photography-competition + community platform: web app (React SPA) + Android app (Capacitor
wrapper of the same web build) + Supabase backend. Members enter photo competitions, judges
score them in rounds, admins manage everything; plus feed/posts, courses, journal, wallet,
certificates, referrals. **~84 members as of 2026-08-06**, India-centred.

- **Public site:** https://www.50mmretina.com (bare `50mmretina.com` now redirects to `www`)
- **Android bundle ID / appName:** `com.fiftymmretina.app` / "50mm Retina World"
- **Play listing:** https://play.google.com/store/apps/details?id=com.fiftymmretina.app
- **Lovable is NO LONGER IN THE LOOP** (owner confirmed 2026-07-30). Ignore any older
  instruction that says "publish from Lovable".

## 2. Accounts & ownership (names only)
- **GitHub:** `altisinfonet` → repo `altisinfonet/lens-lustre-learn-Claude` (branch `main`)
- **Owner contact email (from code):** `altisappdev@gmail.com`
- **Cloudflare account:** Altis Infonet Private Limited (`a7810011a99de537a210130f86306785`)
- **Supabase project ref:** `jtdtehuqtinjxropkkcn`
- **Play Console, Firebase, Brevo, Stripe/PayPal/Razorpay, AWS S3, GA** — owner-held, not in repo.
- **Browser session note:** the owner's Chrome is signed in to GitHub and the Supabase
  dashboard (both usable), but its Google account is `mr.neilbasu@gmail.com`, which is **not**
  the Play developer account. Play work needs the owner to switch accounts.
  **Never sign in for him. Never enter credentials.**

## 3. Tech stack
- **Frontend:** React 18 + TypeScript, Vite (SWC), React Router, TanStack Query, Tailwind +
  Radix (shadcn-style), framer-motion, react-hook-form + zod, sonner/toast, react-mentions
  (comment boxes only — post captions use a bespoke mention layer, §8).
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). Media also on **AWS S3**
  and **Cloudflare R2** (`cdn.50mmretina.com`).
- **Hosting/CDN:** **Cloudflare Pages** + a Worker (`seo-edge-injector`). See §6.
- **Mobile:** Capacitor (Android). See `NEXT_RELEASE_RUNBOOK.md`.
- **Email:** Brevo. **Payments:** Stripe, PayPal, Razorpay, manual UPI/bank.
  **Push:** Firebase Cloud Messaging. **Analytics:** Google Analytics.

## 4. Repo structure (src/)
- `pages/` — 46 route pages. `components/` — shared UI; `components/admin/` (79 files),
  `components/judge/` (30), `components/course/`, `components/competition/`, etc.
- `modules/admin/` — heavier admin modules. `hooks/` — data/query hooks.
- `i18n/` — translation system (§11). `integrations/supabase/` — client + generated types.
- `lib/`, `utils/`, `services/`, `assets/`, `types/`.
- **`lib/logger.ts` + `lib/errorCodes.ts` — the logging standard (2026-08-06).** See
  `LOGGING_STANDARD.md`. `docs/error-codes.md` is GENERATED from `errorCodes.ts` by
  `scripts/generate-error-codes.ts`; a CI test fails if they drift.
- `lib/ads/` — ad system v2.
- `lib/native/` — **Capacitor bridges. These must NEVER statically import `@capacitor/*`**
  (installed only in Android CI). Use the `window.Capacitor` runtime-global pattern.
- `components/MentionInput.tsx` — **the ONE comment box** (all 11 comment surfaces).
  Do not fork it per surface.
- **`lib/captionMentions.ts` + `hooks/feed/useCaptionMentions.ts`** — post-CAPTION mentions
  (2026-08-06). Deliberately NOT react-mentions: the composer keeps its plain `<Textarea>`
  because the over-limit highlight overlay and auto-grow are owner-approved behaviour.
- `App.tsx` — routes incl. the **`<RequireAuth>` wrapper**; pinned by `authGuardCensus.test.ts`.
- `supabase/` — `config.toml`, `functions/` (60+), `migrations/` (550+).
- **⚠ STALE DOCS IN THE REPO ROOT.** `PROJECT_MASTER_RECORD.md`, `NEXT_RELEASE_RUNBOOK.md`,
  `ANDROID_RELEASE_RUNBOOK.md` at the repo root are all older than the project copies.
  **Do not read the repo copies.** (§16.6)
- **Stray file, harmless:** a duplicate `android-build.yml` at the repo ROOT does nothing.

## 5. Run locally
```bash
npm install
# .env needs: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev · npm run build · npm run test · npm run lint
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | grep -v vitest
npx tsx scripts/generate-error-codes.ts   # after adding an error code
```
`npx vite build` emits one harmless `svgo` error at the very end — the bundle is already
written. Not a build failure; do not chase it.

**Both API key generations are live** — legacy `anon`/`service_role` JWTs *and*
`sb_publishable_…`/`sb_secret_…`. A request that fails with one and succeeds with the other
is telling you about **that endpoint's code**, not the project.

## 6. How the WEB app deploys
```
GitHub main -> Cloudflare Pages "lens-lustre-learn-claude" (auto-build ~1-2 min)
            -> www.50mmretina.com  (bare domain 301s to www since 2026-08-06)
            -> Worker "seo-edge-injector" rewrites HTML
```
- Push to `main` → automatic build and publish. **No manual publish.**
- **The sandbox has no `git push` credentials** (proxy 403). **The browser is the only write
  path.** Since 2026-08-06 the fastest, byte-exact route is **GitHub's "Upload files" page**:
  stage under `/mnt/user-data/outputs/…`, go to `/upload/main/<directory>`, `find` the file
  input, `file_upload`, set the commit message with the **native `HTMLInputElement` value
  setter**, commit. It overwrites existing files cleanly. 16 files went through it in one
  session. Full recipes and traps: `NEXT_RELEASE_RUNBOOK.md` and `HANDOFF_2026-08-06.md` §7.
- **Ship multi-file changes through a branch + PR** when a half-landed set would break the
  live site. Independent files can go straight to `main`.
- Files under `.github/workflows/` **cannot be uploaded** — GitHub blocks it. Use the editor.
- **CRITICAL — the immutable-bundle cache trap.** Bump `(window as any).__APP_BUILD` in
  `src/main.tsx` on every release; it must stay a window side-effect (a bare `export const`
  is tree-shaken). **Current live marker: `2026-08-06-1`.**
- **Verify a deploy for real:** fetch `/?cb=<random>`, read the chunk names out of
  `index-*.js`, then grep the feature string inside the **SPECIFIC LAZY ROUTE CHUNK**
  (`WallPosts-*.js`, `AdminUsers-*.js`, `ProfileStories-*.js`, `AdminAppEvents-*.js`).
  **Checking only `index-*.js` gives FALSE NEGATIVES** — this wasted time twice on 2026-08-06.

## 7. How the ANDROID app builds
**Read `NEXT_RELEASE_RUNBOOK.md`** — the only Android runbook. Workflow
`.github/workflows/android-build.yml`, triggered by changing **`ANDROID_BUILD_TRIGGER`** or
the workflow itself, outputs a **SIGNED** `.aab` artifact `app-release-aab`.

**Current facts (2026-08-06):** versionName **1.2.2**, versionCode `1000 + run_number`.
**1053 is BUILT AND GREEN, waiting for the owner to upload it** — run #53, commit `679d25f`,
`versionCode=1053 versionName=1.2.2` read from the raw log,
https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31063602205
compileSdk 36, minSdk 24, targetSdk 36, AGP 8.12.3 / Gradle 8.13, R8 on. `@capacitor/camera`
REMOVED. `@capacitor/filesystem` present (line 51) — in-app saving depends on it.

- **Cutting a build with exactly ONE run:** the workflow's `on:` is `push: branches: [main]`
  with a `paths` filter. If only `ANDROID_BUILD_TRIGGER` changes, push other files FIRST
  (they don't match the filter → no run), then push the trigger → one run. If the workflow
  file must change too, use a **branch + PR merged as a single merge commit** — two direct
  pushes fire two runs and waste a build number.
- **Reading the signing result:** *"building UNSIGNED"* appears inside the **echoed script**.
  The real answer is **after `##[endgroup]`**.
- **Play "What's new" is exactly `Bug fixes and improvements.`** The detailed changelog lives
  ONLY in `ANDROID_BUILD_TRIGGER`, newest entry at the top, covering ALL accumulated changes.
- **Signing is DONE (2026-07-24) — do not re-investigate.** Alias `upload` hardcoded.
- **Play publishing:** managed publishing OFF → the owner's "Submit for review" = go-live.
- **The app bundles its own `dist`**, so **every frontend change needs a new AAB to reach app
  users.** Database/RPC changes reach both web and app instantly.
- **Only "upgrade AGP to 9.0+" remains** on Play's recommendations — deliberately deferred.

## 8. Backend — Supabase (`jtdtehuqtinjxropkkcn`)
- **Migrations do NOT auto-apply.** Paste into the SQL Editor and Run, or use the pg-meta
  platform API. Rehearse destructive SQL as `BEGIN; …; ROLLBACK;` first.
  **The SQL editor is Monaco:** `window.monaco.editor.getModels()[0].setValue(sql)` then click
  `Run`. **DESTRUCTIVE STATEMENTS OPEN A CONFIRMATION DIALOG** ("Potential issue detected" →
  **Run query**) — clicking Run is NOT enough (§12.26). **Never click "Run and enable RLS".**
- **Username system (live):** permanent Instagram-format usernames (`profiles.custom_url`),
  claimed once via `claim_username`; a trigger forbids later change.
- **Stored social counts (live):** `profile_stats` maintained by SECURITY DEFINER triggers.
- **Feed:** `get_broadcast_feed(_exclude_ids, _limit)` — unseen-first, fewest-viewers-first,
  recycling fallback. Seen-state in `feed_events`. **Never prune `feed_events` by event age.**
- **Stories:** `get_feed_stories_bar()` public + newest-first; `get_my_story_view_counts()`
  returns counts only. **RLS on `stories` is CORRECT** — "Users can delete own stories"
  (DELETE, `user_id = auth.uid()`) plus an admin ALL policy, verified 2026-08-06.
- **Real view counts:** `get_post_view_counts(_post_ids uuid[])` — counts only. Keep it even
  though a synthetic display layer exists; this is the truth.
- **Follow-only official account:** trigger `trg_block_friend_requests_to_admins`.
- **Push:** `push_tokens`, `push_config` (service_role only), trigger
  `trg_push_on_notification` → `send-push` via `pg_net`.
- **Notification history + grouping:** `NOTIFICATIONS_SYSTEM.md` is **the** reference.
- **Profile photos:** own-storage-only. OAuth pictures are no longer copied (Google 503s all
  hotlinks). See `PROFILE_PHOTO_POLICY.md`.
- **⚠ THE PROFILE-PHOTO POSTING GATE WAS REMOVED 2026-08-05.** The two RESTRICTIVE policies
  that required an uploaded photo to post or comment are gone, verified on production.
  `PROFILE_PHOTO_GATE_IMPACT.md` is now historical only. The rules today, SEPARATE:
  **a post REQUIRES a photograph (caption optional)**, and **a missing DP NEVER blocks
  posting, commenting or reacting.**
- **`profiles.last_platform` (2026-08-05, live):** `'app'|'web'`, written every 5 min by
  `useLastActive.ts` from `isNativeCapacitorApp()`. **NEVER derive origin from
  `client_errors`.** Data exists from 2026-08-05 onward only; blank means "not recorded yet".
  **App can only report itself from build 1053 onward.**
- **Client error log (2026-08-05):** `client_errors` + `log_client_error()` (5 fixed kinds,
  rate-limited, silent, anon-callable) + `get_client_error_stats_admin()`.
  See `CLIENT_ERROR_TRACKING.md`.
- **Structured application events (2026-08-06, APPLIED ON PRODUCTION):** the same
  `client_errors` table **extended** with `code, event, severity, fn, src_file, expected,
  actual, reason, next_step, duration_ms, correlation_id`, plus **`log_app_event()`** (writer,
  enforces `^[A-Z]{2,6}-[0-9]{4}$` and the six severities, 40/member/hour, silent on every
  error path) and the admin readers **`get_app_events_admin()`** and
  **`get_app_event_counts_admin()`**. Migration
  `20260806020000_structured_app_events.sql`. **`log_client_error` was NOT modified** — adding
  parameters would have created an ambiguous overload and broken error reporting in every
  installed build (§12.27). Read them at **Admin → Overview → Error Log**.
- **Edge functions:** `supabase/functions/` (60+). **They do NOT auto-deploy from GitHub.**
- **RLS:** heavily used. Do NOT read raw `entry.status`/`placement` on participant surfaces.
  `posts` are anon-readable **by design** (share links); `competition_entries` are not.

## 9. Secrets & credentials INVENTORY (locations only — NO values here)
| Secret / credential | Where it lives | Notes |
|---|---|---|
| Supabase URL + anon (publishable) key | `.env` (local), Cloudflare Pages env | public-safe |
| Supabase `sb_publishable_…` key | Supabase → Settings → API Keys | public-safe |
| Supabase **service role** / `sb_secret_…` | Supabase → API | server-only |
| Edge-function secrets (Brevo, Stripe, PayPal, Razorpay, AWS S3, GA, `FCM_SERVICE_ACCOUNT`, `PUSH_INTERNAL_SECRET`) | Supabase → Edge Functions → Secrets | **not in repo** |
| `push_config.internal_secret` | Supabase table (service_role only) | must match `PUSH_INTERNAL_SECRET` |
| Firebase client config | `google-services.json` (committed) | client config, not a secret |
| Android **upload keystore** + password | GitHub → Secrets → Actions | alias `upload`; back up the `.jks`! |
| Cloudflare / Play / Supabase / Brevo logins | owner only | never in repo |

## 10. Test / admin accounts
- Test member id used during i18n checks: `4c200b33-ae64-46f0-ba5d-1a97152e6a6c`.
- A live **admin** session exists in the owner's Chrome for live verification.
- **Verification technique that works:** run JS in the owner's tab to call Supabase REST/RPC
  with their session token, or fetch the deployed bundle and grep it. This proves "live" far
  better than a deploy log. **CSP note:** `50mmretina.com` blocks fetch to third-party hosts.
- **Sandbox `curl` to production works** (anon REST) and is the ONLY trustworthy sandbox check
  — headless Chromium is proxy-blocked (§12.20).

## 11. Translation / i18n system
7 languages (`en, hi, bn, mr, gu, ta, te`), ~2,947 keys each, in `src/i18n/translations.ts`
(home strings in `src/i18n/home.ts`). `useT()` → `t(key, fallback?)`. Language: saved
`profiles.preferred_language` → browser → English.
- **Status: COMPLETE** for the app as it stood on 2026-07-24.
- **English-only leftovers:** `/friends` "Awaited" label, admin-typed gallery categories, the
  Admin Broadcast Push panel, the ads picture-library admin UI, `/notifications` buckets, and
  (2026-08-06) the new **Admin → Error Log** screen (admin-only, deliberate).
- **Intentionally English:** exports, brand names, technical tokens.
- **⚠ Mojibake history:** 74 corrupted strings repaired; tripwire `sourceEncoding.test.ts`.
- **Font finding (OPEN):** Indic scripts have zero glyph coverage in the chosen faces; 42% of
  text below 12px. Type-scale fix awaits owner approval.
- **Adding a language = ONE file.**

## 12. KNOWN ISSUES / GOTCHAS (read before editing)
1. **Ambient `t` typecheck trap:** a `t()` outside a real `useT()` scope passes `tsc` but
   **crashes at runtime.** Audit `t` scope by hand; rename callback params named `t`.
2. **`lib/native/*` must not import `@capacitor/*`** — breaks the web build.
3. **Android signing is SOLVED — do not re-investigate.**
4. **Exposed GitHub token (historical)** — rotate if not already done.
5. **Judging privacy:** never surface raw `entry.status`/`placement` to participants.
6. **cwd resets between shell calls** — `cd /home/claude/repo` first. The sandbox is
   ephemeral; a new session starts with no clone (`git clone --depth 40 …` works read-only).
7. **⚠ EDGE FUNCTIONS DO NOT AUTO-DEPLOY FROM GITHUB COMMITS.**
8. **Email system solved 2026-07-25.** Still open: `photo-verification-request` has no
   template → always DLQs.
9. **Immutable-bundle cache trap** — bump `__APP_BUILD` every release (§6).
10. **GitHub blocks uploading `.github/workflows/*`** — use the pencil editor.
11. **Constraint-aware UI:** unknown state must DISABLE a button, never enable it.
12. **NEVER display a number without a real source** — the ONE deliberate exception is
    Reach / Viewed-by (owner instruction 2026-08-01, `src/lib/displayEngagement.ts`).
13. **Browser automation on a hidden tab:** rAF throttling means editors never react to
    `computer` clicks. Synthetic DOM events from `javascript_tool` still work.
14. **A BLANK PAGE IN A BACKGROUND TAB IS NOT EVIDENCE.**
15. **The sandbox's branch pointer goes stale — it is NOT lost work.** `git diff origin/main`
    (empty = identical), then `git reset --hard origin/main`.
16. **AN EDGE FUNCTION'S DEPLOYED CODE CAN SILENTLY BE SOMETHING ELSE.** Check the Code tab.
17. **Deadlock `40P01` on large DDL** — split by lock target; `SET lock_timeout = '5s';`.
18. **`String.replace(a, b)` MANGLES a replacement containing ``$` ``** — use a function replacer.
19. **Hand-transcribed payloads to the browser WILL corrupt silently** — hash-verify.
20. **THE SANDBOX PROXY BLOCKS `50mmretina.com` AND `*.supabase.co` FROM HEADLESS CHROMIUM.**
    `curl` is allowed. **Never trust a sandbox-headless verdict about production data.**
21. **jsdom has no layout — every element is 0×0.** Geometry needs real Chromium.
22. **A tap fires mouseenter AND click, in that order.** Gate hover to fine pointers.
23. **`pkill` in a compound Bash command can kill the shell itself (exit 144).**
24. **GitHub may REPLACE a JS-set commit message with its own AI suggestion.** Verify bytes,
    never the message.
25. **(2026-08-05) THE DP RULE AND THE POST RULE ARE SEPARATE.** A post requires a photograph;
    a missing profile photo blocks nothing. Extending one to the other by inference changed
    what the product IS. A deliberately loud comment at the top of `createPost` in
    `WallPosts.tsx` records this.
26. **(2026-08-06) THE SUPABASE SQL EDITOR PUTS DESTRUCTIVE SQL BEHIND A CONFIRMATION
    DIALOG.** Clicking `Run` is not enough — "Potential issue detected" → **Run query** must
    be confirmed. A cleanup DELETE silently never ran and left a fake test row in the owner's
    live Error Log until a screenshot exposed it. **Always screenshot the result.**
27. **(2026-08-06) NEVER ADD PARAMETERS TO A LIVE DATABASE FUNCTION THAT INSTALLED APPS STILL
    CALL.** In Postgres it creates a second overload, and existing calls become ambiguous —
    breaking every shipped build the moment it runs. Give the new function a NEW NAME. This is
    why `log_app_event` exists beside `log_client_error`.
28. **(2026-08-06) THE NAIVE COMMENT STRIPPER EATS REAL CODE.**
    `/\/\*[\s\S]*?\*\//g` treats `accept="image/*"` as opening a block comment that the next
    genuine `*/` closes — it deleted 20,000 characters of `WallPosts.tsx` and made true
    assertions fail. Anchor to line start: `/^\s*\/\*[\s\S]*?\*\//gm` plus
    `/\{\/\*[\s\S]*?\*\/\}/g`. **Several older tests in this repo still use the naive pattern.**
29. **(2026-08-06) A WRITE THAT REPORTS SUCCESS BUT CHANGES ZERO ROWS IS ALMOST ALWAYS RLS**
    — and it looks exactly like "the button does nothing". Prove row counts with
    `.select("id")` after `.delete()`. But **check the screen refresh first**: the stories
    "unable to delete" report was a screen that never updated, not a policy problem.
30. **(2026-08-06) AN ADMIN TAB NEEDS THREE REGISTRATIONS** — the valid-routes `Set`, the menu
    group, and the `AdminTab` type in `adminRoleAccess.ts`. Miss the `Set` and the menu item
    silently lands the admin on the default tab (Hero Banners).
31. **(2026-08-06) IN THE GITHUB TILED EDITOR, `ctrl+A` SILENTLY SELECTS NOTHING** and the
    paste APPENDS, duplicating the file — this broke `main` once (`useLastActive.ts`). Use
    counted `shift+Down` (≤100 per batch) + `shift+End` and verify before pasting. **The first
    click/keypress after a navigation is often ignored** — redo it once the page has loaded.

## 13. Environment / build commands cheat-sheet
- Deploy web: commit to `main` → Cloudflare Pages (~1–2 min). Bump `__APP_BUILD`.
- **Deploy edge functions: NOT automatic** — Supabase dashboard.
- **Apply migrations: NOT automatic** — SQL Editor (confirm the destructive dialog!) or pg-meta.
- Deploy Android: change `ANDROID_BUILD_TRIGGER` → Actions → download `.aab` → owner uploads.
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json`. Build: `npx vite build`.
- Tests: `npm run test`. Lint: `npm run lint`.
- Regenerate the error catalog doc: `npx tsx scripts/generate-error-codes.ts`.

## 14. "Continue any task" checklist
1. Read `HANDOFF_2026-08-06.md`, then `START_HERE.md`, then this file + `WORKING_RULES.md` +
   `LOGGING_STANDARD.md` + (for releases) `NEXT_RELEASE_RUNBOOK.md`. Check `SUPERSEDED_DOCS.md`
   before trusting an older doc.
2. `git fetch origin main` and check what is ACTUALLY on GitHub. For edge functions, "on
   GitHub" is not "deployed".
3. Make ONE change. 4. Typecheck + `vite build` + vitest.
   **Baseline: 730 passing / 25 failing / 1 skipped — the 25 are PRE-EXISTING** (4
   ProfilePhotoPrompt + 21 competition/judging). Capture the set before you start.
5. **Commit it yourself** through the browser — the Upload files page is fastest and
   byte-exact (§6).
6. **Byte-verify:** `git show origin/main:<path> | diff - <path>`.
7. **Verify live** by fetching the deployed LAZY ROUTE CHUNK, never sandbox-headless (§12.20).
8. Append a row to §15, update §16, and **give the owner a Completion Verification Report**.

## 15. Maintenance log (append every session — newest first)
| Date | Who/Model | What changed | Where |
|---|---|---|---|
| 2026-08-11/12 | AI (Opus 5) + owner | **Top Contributors v2 shipped end-to-end; Active Engagement collector built, applied to production and verified.** (1) **Phase 1 database** — `contributor_points_since` / `get_top_contributors_v2` / `get_contributor_scores` + `idx_post_comments_user_created`, migration `20260811160000`. Score is **calculated LIVE from current rows** — no ledger, no stored score, no snapshot table, no queue, no triggers, no cache — so it FALLS when content is deleted and a deleted account disappears on the next call. Cross-checked against an independently written implementation across all 49 scoring members with **0 mismatches**; deletion behaviour proven WITHOUT mutating a row. `v1` left untouched as rollback. (2) **Phase 3 frontend** — Home top-3 with the score to the RIGHT of the name on one line (`Last 30 Days`, 7 locales); feed+wall badge UNDER the name for EVERY member, mounted once in `PostCard` so the two surfaces cannot drift; batched score fetch (one query per screen, not one per card). PRs #65-#68. (3) **Phase 2a Active Engagement collector** — migration `20260811180000`, PR #69 (`564209b`), applied to production **02:13 UTC 2026-08-12**. COLLECT ONLY: nothing scored, nothing displayed, all three scoring functions md5-identical before and after. 120s idle rule, one ping per wall-clock minute, timer DESTROYED on hide, `/admin` and `/judge` forced `internal` with strictest-ping-wins, 30-min daily cap on public minutes only, 40-day raw retention with a permanent daily aggregate. RLS ON with **zero policies** + table grants revoked: a signed-in ADMIN gets 403 on SELECT/INSERT/DELETE. The path segment is **never stored** — only a two-value public/internal flag. (4) **Verified before production on a real PostgreSQL 16** stood up in the sandbox: 33 behaviour checks, all pass. 20 client tests, **7 mutations tried and all 7 caught**. 18-point production verification report. (5) **Three mistakes owned:** a production bug diagnosed from a symptom without testing the mechanism and merged as a false code comment (corrected in #68); a v2-is-faster claim that measurement disproved (v1 8.58ms vs v2 16.48ms); a stale doc quoted as the live leaderboard, naming a deleted profile. (6) **Post-categories audit only** — `posts` has NO category column; the feed strip does not exist; there is no `/create` route. 6 decisions pending. | migrations `20260811160000` + `20260811180000`, PRs #65-#69, `TOP_CONTRIBUTOR_POLICY.md`, `PHASE2A_VERIFICATION_REPORT_2026-08-12.md` |
| 2026-08-06 | AI (Opus 5) + owner | **Build 1053 cut and green; the enterprise logging standard built, shipped and made visible.** (1) **Build 1053** — run #53, `679d25f`, `versionCode=1053 versionName=1.2.2` read from the raw log; artifact `app-release-aab` 8.86 MB; cut with exactly ONE run by pushing `main.tsx` first (outside the paths filter) then the trigger. **Awaiting the owner's Play upload.** (2) **@mentions in post captions** — the 1053 headline item; picked names convert to the SAME `@[Name](id)` markup comments use so the renderer needed zero changes; hand-typed names deliberately stay plain text; the composer's plain `<Textarea>`, over-limit highlight and auto-grow were KEPT; 18 tests. (3) **Stories, all four owner rules** — bigger rings, full-page profile viewer, 10s timer, delete-anytime. **Root cause of "unable to delete": NOT RLS** (policy verified correct) — the row was deleted but never removed from local state, so the ring stayed until a reload. (4) **Admin last-active + App/Website columns** live; App can only appear from 1053 onward. (5) **THE LOGGING STANDARD** (new owner directive): `src/lib/logger.ts` (six levels, JSON, ambient member, `timed()`, redaction, correlation ids), `src/lib/errorCodes.ts` (26 codes, single source of truth), generated `docs/error-codes.md` + CI drift test, migration `20260806020000_structured_app_events.sql` **applied on production and self-checked**, and **Admin → Overview → Error Log** (`AdminAppEvents.tsx`) — verified live in the owner's browser and photographed. Converted the risky paths: post pipeline, both story deletes, mention search, auth. **50 new tests; suite 680 → 730 passing, same 25 pre-existing failures.** (6) **Three defects caught by my own tests/checks:** the logger leaked an e-mail to the DB (printed masked, persisted raw); the naive comment stripper ate 20k chars of `WallPosts.tsx`; a cleanup DELETE silently never ran behind Supabase's confirmation dialog and left a fake row in the live Error Log. (7) **New technique: GitHub's Upload files page** for byte-exact multi-file pushes (16 files in one session). (8) New gotchas §12.26–31; new rules WORKING_RULES §1a/§1b. (9) **PAUSED** mid-way through converting the remaining 98 `console.*` calls, awaiting an owner decision on `networkTracer.ts` (21 of them; prints to the console in PRODUCTION with no guard). | run #53, `src/lib/{logger,errorCodes,captionMentions}.ts`, `src/hooks/feed/useCaptionMentions.ts`, `src/components/admin/AdminAppEvents.tsx`, `src/pages/AdminPanel.tsx`, `docs/error-codes.md`, `scripts/generate-error-codes.ts`, migration `20260806020000`, `HANDOFF_2026-08-06.md`, `LOGGING_STANDARD.md` |
| 2026-08-05 | AI (Opus 5) + owner | **Builds 1051 and 1052 cut; the "images are not coming" root cause finally found and killed; the profile-photo posting wall removed.** (1) **IMAGES:** on 2026-08-01 feed photos had been rerouted through an image-resizing service that answers only the bare domain — members are on www and the app is a third origin, so every post photo failed while avatars/ads (direct URLs) kept working. Photos now load DIRECT. This was the weeks-long report. (2) **In-app saving** of photos and article PDFs via Filesystem→CACHE + the system Save/Share sheet; `@capacitor/filesystem` added to the workflow and proven in the install log. (3) **Emoji shortcuts** in comments (`<3`→❤️ etc., 21 tests). (4) **The post rule pinned:** a post REQUIRES a photo, caption optional — and the DP never blocks posting/commenting/reacting; **the two RESTRICTIVE photo policies were REMOVED and verified gone.** I had wrongly relaxed the post rule by inference first (§12.25). (5) **Loaded build shown beside Logout.** (6) **Stale-chunk auto-reload** so a deploy no longer breaks an open tab. (7) Build 1051 (run #51) then **1052 (run #52, PR #64)** — the one-run branch+PR technique invented here. (8) `useLastActive.ts` was **duplicated on `main`** by a `ctrl+A` that selected nothing; repaired with counted line selection (§12.31). | runs #51/#52, PR #64, `src/lib/{emoji,appVersion,storyTiming}.ts`, `src/hooks/core/useLastActive.ts`, `BUILD_1052_STATUS.md` |
| 2026-08-03 | AI (Fable 5) + owner | **The heaviest session so far — FULL detail in `SESSION_2026-08-03_FULL_LOG.md`.** Mojibake (74 strings, property-based detector caught what a hand list missed) + tripwire test; font forensics (42% of text < 12px, OPEN); comment box rebuilt Instagram-style with a VISIBLE 28px send disc in a 44px target (the first invisible-only fix was rightly rejected → WORKING_RULES §8); mentions proven working 3 ways; completion-ring panel fixed; **Google-avatar 503 root cause** (27/81 hotlinks, migration applied); **auth guard** `<RequireAuth>` across nine routes; blank-page contributors fixed; builds 1042→1044. New traps §12.20–24. | PRs #50–#56, migration `20260803210000` |
| 2026-08-02 | AI (Fable 5) + owner | **Notification rebuild stages 5–9 finished; Android notification icon solved end-to-end; Route A commits established; docs restructured** (`START_HERE.md` + `WORKING_RULES.md` created). Builds 1037–1041. | PRs #38–#49 |
| 2026-08-01 | AI (Opus 5) + owner | **Push root-caused after never having worked** (`extensions.net.http_post` → `net.http_post`, silent catch-all now RAISE LOGs) and proven to a real handset; notification rebuild stages 1–4; Admin Broadcast Push; ads picture library; **feed images through Cloudflare Transformations** (3,450 KB → 913 KB, plus a breaking `srcset` comma bug I shipped and hotfixed); **feed request storm 106 → 46**; photos no longer force-cropped to 4:5; synthetic Reach/Viewed-by at the owner's explicit instruction. | PRs #23–#34, migrations `20260801*` |
| 2026-07-31 | AI (Opus 5) | **Fake engagement numbers removed** (invented 2,000–100,000 figures on a 74-member platform), follow-only policy enforced at the DB, first fully assistant-committed deploy. Feed rebuild, public stories, push wiring. | PR #21, migrations `20260731*` |
| 2026-07-28 | AI (Fable 5) + owner | Search fix + username/social-counts + R8 workflow + releases 1014→1024. Owner rule recorded: **no third-party brand names in user-facing text**. | `20260728*–20260729*` |
| 2026-07-25 | AI (Opus 4.8) | OTP length fix (8→6), reset-password fix, erasure-confirmation email. **Discovered edge functions do NOT deploy from GitHub.** | Supabase Auth, edge functions |
| 2026-07-24 | AI (Opus 4.8) | Android release to signed state; CI auto-signing; `NEXT_RELEASE_RUNBOOK.md` written. i18n rollout completed. | workflow, secrets, Play |
| 2026-07 | AI | Created this master record; built the 7-language i18n system. | root docs, `src/i18n/*` |

## 16. OPEN ITEMS — the live to-do list (consolidated 2026-08-06)

**16.1 — OWNER ACTIONS (nothing is blocked on us):**
1. **Upload build 1053 to Play.** "What's new" exactly `Bug fixes and improvements.`
2. **Paste-deploy `cloudflare/seo-edge-injector/worker.js`** in the Cloudflare dashboard for
   the true bare→www 301. The inline script already covers browsers.
3. **Send the real female-member list** (33 avatars carry a provisional gender split).
4. **Retest the app comment-box mention popup** on 1053 (reported on 1050, never retested).

**16.2 — Open decisions awaiting the owner (do NOT do unasked):**
- **The network tracer prints to the console in PRODUCTION.** `src/lib/networkTracer.ts`
  intercepts every `fetch()`; `main.tsx` line 18 starts it with **no `PROD` guard**. Leave,
  gate to development, or convert to the logger? (21 of the 98 remaining console calls.)
- **Make a missing `/assets/*` return 404 instead of index.html** — the real blank-page fix.
  `BLANK_PAGE_ROOT_CAUSE.md`. Highest value of anything here.
- **A "mentioned you" notification** for caption mentions — not built, because comments do not
  send one either. New DB work if wanted.
- **Bump versionName to 1.2.3** on the next build? 1053 shipped as `1053 (1.2.2)`.
- **Type-scale fix** — 42% of text < 12px; needs screenshot approval.
- **Tier-1 font plumbing** (fallback stack, drop dead Lora, `<link>` loading).
- **New-post push "in-app only"** — changes what handsets receive.
- **Brand-name boundary** (`auth.continueApple`, `csub.uploadNote`) — asked, unanswered.
- **Emoji picker + `:` shortcode suggestions** in the comment box.

**16.3 — The logging rollout is PAUSED part-way.** ~98 `console.*` calls remain in 44 files.
The exact file/line list and the planned order (member-facing first) are in
`HANDOFF_2026-08-06.md` §5. **When you convert a file, add it to `CONVERTED_FILES` /
`MUST_LOG` in `src/lib/__tests__/loggingStandard.test.ts`** — that is what stops it
regressing.

**16.4 — Ads: owner-side settings still off or empty.** Story Card mode `off`; two pictures
with empty click URLs; Sidebar ad desktop-only, no click URL; `adsense_config.publisher_id`
EMPTY while enabled; `ad_frequency_v2` row absent. Master switch `ad_zones_v2_enabled` is ON.

**16.5 — Legacy ad system: parked, do not delete.** `src/lib/adSlots.ts` +
`site_settings.ad_slots` hold 9 configured ads; nothing renders them. **Do not delete that row.**

**16.6 — Comment-like names.** `PostCommentsSection` selects `comment_id` only, so the 👍1
badge is a bare number. Owner wants names; it is a build, not a bug.

**16.7 — The repo-root copies of these docs are stale** (§4). Refresh or replace with a
pointer. Until then a session reading the repo gets a July-28 picture.

**16.8 — Older items still open.**
- **`photo-verification-request` has no email template** → DLQ.
- **Login's "email not verified" error has no resend path.**
- **25 unrelated tests fail on `main`** (4 ProfilePhotoPrompt — owner ruled "Not required" —
  and 21 competition/judging). Pre-existing.
- **Notification follow-ups:** no admin screen for `get_push_health()`; no alerting on
  `delivery_looks_dead`; nothing detects an edge function being overwritten; broadcast leaves
  no in-app record.
- **AGP 9 upgrade** — deliberately deferred.
- **The 2026-08-04 posting outage remains unexplained.** No root cause established. Do not
  claim one, and do not conflate it with the blank page or the removed photo gate.

**16.9 — TOP CONTRIBUTORS / ACTIVE ENGAGEMENT (2026-08-12).** Full detail in
`TOP_CONTRIBUTOR_POLICY.md`.
- **The live score is 80% of the model** — 45% Posts + 35% Comments. The 20% Active
  Engagement slice is COLLECTING but NOT SCORED. Do not call the score "complete".
- **Phase 2b and 2c are NOT started and must not start automatically.** The owner will ask for
  an *Active Engagement Data Quality Report* after real collection time; **that** report
  decides whether the 120s rule and the 20% model are approved at all.
- **⚠ Android carries NONE of this.** `capacitor.config.ts` bundles `dist` at APK build time
  with no `server.url`, so app users see no badge, no Home score, and record no engagement.
  Needs an AAB. Android background/battery behaviour is therefore UNVERIFIED on a device.
- **⚠ Video lessons are the collector's biggest blind spot.** `LessonView.tsx` embeds video in
  a cross-origin `<iframe>`; clicks inside the player never reach the page, so a 20-minute
  attentive watch earns ~2 minutes. Needs a decision, not a patch.
- **The path segment is discarded by design**, so Phase 2b CANNOT report per-section usage
  without a deliberate schema + privacy change.
- **Post categories: AUDIT ONLY, nothing built.** `posts` has no category/genre/tag column;
  the feed category strip does not exist in code; there is no `/create` route. **6 decisions
  are waiting on the owner** — see `AUDIT_POST_CATEGORIES_2026-08-11.md`. Note the trap: a
  minimum-1-category rule would break three existing insert paths (album auto-post,
  profile-update post, scheduled-posts cron), and `Astrophotography` vs `Astro` is a silent
  data migration.

> **How to update this file:** say *"update PROJECT_MASTER_RECORD.md"* and state what changed;
> append a row to §15, edit the affected section, move anything finished out of §16, keep the
> no-secrets rule. **Do not start a new `CONTINUE_HERE_<date>.md`** — that is what created two
> competing sources of truth in the first place.
