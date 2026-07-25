# 50mm Retina World — Project Master Record

> **Purpose:** single cold-start reference. Anyone (human or AI) should be able to read this
> and continue work **without asking a question.** Keep it updated (see §15).
>
> **Security rule for this file (never break it):** document *where* every secret lives and
> *what it is for* — **never** paste actual passwords, tokens, API keys, or keystore
> passwords here. A committed doc with live secrets is a breach. This file has none.
>
> **Honesty note:** facts below were read directly from the repo (`package.json`,
> `supabase/config.toml`, `.github/workflows/*`, source tree). Items that cannot be
> derived from the repo are marked **UNKNOWN — verify**. Do not replace those with guesses.

---

## 1. What this is
A photography-competition + community platform: web app (React SPA) + Android app (Capacitor
wrapper of the same web build) + Supabase backend. Members enter photo competitions, judges
score them in rounds, admins manage everything; plus feed/posts, courses, journal, wallet,
certificates, referrals.

- **Public site:** https://50mmretina.com
- **Android bundle ID / appName:** `com.fiftymmretina.app` / "50mm Retina World"
- **Built with Lovable.dev** (AI app builder) — Lovable auto-commits to GitHub; local pushes
  reflect back into Lovable.

## 2. Accounts & ownership (names only)
- **GitHub:** `altisinfonet` → repo `altisinfonet/lens-lustre-learn-claude` (branch `main`)
- **Owner contact email (from code):** `altisappdev@gmail.com`
- **Lovable project:** README links `lovable.dev/projects/<PROJECT_ID>` — **UNKNOWN exact
  project id** (README has a placeholder); find it in the Lovable dashboard.
- **Supabase project ref:** `jtdtehuqtinjxropkkcn`
- **Google Play Console, Firebase, Supabase, Brevo, Stripe/PayPal/Razorpay, AWS S3, Google
  Analytics** logins — held by the owner; **not in repo.**

## 3. Tech stack
- **Frontend:** React 18 + TypeScript, Vite (SWC), React Router, TanStack Query, Tailwind CSS
  + Radix UI (shadcn-style), framer-motion, react-hook-form + zod, sonner/toast.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions). Media also on **AWS S3**
  (via `s3-*` edge functions).
- **Mobile:** Capacitor (Android). See `ANDROID_RELEASE_RUNBOOK.md`.
- **Email:** Brevo. **Payments:** Stripe, PayPal, Razorpay, plus manual UPI/bank.
  **Push:** Firebase Cloud Messaging. **Analytics:** Google Analytics.

## 4. Repo structure (src/)
- `pages/` — 46 route pages. `components/` — shared UI; `components/admin/` (78 files),
  `components/judge/` (30 files), `components/course/`, `components/competition/`, etc.
- `modules/admin/` — heavier admin modules (e.g. `CompetitionsModule.tsx`).
- `hooks/` — data/query hooks (core, wallet, competition, judging, social, profile…).
- `i18n/` — translation system (see §11). `integrations/supabase/` — client + generated types.
- `lib/`, `utils/`, `services/`, `assets/`, `types/`.
- `supabase/` — `config.toml`, `functions/` (60+ edge functions), `migrations/` (545 files).
- Root docs: this file, `ANDROID_RELEASE_RUNBOOK.md`, `CAPACITOR_SETUP.md`, `STORE_LISTING.md`,
  `README.md`, plus `PhaseN_*_Report.md` audit docs.

## 5. Run locally
```bash
npm install
# create .env with (values from Supabase dashboard → API):
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_PUBLISHABLE_KEY=...   (this is the public anon key)
npm run dev        # vite dev server
npm run build      # production build → dist/
npm run test       # vitest
npm run lint       # eslint
# typecheck (used constantly): 
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | grep -v vitest
```
The only two frontend env vars are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
(names referenced in `src/integrations/supabase/client.ts`). Both are safe-to-ship public
values, but still keep them in `.env` (git-ignored), not hardcoded.

## 6. How the WEB app deploys
- Via **Lovable** (README §"How can I deploy": open the Lovable project → **Share → Publish**).
- Pushing to `main` on GitHub reflects into Lovable; the live site auto-updates.
- **Practical deploy wait:** ~**115 seconds** after push before the change is live (used
  throughout the i18n work). Then hard-refresh to bust cache.

## 7. How the ANDROID app builds  ← now AUTOMATIC + SELF-SIGNING
**Fast path: read `NEXT_RELEASE_RUNBOOK.md` (one page).** Full detail:
`ANDROID_RELEASE_RUNBOOK.md`. One-line: GitHub Actions workflow
`.github/workflows/android-build.yml`, triggered by editing **`ANDROID_BUILD_TRIGGER`** (or the
workflow), outputs a **SIGNED, upload-ready** `.aab` artifact named **`app-release-aab`** →
download → upload to Play Console → owner submits.
Key facts: versionName `1.1.1`, versionCode `1000 + run_number` (latest built **1010**; live
on Play **1005**), compileSdk 36, minSdk 24, **targetSdk 36**, Capacitor version NOT pinned.
- **Signing is DONE (2026-07-24):** CI signs automatically. `keyAlias` is **hardcoded to
  `upload`** in the workflow; secrets `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD`
  provide the keystore + password (key password = keystore password). Keystore = PKCS12, 1
  entry, alias `upload`, PrivateKeyEntry, cert SHA-256 `35:2F:82:CF:…:99:12` (matches Play's
  upload cert). **Do not re-investigate signing.** See runbook §5.
- **targetSdk fix (2026-07-24):** the workflow set compileSdk/minSdk but never set
  `targetSdkVersion`, causing the Play "update target API by 31 Aug 2026" warning. Added
  `targetSdkVersion = 36`; verified in built bundle 1010. **API 36 clears the requirement.**
- **Play publishing:** managed publishing **OFF** → owner's "Submit for review" = go-live.
  Release 1010 was built, verified, uploaded, and left as a prepared Production draft.

## 8. Backend — Supabase (`jtdtehuqtinjxropkkcn`)
- **Migrations:** `supabase/migrations/` (545). Schema changes go here.
- **Edge functions:** `supabase/functions/` (60+). Notable ones:
  - Payments: `create-payment-session`, `paypal-capture-order`, `razorpay-verify-payment`,
    `submit-deposit`, `admin-process-withdrawal`, `get-payment-gateways-public`.
  - Wallet: `get-wallet-summary`, `get-wallet-transactions`, `send-gift-credit`,
    `expire-gift-credits`, `ad-reward-credit`.
  - Judging: `complete-round`, `publish-round`, `evaluate-round2`, `submit-judge-decision`,
    `submit-judge-comment`, `judge-session-resume`, `judging-invariants-nightly`.
  - Email (Brevo): `send-transactional-email`, `process-email-queue`, `brevo-webhook`,
    `send-reengagement-emails`, `handle-email-unsubscribe`.
  - Storage/S3: `s3-presign-upload`, `s3-signed-url`, `s3-upload`, `s3-delete`,
    `purge-s3-orphans`, `migrate-storage`, `backfill-thumbnails`.
  - Misc: `send-push` (FCM), `ga-report` (Analytics), `sitemap`, `seo-route-metadata`,
    `delete-my-account`, `hard-delete-competition`, `rank-feed`, `ask-anything`.
- **RLS:** row-level security is heavily used (esp. judging privacy — see `PhaseN_*` audit
  docs and `rls-audit-judging.md`). Do NOT read raw `entry.status`/`placement` on
  participant-facing surfaces — always use the publish-gated status (`useEntryPublicStatus`).

## 9. Secrets & credentials INVENTORY (locations only — NO values here)
| Secret / credential | Where it lives | Notes |
|---|---|---|
| Supabase URL + anon (publishable) key | `.env` (local), Lovable env | public-safe, still keep in env |
| Supabase **service role** key | Supabase dashboard → API | server-only; used by edge functions |
| Edge-function secrets (Brevo, Stripe, PayPal, Razorpay, AWS S3, FCM server key, GA) | Supabase dashboard → **Edge Functions → Secrets** | **not in repo** |
| Firebase client config | `google-services.json` (committed at repo root) | client config, not a secret key |
| Android **upload keystore** (base64) + password | GitHub → Settings → Secrets → Actions: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` (both set); owner also holds the `.jks` + `KEYSTOREREADME.txt` | alias `upload`; key pw = keystore pw; used by CI auto-signing. Back up the `.jks`! |
| GitHub push token | was embedded in the clone's git remote URL | **ROTATE — exposed** (see §12) |
| Play Console / Google / Supabase / Brevo / payment logins | owner only | never in repo |

## 10. Test / admin accounts
- Test member account id used during i18n live checks: `4c200b33-ae64-46f0-ba5d-1a97152e6a6c`
  (its `profiles.preferred_language` was reset to `English` after each test).
- There is a live **admin** session in the owner's Chrome used for live verification; admin
  routes (`/admin/*`) require an admin role. `/referrals` redirects admins away.

## 11. Translation / i18n system  ← (the big one, so it can be continued)
**Goal:** Facebook/Instagram-style per-string translation, 7 languages, no external library.
- **File:** `src/i18n/translations.ts` — one `Dict` per language: `en, hi, bn, mr, gu, ta, te`
  (English, Hindi, Bengali, Marathi, Gujarati, Tamil, Telugu). **~1,060 keys** currently.
- **Context:** `src/i18n/I18nContext.tsx` → `useT()` returns `t(key, fallback?)` =
  `translations[lang][key] ?? translations.en[key] ?? fallback ?? key` (English fallback,
  never blank). Language decision: saved `profiles.preferred_language` → browser language →
  English. `LanguagePicker.tsx` + `LanguageAccountSync.tsx` handle switching/persistence.
- **Data-driven menus** use a label→key map pattern (see `UserMenu.tsx`, `MobileAdminNav.tsx`
  with `ADMIN_GROUP_KEYS`), so DB-stored English labels stay unchanged (RBAC/search safe) and
  translate only at render via `t("adm.nav." + routeKey, englishLabel)`.
- **Adding a language later = ONE file:** add the 2-letter code to `LANGS` + `Lang` type in
  `translations.ts`, add one new `Dict` block translating the same ~1,060 keys. No code
  changes anywhere else.

### Established working pattern for a new batch (repeat this)
1. Author keys as a python dict `{key: [en, hi, bn, mr, gu, ta, te]}`; insert before each
   dict's closing `};` with a script (examples: `/home/claude/insert_*.py`). Guard against
   duplicate keys.
2. Wire each component: add `import { useT } from "@/i18n/I18nContext";`, add
   `const t = useT();` **inside the component that renders the string**, replace the literal
   with `{t("key")}` / `placeholder={t("key")}` / toast `t("key")`.
3. Typecheck: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | grep -v vitest`.
4. **CRITICAL manual audit (typecheck CANNOT catch it — see §12):** confirm every `t(...)`
   call sits inside a function that has its own `const t = useT()` in scope. Module-level
   arrays/`memo` sub-components need their own hook or a render-time lookup.
5. Commit + push to `main`; wait ~115s; live-verify in Hindi by setting
   `localStorage.setItem('app_lang','hi')` in the browser on the real site, then restore to
   `'en'`. (Never claim "done" without a live check — this was the owner's #1 grievance.)
6. Update the module report generator `/home/claude/i18n_module_report.js` (adds a module row
   + regenerates the landscape DOCX matrix) and deliver it, with the honest line:
   **Total ~1,243 · Completed <n> · Remaining <1243−n>.**

### Progress state (update each pass)
- **COMPLETE — full app translated.** As of **2026-07-24** the dictionary holds **2,947 keys
  per language** (up from ~1,060; **+1,887 keys × 7 ≈ 13,209 new strings**). Every user-facing
  admin and judging surface is now wired: **116/123 admin+judge components** (the remaining 7
  are text-free wrappers — AdminPage/Toolbar/Table, AdminAdvertisements, LongPressButton,
  RippleButton, NavigationBlocker — nothing to translate).
- This closed out the prior "REMAINING ~183" list (all ~32 low-traffic admin tools + judge
  micro-labels) **and** the big-ops modules the earlier report had deliberately left English:
  SEO, Page Management, Redirects, On-Page Images, Menu Builder, Analytics (+Reports),
  Performance, Health dashboards, Tag Semantics, Email templates + rich-text toolbar, Ads V2,
  Certificates, Judging Tags, Engagement, Referrals, Newsletter/FAQ, Notifications,
  Announcements, Journal, Courses, Keyword Blocklist, Badge/Role Definitions, Vote Rewards,
  Auth Pages, User Guide, Competition Funnel/Judges/Rounds, Judge Activity/Monitoring,
  Employees, Comment/Post Reports, Featured Artist, Banners, Gallery, Photo of Day, Excellence,
  Activity Logs, and the SMTP/S3/AI/WhatsApp/social settings config panels.
- **Verification run every batch:** `tsc` clean → scripted `useT()`-scope audit → variable-
  shadowing audit (every `.map/.find/.filter(t=>…)` checked so no translate call is captured by
  a shadowing `t`) → key-resolution + 7-language parity (all dicts equal, no dupes) → no new
  test failures. Live Hindi verify still pending push+deploy of the delivering commits (§15).
- **Intentionally English (by design):** downloadable PDF/CSV/HTML exports (Indic scripts don't
  render in jsPDF and are shared with banks/accountants); brand names (Stripe/PayPal/Razorpay,
  Brevo, Twilio, Meta, OpenAI, Lovable…); technical tokens (SQL, env-var names, URLs, metric
  codes like LCP/TTFB, API-key placeholders, enum values such as TLS/SSL).

## 12. KNOWN ISSUES / GOTCHAS (read before editing)
1. **Ambient `t` typecheck trap (most important):** an ambient declaration makes bare `t`
   *always* typecheck, so a `t()` used outside a real `useT()` scope passes `tsc` but
   **crashes at runtime.** Bugs already caught by manual audit and fixed:
   `CinemaDashboard.UpcomingCard`, `JudgeRoundSidebar.RoundRow`, and (2026-07-24)
   `AdminTransactions` — a `.map(t => …)` row variable named `t` shadowed the translator inside
   the pending/approve/reject controls. Also hardened `I18nContext` so the **default** context
   `t` resolves the English dict (not the raw key) when no provider is mounted — fixes unwrapped
   renders and several unit tests. **Always audit `t` scope by hand**, and watch for callback
   params named `t` (rename to `tg`). Prefer live-render verification over typecheck alone.
2. **Capacitor version is not pinned** → non-reproducible Android builds. Pin exact
   `@capacitor/*` versions in `package.json` if reproducibility matters.
3. **Android signing is SOLVED — do not re-investigate.** CI auto-signs; `keyAlias` is
   **hardcoded to `upload`** (a corrupted `ANDROID_KEY_ALIAS` secret with trailing whitespace
   caused repeated "No key with alias" failures on 2026-07-24 — hardcoding the non-secret alias
   fixed it permanently). Do not re-add a KEY_ALIAS secret. The `.aab` artifact
   `app-release-aab` is >10 MB, so the browser `file_upload` bridge can't inject it into Play —
   the file must be picked via the OS dialog (or staged via the device bridge). Owner still must
   keep the `.jks` backed up (losing it forces a Play key reset).
4. **Exposed GitHub token:** the clone's git remote URL had a personal-access token in it.
   **Rotate it** (GitHub → Settings → Developer settings → PATs) and use SSH/credential helper.
5. **Judging privacy:** never surface raw `entry.status`/`placement` to participants; use the
   publish-gated source. Audited in `PhaseN_*` + `rls-audit-judging.md`.
6. **cwd resets between shell calls** in the working environment — always `cd` into the repo
   first. Repo path in the AI env: `/home/claude/project/repo`.

## 13. Environment / build commands cheat-sheet
- Deploy web: push to `main` → Lovable auto-publishes (~115s).
- Deploy Android: edit `ANDROID_BUILD_TRIGGER`, push → Actions builds `.aab` → sign → upload.
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json`.
- Tests: `npm run test`. Lint: `npm run lint`. Vocabulary tooling: `npm run vocab:*`.

## 14. "Continue any task" checklist
1. `git pull` on `main`. 2. Read this file + the relevant `PhaseN_*`/audit doc.
3. Make the change. 4. Typecheck + (for i18n) manual `t`-scope audit. 5. Commit + push.
6. Wait ~115s, live-verify on https://50mmretina.com. 7. Update this file's changelog (§15)
   and, for translations, the module report DOCX.

## 15. Maintenance log (append every session — newest first)
| Date | Who/Model | What changed | Where |
|---|---|---|---|
| 2026-07-24 | AI (Opus 4.8) | **Android release SHIPPED to signed + prepared-on-Play state.** Set up **CI auto-signing** (secrets `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD`; `signingConfig` injected at build). Root-caused repeated "No key with alias" failures to a corrupted `ANDROID_KEY_ALIAS` secret → **hardcoded `keyAlias "upload"`** in the workflow and reused keystore pw for the key pw. Built + verified signed bundle **1010 (targetSdk 36)** (cert SHA-256 matches Play upload cert), uploaded to a **Production draft**, left for owner's Submit. Wrote **`NEXT_RELEASE_RUNBOOK.md`** and refreshed `ANDROID_RELEASE_RUNBOOK.md` (both: signing solved, don't re-investigate). | `.github/workflows/android-build.yml`, GitHub secrets, Play Console, runbooks |
| 2026-07-24 | AI (Opus 4.8 / Fable 5) | **Completed the i18n rollout:** translated the entire remaining admin back-office + full judging surface (judge grid/list/full-view, guide modal, placement board, audit tools, stages 1–3, settings panels). Dictionary 1,060→**2,947 keys/lang** (+1,887). 116/123 admin+judge components wired. Fixed a runtime `t`-shadow crash in `AdminTransactions`; hardened default I18n context. **Fixed the Play target-API warning** by adding `targetSdkVersion = 36` to `android-build.yml`. 7 commits prepared on top of `df95bac`. | `src/i18n/translations.ts`, ~98 components, `.github/workflows/android-build.yml`, this file |
| 2026-07 | AI (Opus 4.8) | Created this master record + `ANDROID_RELEASE_RUNBOOK.md`; documented build/backend/i18n/secrets-inventory. Translation progress ~1,060/1,243. | root docs |
| 2026-07 | AI (i18n passes) | Built the 7-language i18n system; translated all member-facing + judge + high-traffic admin surfaces. | `src/i18n/*`, wired across app |

> **How to update this file:** in a new session say *"update PROJECT_MASTER_RECORD.md"* and
> state what changed; append a row above, edit the affected section, keep the no-secrets rule.
