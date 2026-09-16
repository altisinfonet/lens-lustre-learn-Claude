# RESUME HERE — 2026-08-10 midday. Paused by the owner, ~30 min break.

`main` = **`8b5cab6`** · CI on that commit: **Typecheck ✅ Security ✅** ·
web live · **app on 1059 (LIVE on Play)**
Test baseline **986 pass / 6 fail** — the same 6 as this morning
(4 `ProfilePhotoPrompt`, 2 judging). **Zero new failures.** 7+ means you broke
something.

**Nothing is half-applied.** Every commit below is byte-verified against
`origin/main`. The one unfinished item (N4 part 2's SQL) has not been started at
all, and its client half is deliberately inert without it.

---

## THE FIRST THING TO DO WHEN HE COMES BACK

**Run the N4 part 2 SQL.** He signed in to Supabase right before the pause and
the SQL editor had not finished loading. Everything else for that item is
already live.

The exact statement to paste into the SQL editor is the whole of
`supabase/migrations/20260810120000_bell_actor_known.sql`, which is already on
`main`. It is a `DROP FUNCTION` + `CREATE FUNCTION` pair — **run them together
in one go**, so there is no moment where the bell calls a function that is not
there.

**Measure first** (read-only, run this before the change):

```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_unread_notifications_grouped') as fn_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_unread_notifications_grouped'
      and pg_get_function_result(p.oid) like '%actor_known%') as already_has_column,
  (select count(*) from public.user_notifications x
    where x.actor_id is not null
      and not exists (select 1 from public.profiles pr where pr.id = x.actor_id)) as rows_whose_actor_is_deleted;
```

Expect `fn_count 1`, `already_has_column 0`, and ~35 on the third.
**After** the change, `already_has_column` must be 1 and the third number must
be unchanged — this migration rewrites a function, it must not touch a row.

Then re-run the measurement and check the bell on the live site.

---

## WHAT WAS DONE THIS SESSION — 2 items, both measured

### 1. N4 part 2 — "A deleted account" · CLIENT HALF LIVE, SQL HALF NOT STARTED

Four commits, all byte-verified:

| Commit | File |
|---|---|
| `85f300a` | `src/lib/notifications/adapters.ts` — reads `actor_known` off the grouped row |
| `1551343` | `src/lib/notifications/__tests__/describe.test.ts` — 3 new tests |
| `045e132` | `src/hooks/notifications/useNotificationsQuery.ts` — the type |
| `8edc307` | `supabase/migrations/20260810120000_bell_actor_known.sql` — the record |

**Two of the three new tests FAIL on `23a5018` and pass on the new code** —
verified by reverting `adapters.ts` alone and watching them go red with the
right messages. The third ("undefined is not false") passes both ways on
purpose: it pins that the **history page**, whose RPC does not answer this
question, keeps saying "A member".

**Why nothing changed for members yet, and why that is correct:** the client
now asks the database a question the database cannot yet answer.
`row.actor_known` comes back `undefined`, `known` stays `undefined`, and
`actorDisplayName()` renders exactly today's wording. There is no broken
intermediate state and no rush.

**The SQL was not typed in.** Three edits, already written out in the migration
file: `(p.id IS NOT NULL) AS profile_exists` in `actors_ranked`,
`array_agg(ar.profile_exists ORDER BY ar.rn)` in `actors_top`, and
`actor_known boolean[]` in `RETURNS TABLE` + the final SELECT.
It is a DROP-and-CREATE, not a `CREATE OR REPLACE`, because **Postgres refuses
to change the return type of an existing function**. The SIGNATURE is unchanged
— still `(int, text[])` — so no ambiguous overload is created and builds
1055–1059 keep calling the same function. An extra column in the result is
ignored by a client that does not read it.

### 2. P8 — the readability floor · LIVE ON WEB, VERIFIED ON PRODUCTION

Owner was asked and chose, 2026-08-10: **nothing below 12px**, and
**include line spacing, 1.34 → 1.45**.

| Commit | File |
|---|---|
| `fd2dab1` | `src/index.css` — the floor block + body line-height |
| `8b5cab6` | `src/__tests__/textSizeFloor.test.ts` — the tripwire |

**Measured before:** source held **2,591** sub-12px places across **246 files**
— 10px ×1137, 9px ×928, 11px ×277, 8px ×203, 7px ×39, 8.5px ×3, 10.5px ×2,
6px ×2. Counted by property, not by hand.

**Done as ONE CSS block, not 2,591 edits.** Rewriting 2,591 class names in 246
files is the bulk modification this project forbids, and every file would have
needed re-verifying. This is one rule in one file; undoing it is deleting the
block.

**Proved in a real browser, against the real production bundle** (Chromium via
Playwright on `dist/assets/index-*.css`): 6/7/8/9/10/11px all compute to
**12px**; 13px, 14px and 24px untouched; and at 1280px wide the responsive
sizes still win (`md:text-[40px]` → 40px, `md:text-[13px]` → 13px), so nothing
got *smaller* anywhere.

**Proved again on the live site** (`/login`, the only page reachable signed-out):

| | before | after |
|---|---|---|
| visible text elements under 12px | **6 of 12** | **0 of 12** |
| sizes present | 8px, 10px ×5, 12px ×4, 30px ×2 | 12px ×10, 30px ×2 |
| body line-height | 18.76px (**1.34**) | 20.3px (**1.450**) |
| elements with clipped text | 0 | **0** |

**The test is not a fixed list.** It re-derives every sub-12px class from the
source on each run and fails naming the file and use-count if the CSS misses
one — so `text-[5px]` written next month goes red instead of shipping.
**Mutation-checked three ways:** removed the 9px selector (red, and it named
"928 uses in 158 files"), put line-height back to 1.34 (red), lowered the floor
to 10px (red). Restored → green.

**WATCH FOR THIS:** badges, tab labels and counters are bigger now. If any label
wraps to a second line, that is a **layout fix in that component** — do NOT
lower the floor to hide it.

---

## THE SANDBOX TRAP THAT COST TIME TODAY — read before trusting a local `tsc`

`bun install --frozen-lockfile` **fails in the sandbox**: `bun.lock` pins
resolved URLs on a private `europe-west*-npm.pkg.dev` proxy that returns 403.
The workaround used today: move `bun.lock` aside, `BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun install`,
then **restore `bun.lock` AND `bun.lockb` from HEAD before committing anything**.

The consequence: **local `npx tsc` reports 3 errors that CI does not** —
`useAdminEntryOverride.ts:27`, `useNotificationPreferences.ts:124` and `:130`.
They come from the differently-resolved dependency, not from the code. Proved by
running `tsc` on an unmodified `main` in the same sandbox and diffing: byte-identical
output. **CI is the authority. Do not "fix" those three.**

---

## NEXT WORK, IN THE OWNER'S OWN ORDER

1. **N4 part 2 SQL** — see the top of this file. *(in progress, not started)*
2. **N4 part 3** — stop nulling `actor_id` on deletion.
   `supabase/functions/delete-my-account/index.ts:138` and
   `supabase/functions/delete-user/index.ts:127`, both
   `.from("user_notifications").update({ actor_id: null }).eq("actor_id", user_id)`.
   Delete those two calls. **Edge functions do NOT auto-deploy — hand-deploy
   each in the dashboard.** These files are the P0 deleted-account security fix
   of 2026-08-06; nothing else in them may change, and **re-test deletion after**.
3. **N3** duplicate skeleton after posting — *started, no root cause established.*
   What is known so far: `PostCardSkeleton` renders in three places —
   `Feed.tsx:281` and `WallPosts.tsx:1189` (`loading`, ×3) and
   `WallPosts.tsx:1233` (`loadingMore`, ×1). `InfiniteScrollSentinel` is passed
   `hideLoader`, so it should not be adding a second one. **Not reproduced** —
   it needs a signed-in session to post. Do not write the fix before seeing it.
4. **P4** 15 production dependency vulnerabilities — `package.json` + `bun.lock`
   in ONE commit, first thing. Cloudflare builds `--frozen-lockfile`; split them
   and every deploy dies.
5. **P5** 4 red ProfilePhotoPrompt tests · **P6** `package-lock.json` (13
   packages) · **P12** Admin Security Audit panel · **P7** two `App.tsx` fetch
   settings.
6. **Then 1060 — and P11, the security gate, MUST ride with it.** Editing
   `.github/workflows/android-build.yml` fires a build by itself, so it cannot
   be done separately. `versionCode = 1000 + run_number`; 1059 was run #59.

## STILL WAITING ON THE OWNER

* **Do photos look sharp on 1059?** He installed it this session and said he
  would report back. **Still unanswered.** It is the one unverified thing in
  1059. If soft, it goes to the front of the queue — it is display-side and
  fully reversible.
* **Hand-test the app with a finger** — nobody has, 1055–1059.
* **Post one comment on the live site.**
* **Hosting: a missing `/assets/*` must return 404, not the homepage.** Open
  since 5 August.
* **P9** cache persistence (needs a security review — shared phones) ·
  **P10** 2 judging tests (judging is flagged dangerous).

## BROWSER NOTES FOR THE NEXT SESSION

* Two Chromes are connected. The owner uses **Browser 1**
  (`621b9907-3118-4d98-a9bc-c13a35663e0a`). The Chrome profile is
  `mr.neilbasu`; the **GitHub account inside it is `altisinfonet`** — that is
  not a mismatch, it is correct.
* He is **not signed in to `50mmretina.com`** in that browser — `/feed`
  redirects to `/login`. Anything needing a signed-in page (N3, the bell) needs
  him to sign in first.
* The Supabase SQL editor's Monaco **never mounts while the tab is in the
  background** (`document.hidden === true` → `monaco.editor.getModels()` stays
  empty). Close the other tabs in the group, or ask him to bring it to the
  front, before trying `setValue`.
* GitHub upload route works exactly as `NEXT_RELEASE_RUNBOOK.md` describes.
  Set the commit message with the native value setter on `#commit-summary-input`
  (the FIRST box), screenshot before clicking **Commit changes**, then
  `git show origin/main:<path> | cmp -s - <path>`.
