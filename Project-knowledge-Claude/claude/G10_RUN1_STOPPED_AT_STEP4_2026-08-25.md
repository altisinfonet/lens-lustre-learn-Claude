# G10 · Run 1 — STOPPED at §12.4 step 4 (migration reconciliation)

**Date:** 2026-08-25 · **Outcome:** promotion NOT performed. One hard stop found, plus three
owner-only conditions that were already open. Nothing was changed on production or on `main`.

---

## 1. §12.4 step 2 — CAPTURE (complete)

```
staging commit  6d6aa6c63248a39d25616b3e4277d5f565d185b2
staging tree    3515b9a62e72ee5cdc56cac4cf2f3987930960f7
main commit     32930e75b1d87d361f44e4b4f90dabf9deeda3e1
main tree       a0c3f34d724867f0a10fc768f6987e21fd4ddbfa
merge base      32930e75b1d87d361f44e4b4f90dabf9deeda3e1
```

**Merge base equals `main`.** `staging` is a clean linear descendant; `git rev-list --count
origin/staging..origin/main` = **0**. No divergence, so the promotion is a fast-forward-shaped
merge and §12.1's tree identity is achievable.

16 commits, **100 files**, +3252 / −317.

## 2. §12.4 step 3 — CLASSIFY

**Lane-sensitive files were the priority, and they classify SAFE:**

`public/robots.txt` and `public/sitemap.xml` now ship a `__SITE_ORIGIN__` **placeholder** rather
than a hard-coded origin. Substitution happens in `scripts/generate-seo-assets.mjs`, which is in
`npm run build` — the Pages build command. The lane is identified by `VITE_SITE_ORIGIN`, which
`lane-config.mjs` **defaults to production when unset**.

That default was queried during G9 and deliberately left in place. This step is where that
decision pays: had it been removed as the audit recommended, a production Pages project without
`VITE_SITE_ORIGIN` would have been classed non-production and shipped `User-agent: * / Disallow: /`
to the live site. Proven, not reasoned — built with the variable **unset**:

```
generate-seo-assets OK: 2 files; origin=https://50mmretina.com
dist/robots.txt   ->  "User-agent: Googlebot / Allow: /"        INDEXABLE ✅
dist/sitemap.xml  ->  <loc>https://50mmretina.com/</loc>        correct origin ✅
generate-headers  OK: 12 rules, 25 headers; cdn=cdn.50mmretina.com
generate-redirects OK: no rules emitted
```

`12 rules` matches the live production deploy log's `Parsed 12 valid header rules` — the headers
artifact is unchanged for production.

**No staging literals reach the shipped tree.** The only matches for `staging.50mmretina.com` /
`cdn-staging` / the staging ref are comment lines inside `verify-bundle-isolation.mjs` explaining
substring matching. Nothing in `src/`, `functions/`, `public/` or `index.html`.

## 3. 🛑 §12.4 step 4 — RECONCILE MIGRATIONS · **HARD STOP**

The promotion carries an **unapplied** migration:

```
supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql
supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql
```

It creates `public.admin_search_users_v2`. Reconciled against the production ledger:

```
production public.admin_search_users%  ->  admin_search_users(search_query text, search_by text)
                                           ONLY. No _v2.
```

And the promoted frontend calls it unconditionally — `src/components/admin/AdminUsers.tsx:271`:

```ts
"admin_search_users_v2", { _query, _by, _role, _badge, _limit, _offset }
...
if (error) { toast({ title: t("au.searchFailed"), … }); setLoading(false); return; }
```

**There is no fallback to v1.** Promoting this tree without first applying the migration means the
production Admin → Users list returns a PostgREST "function not found" error and renders empty, for
every admin, immediately on merge.

§12.4 step 4 is explicit: *"Never execute a production migration merely because its file exists on
main."* So this cannot be resolved by letting the merge imply the migration. It is an **ordering**
requirement, and it must be decided before PROMOTE.

**Recommended resolution — no code change, no improvisation:**

1. Promote the tree (steps 9–11).
2. **Immediately** dispatch `apply-migration.yml` with `target=production`, `migration=`
   `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql`, dispatched from
   `main` (the workflow's lane gate requires `main` for `target=production`, and the file only
   exists there after the merge).
3. Re-check Admin → Users before announcing the release.

The exposure window is minutes, on an admin-only surface, with a committed rollback file on hand.
The alternative — cherry-picking the migration to `main` ahead of the promotion — buys a smaller
window at the cost of an extra unrelated commit on `main`, which §12.3 forbids.

**This is the owner's call, not mine.** It was not taken in this run.

## 4. Verification completed on the promotion tree

| check | result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Full Vitest suite | **168 files passed, 1 skipped · 2327 tests passed, 0 failed** |
| Mutation harness (§17 check 5) | **21/21 mutants held** |
| SEO harness | **15/15 killed · HARNESS PASS** |
| Isolation guard, **production lane, host rules active** | **PASS** — expected `jtdtehuqtinjxropkkcn` present; forbidden `ztzutckwdhetphwghuzj` absent; host `cdn.50mmretina.com` present; forbidden hosts absent; **385 assets across 3 roots** (dist, functions, supabase/functions — R13 active); 6 lines exempted |

Note against §17 check 4: these are **local runs on the promotion tree**, not CI runs with run IDs.
The checklist asks for both lanes "named by run ID, with job-level results". That still requires a
GitHub Actions run this session cannot trigger.

## 5. §12.4 step 6 — PRODUCTION PRE-RELEASE BASELINE (captured 2026-08-25)

```
tables                 146        buckets              11
public RLS policies    686        cron jobs            16
public RLS fingerprint 41fe03acce3f598267061e61faebd0c6
storage RLS policies    42        site_settings        35
auth.users             103        posts               278
judge_decisions          0        judge_tag_assignments 0
s3 bucket              50mm
```

`auth.users` 102→103 and `posts` 277→278 since the G9 capture. Per §8.10's rule, organic drift on a
live site is not a regression. Recorded so the §18 post-release comparison has a real baseline.

## 6. Conditions that remain OPEN and are not mine to close

| §17 | condition | status |
|---|---|---|
| 3 | **§5.3 secret-isolation re-test** | ⛔ **never executed at all** (§19: OPEN). §12.4 step 7 says explicitly *"Run §5.3 now, for this RC. Do not inherit G3's evidence."* It needs a push to a throwaway branch and a workflow run — §19 records that this session can neither push nor delete a branch. |
| 7 | Branch protection on `main` active | ⛔ **OWNER-ATTESTED by definition** — §17 states it "cannot be read by this session". A `main` rule exists (owner screenshot); its contents were unreadable to the code session (`Resource not accessible by integration`). Owner must attest at the moment of promotion. |
| 10 | Owner approval (§11), naming the tree | ⛔ not recorded. Must name tree `3515b9a6…`, signed **before** the merge. |
| 4 | Guard passes on both lanes, named by CI run ID | 🟡 passes locally on both lanes; CI run IDs not obtainable this session. |
| 9 | Rollback target identified and itself verified | 🟡 the natural target is `main` @ `32930e75…` / tree `a0c3f34d…`, currently live and serving. Not yet recorded as a verified rollback target in the §11 record. |
| 11 | TAG · PROMOTE · VERIFY tree identity | ⛔ requires push rights this session does not have. |

## 7. State at stop

Nothing was promoted, tagged, merged or applied. `origin/main` unchanged at
`32930e75b1d87d361f44e4b4f90dabf9deeda3e1`. Production database untouched — the only production
access this run was read-only fingerprinting. No cleanup was attempted: Node/bun/npm, `svgo`,
branch aliases and the stale `Main` rule were all left alone as instructed.

**G10 = BLOCKED at §12.4 step 4.** The exact failure: `admin_search_users_v2` is required by the
promoted frontend and does not exist in the production database.
