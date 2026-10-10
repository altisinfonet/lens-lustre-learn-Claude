# ▶ RESUME HERE. Paused 2026-08-06 evening.

**`main` = `245d5e5`. Nothing is half-applied. Nothing is uncommitted.**
Read this first, then `STATE_2026-08-06.md` for anything older.

---

## THE THREE THINGS WAITING ON A HUMAN

**1. Install and test build 1056.** Built, signed, green (Android Build run
#56, 4m 22s, artifact `app-release-aab`).
`github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31107423439`

The first check is the account sheet: it must read **`V1056 (1.2.2)`** with the
version on the LEFT and Logout on the RIGHT. If it does not, it is an older
build and nothing else tested means anything.

Then SPEC_1055 §6: the app itself cannot pinch-zoom · a photo opened fullscreen
CAN · feed and comments never scale · tapping a feed photo opens it fullscreen
(it never did before 1055). **None of this has ever been touched by a finger —
the sandbox has no touchscreen.**

**2. Post one comment on the live site.** Ten seconds. Confirms the
deleted-account lock did not affect real members. It was proven logically —
`account_is_live()` returns true for every live member — but a write to
production to demonstrate it was blocked by a safety classifier, so it is
reasoning rather than observation.

**3. Upload 1056 to Play** when happy. "What's new" is exactly
`Bug fixes and improvements.`

## THE ONE UNFINISHED FIX

`seo-route-metadata` — a draft competition's title, description and dates are
readable by guessing its slug. **Fixed in code (`3aaf58d`), NOT deployed.**

Edge functions do not auto-deploy from git here. The Supabase dashboard's Edge
Functions pages were stuck on skeleton loaders with "Deploy status unavailable"
and the deploy button greyed out, across five attempts.

**Diagnosed, and it is not your project's fault:** the functions themselves are
healthy — `https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/sitemap`
returns correct live XML. It is the dashboard's management API that was not
answering. Members are unaffected.

To land it: retry the dashboard (Edge Functions → `seo-route-metadata` → Code →
Deploy), or `supabase functions deploy seo-route-metadata` from the CLI.
**The CLI needs a personal access token, which is a credential — the owner
types it, never the assistant.**

## WHAT WAS FINISHED TODAY

| | |
|---|---|
| **Deleted accounts can write** | **Nowhere.** 0 of 97 tables. 291 guard policies, 356 original policies untouched |
| **jsPDF critical** | Closed — 4.2.0 → 4.2.1 |
| **`npm ci`** | Repaired. It had been silently failing on `main` all day and falling back to `npm install` |
| **Security gate** | Live, on every push, and **passing**: 0 critical, 0 high |
| **Web** | Live on `2026-08-06-11` |
| **Cloudflare deploy** | Unblocked — it had been failing since 1055 on a frozen bun lockfile |
| **Build 1056** | Built and signed |

Commits: `db225de` · `ca57eeb` · `0d833f6` · `9638b70` · `a4118c7` · `677e10e`
· `3aaf58d` · `3a90890` · `e150b78` · `245d5e5`

## NEXT WORK, IN THE ORDER RECOMMENDED

1. **Deploy `seo-route-metadata`** — the last open finding.
2. **Admin Security Audit panel** — the owner chose this; not started. RLS
   census, always-true policies, SECURITY DEFINER without a role check, missing
   foreign keys. Sits beside `JudgingInvariantsAudit` and `CollusionAudit`.
3. **15 high production dependency issues** — then ratchet the gate in
   `security.yml` from `critical` to `high`. The TODO is written in the file.
4. **Make the gate block builds** — requires editing `android-build.yml`, which
   is **inside its own trigger paths**, so that edit FIRES A BUILD by itself.
   Bundle it with the next intentional build, never on its own.
5. **25 stale tests** — they pin rules the owner deliberately removed, so they
   can no longer warn about those areas. Owner chose to ship first, clean later.
6. **Bug 3** — `src/App.tsx:180`, `refetchOnWindowFocus: false` + 5-minute
   `staleTime`. Two lines, but it changes fetch behaviour for every member on a
   free-tier database. Do it early in a session so it can be watched and
   reverted.

## 🛑 TRAPS — read before touching these

- **Do not "fix" `judge_decisions_owner_safe`.** It bypasses RLS *by design*
  and replaces it with "only published rounds" — the Locking ≠ Declaring rule.
  Setting `security_invoker = on` blanks results for every participant. Full
  reasoning in `SECURITY_GATE_AND_FALSE_ALARMS.md`.
- **Push the dependency commit FIRST.** In the 1055 push, `package.json` went
  last and left 11 intermediate commits unbuildable — 11 red CI runs, and it
  also broke the Cloudflare deploy.
- **`package.json` and `bun.lock` travel together.** Cloudflare runs
  `bun install --frozen-lockfile`; a mismatch fails the web deploy outright.
  This is what broke the site for several hours today.
- **`versionCode = 1000 + run_number`.** The number is decided by the run, not
  by us. A cancelled or superseded run still consumes its number — that is why
  1055 was discarded and 1056 shipped.
- **A committed `.env` here is NOT a breach** — it holds only the project URL
  and the anon key, both public by design.
- Other validated false alarms are listed in `SECURITY_GATE_AND_FALSE_ALARMS.md`.
  Check there before acting on any scanner output.

## DELIVERED TO THE OWNER

- `50mm-error-code-reference.docx` — all 72 codes, what each means, what to do,
  and the exact function and file it fires from.
- `50mm-security-audit.docx` — the full audit.
