# Master list — 2026-08-10, evening. Build 1059 LIVE on Play.

`main` = **`dbf6bc0`** · CI on that commit **Typecheck ✅ Security ✅** · web live
**Build 1059 is LIVE on Play** (Android run **#59**, `versionCode 1059`).

**Test baseline is now 999 pass / 2 fail.** It was 6 fail this morning; P5 closed
four of them. The remaining two are the judging round-progression pair (P10),
which is flagged dangerous and needs the owner. **3+ failures means you broke
something.**

**Browser:** use **Browser 2** only — see `BROWSER_AND_ACCOUNTS.md`. Do not ask
the owner which browser; the answer is recorded.

---

## ✅ SHIPPED TODAY, AFTER 1059 — all web, all live, all measured

| # | What | Commit(s) | Proof |
|---|---|---|---|
| **P8** | **No text on the site is under 12px**, and body line spacing 1.34 → 1.45 | `fd2dab1` `8b5cab6` | Live `/login` before/after: **6 of 12** visible elements under 12px → **0 of 12**; line-height 18.76px → 20.3px (**1.450**); 0 clipped elements. Real Chromium against the production bundle: 6/7/8/9/10/11px all render 12px; 13/14/24px untouched; responsive sizes still win at 1280px |
| **UI** | **Posts run edge to edge on phones, with no box** | `6512ad6` `cf205b5` `f6c9ecc` `e39cf5e` | Chromium at 390px: post `x=0 w=390`; borders `0/0/1px/0`; radius 0; `docScrollW == viewport` (no sideways scroll). Desktop measured live: 590px card, 1px all round — unchanged |
| **UI** | **React / comment / share are thumb-sized** | same | 36px → **48px** tall, icons 20px → **24px**, and exactly equal thirds — measured **123 / 123 / 123** at 390px, **189 / 189 / 189** at 1280px |
| **P5** | **4 red ProfilePhotoPrompt tests** — they pinned a rule the owner replaced | `dbf6bc0` | Rewritten to pin the CURRENT rule, in the stricter direction. Mutation-checked: re-add the photo gate → red; make the modal skippable → red |
| **N4 pt 2** | **Client half** of "A deleted account" | `85f300a` `1551343` `045e132` `8edc307` | 3 new tests, **2 of which fail on `23a5018`**. Inert until the SQL runs — see below |
| **P6** | **`package-lock.json` — VERIFIED ALREADY FIXED, closed** | — | The note claimed 13 packages out of sync and `npm ci` failing. Ran `npm ci` against the committed lockfile: **exit 0, 944 packages**, and `npm install --package-lock-only --dry-run` says "up to date". Stale item |

### How P8 was done, and why it matters for the next person
**One CSS block, not 2,591 edits.** The source held 2,591 sub-12px class uses
across **246 files** (10px ×1137, 9px ×928, 11px ×277, 8px ×203, 7px ×39,
8.5px ×3, 10.5px ×2, 6px ×2). Rewriting those is the bulk modification this
project forbids. `src/__tests__/textSizeFloor.test.ts` **re-derives the list
from the source on every run**, so `text-[5px]` written next month goes red
instead of shipping. Mutation-checked three ways.

### The cause of the width bug, recorded so nobody hunts it again
`src/index.css` sets **`.container { width: 90% !important }`** — under a comment
that reads *"Enforce full-bleed containers site-wide"*, which is the opposite of
what it does. That 5% each side was the dead strip on every photo.
**It cannot be fixed by changing the 90%:** `.container` is used in **150**
places, and on Journal / Dashboard / Friends / navbar / footer the 5% IS the page
gutter. A post now opts out by itself, phones only, with
`margin-left: calc(50% - 50vw)` — the 50% resolves against the parent and the
50vw against the screen, so there is nothing to keep in sync.

---

## ⛔ BLOCKED ON THE OWNER — one click each

### 1. N4 part 2, the SQL half — **the first thing to do**
Everything else for it is live and byte-verified. The migration to paste is
**`supabase/migrations/20260810120000_bell_actor_known.sql`**, already on `main`.
`DROP FUNCTION` + `CREATE FUNCTION`, **run together in one go**.

**Supabase's SQL editor never mounts while its tab is in the background** —
`document.hidden === true` and `monaco.editor.getModels()` stays empty forever.
The owner must click that tab. The hosted `/api/platform/pg-meta/.../query`
proxy answers *"Endpoint not supported on hosted"*, and the direct
`api.supabase.com` call needs an encrypted connection-string header the page
does not expose — **so there is no API shortcut. Do not hand-assemble one to run
DDL on a live database.**

Measure first (read-only), then apply, then measure again:

```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_my_unread_notifications_grouped') as fn_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_my_unread_notifications_grouped'
      and pg_get_function_result(p.oid) like '%actor_known%') as already_has_column,
  (select count(*) from public.user_notifications x
    where x.actor_id is not null
      and not exists (select 1 from public.profiles pr where pr.id = x.actor_id)) as rows_actor_deleted;
```

Expect `1 / 0 / ~35` before and `1 / 1 / ~35` after. **The third number must not
move** — this rewrites a function, it must not touch a row.

### 2. Photos on 1059 — still unanswered
He installed 1059 this session and said he would report back. **It is still the
one unverified item in that build.** Display-side and fully reversible.

### 3. N3 — needs 30 seconds of him posting
**Not reproduced. No root cause established. Do not write a fix.**
What he told us: **on the Feed, right after pressing Post, one grey block PLUS
his real post.**
What has been ELIMINATED, by measurement on his live site:
* A manual feed refresh produces **zero** skeletons — refreshing is not it.
* `insertPost` **already dedupes on post id** (`useFeedCacheUpdaters.ts:48-50`),
  so the handoff's original theory is dead.
* No empty AdZone placeholder was rendering at the time (`div.border-dashed`
  count was 1, and that one is the composer's "Add Photo" dropzone).
Still open as a candidate: `handleNewPost` inserts the post with
`author_name: null, author_avatar: null`, which renders as an unhydrated card.
**Watch his live DOM while he posts before touching anything.**

---

## ⏳ STILL PENDING

| # | Item | State |
|---|---|---|
| **N4 pt 3** | Stop nulling `actor_id` on future deletions | Specified. `delete-my-account/index.ts:138` and `delete-user/index.ts:127`, both `.from("user_notifications").update({ actor_id: null })`. **Edge functions do NOT auto-deploy — hand-deploy each.** Security path: do it last and **re-test deletion after** |
| **P4** | Dependency vulnerabilities | **Do NOT attempt from the sandbox.** `bun.lock` pins a private `europe-west*-npm.pkg.dev` mirror that returns 403 here, and Cloudflare builds `--frozen-lockfile` — regenerating the lockfile from a different registry would kill every deploy. Measured list: **16 high, 6 moderate, 2 low**; notable are `vite`, `postcss`, `react-router-dom`, `dompurify` (all non-major) and **`sharp` (needs a MAJOR bump)**. Owner asked whether to do the safe ones and leave `sharp` — **awaiting his answer** |
| **P12** | Admin Security Audit panel | not started — substantial new feature |
| **P7** | Two `App.tsx` fetch settings | not started |
| **P11** | Security gate blocking the Android build | **must ride with 1060** — editing the workflow fires a build by itself |
| **P10** | 2 judging tests | the only 2 red tests left. Judging is flagged dangerous — needs him |
| **P9** | Cache persistence | needs a security review (shared phones) |
| — | Hosting: a missing `/assets/*` must return 404, not the homepage | open since 5 August |
| — | Hand-test the app with a finger | nobody has, 1055–1059 |

---

## TRAPS LEARNED TODAY — read before repeating them

1. **The sandbox's `tsc` reports 3 errors that CI does not**
   (`useAdminEntryOverride.ts:27`, `useNotificationPreferences.ts:124` and `:130`).
   They come from installing dependencies off the public registry instead of the
   pinned lockfile. Proved by running `tsc` on an unmodified `main` in the same
   sandbox and diffing — byte-identical output. **CI is the authority. Do not
   "fix" those three.**
   `bun install --frozen-lockfile` fails here (403 on the private mirror). The
   workaround is: move `bun.lock` aside, `BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun install`,
   then **restore `bun.lock` AND `bun.lockb` from HEAD before committing.**

2. **A source-scanning test will flag its own documentation.**
   `textSizeFloor` flagged a size named in its own comment; the ProfilePhotoPrompt
   rewrite matched a "REMOVED — DO NOT BRING THIS BACK" note; the PostCard test
   matched prose explaining what `md:flex-1` used to do. **Strip comments before
   asserting, every time.** Same trap the mojibake scan fell into.

3. **`flex-1` does not make equal columns when the items have different padding.**
   Measured 107 / 131 / 131 at 390px. `basis-1/3` is a percentage of the row, so
   border-box padding sits inside it: 123 / 123 / 123.

4. **A JSX comment cannot be the first thing inside `{cond && ( … )}`** — it is a
   second child and esbuild rejects the file. Caught by the build, not by vitest.
   **Run `npx vite build`, not just the tests, after editing JSX.**

5. **Two connected Chromes are two different logins.** Reading
   `meta[name="user-login"]` in the wrong one produced a confident, wrong claim
   about the owner's account. See `BROWSER_AND_ACCOUNTS.md`.

---

Everything marked done above was measured before and after, mutation-checked
where it was code, and byte-verified against `origin/main` with
`git show origin/main:<path> | cmp -s - <path>`. Everything marked pending has
not been begun. **No claim on this page is an inference.**
