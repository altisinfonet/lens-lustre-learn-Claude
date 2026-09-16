# CURRENT STATE — 2026-08-14

**If you are a second session picking this project up, read this page before
touching anything.** It is the shortest true summary; the detail is in the
`HANDOVER_*` docs.

---

## Where things stand right now

| | |
|---|---|
| `origin/main` | **`6cb095d`** — working tree clean, nothing half-done |
| Web | Deploys from `main`, so the web already has everything below |
| Android in Play | **1073 / v1.2.2** — this is what users have |
| Android halted | **1086 / v1.2.4 — HALTED. Never ship it.** |
| Android ready | **1088 / v1.2.5 — green, artifacts waiting for the owner** |
| Test suite | **1,345 passing**, 1 skipped |
| Security audit | 0 critical / 0 high |
| **Newest APPLIED migration** | **`20260814042609 email_queue_authority`** ⚠ see below |

Build 1088: https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31772341968
Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.85 MB) · `app-release-aab` (8.42 MB)

⚠ **Only the owner uploads builds to Play.** Never touch the keystore, its
passwords, or the Play service-account JSON.

---

## ⚠ THE DATABASE HAS MOVED AHEAD OF THE REPO

A **second session applied a production migration on 2026-08-14** that the
`docs/` handover does not mention. Do not plan SQL without reading this.

| | |
|---|---|
| Applied | `20260814042609 email_queue_authority` |
| What it did | `enqueue_email` and `read_email_batch` were SECURITY DEFINER, executable by `anon` and `authenticated`, with no authorization check. Both are now `service_role` only, and both allow-list the queue name. |
| Verified after | `anon=false authenticated=false service_role=true postgres=true` on both |
| Rollback | `supabase/rollback/20260814042609_email_queue_authority_ROLLBACK.sql` — **local only, not yet on GitHub** |
| Repo status | The migration file is committed **locally** and has **not** been transported to GitHub |

**So `supabase/migrations/` on GitHub is one migration behind production.** A
session that trusts the repo alone will think the newest migration is
`20260813171159`. Always confirm with `list_migrations` before writing SQL.

Root cause worth knowing: `ALTER DEFAULT PRIVILEGES` grants EXECUTE on **every**
function created in `public` to `anon` and `authenticated`. An earlier migration
(`20260322151646_email_infra.sql:193-199`) had already revoked both functions
correctly; it did not hold, because `REVOKE … FROM PUBLIC` does not remove a
grant held by a *named* role. **Every new SECURITY DEFINER function is
anon-callable the moment it is created unless you revoke it by name.**

---

## There is now a CONTROL protocol — use it

Three files in the repo root (local commits, not yet on GitHub):

- `AI_CONTROL.md` — machine-readable front-matter: phase, state, base commit,
  applied migration, next action, approved hash. **It is configuration, not
  truth.**
- `AI_EVIDENCE.md` — append-only, one line per check, command + result.
  Claims are not evidence; re-runnable commands are.
- `scripts/ai-control.mjs` — `node scripts/ai-control.mjs` re-derives state from
  git and prints `READY` / `DRIFT` / `BLOCKED`. **When the machine disagrees with
  the file, the machine is right.**

Standing rule that matters most: **discovering something adjacent is not
authorisation to fix it.** Stop, record evidence, ask. That rule is what caught
a second, more serious exposure during the migration above.

`origin/main` moved **four times** during a single session on 2026-08-14
(`8259c5b` → `86afb8d` → `f8c1985` → `c7c591b` → `6cb095d`). Re-run the
reconciler before trusting any earlier measurement.

---

## Open findings — detail is in the private project, not the public repo

The repository is **public** (`git ls-remote` succeeds with no credential).
Do not publish anything describing an unfixed vulnerability.

Four findings are open and written up in
`claude/AI_CONTROL_PROTOCOL_AND_STANDING_AUTHORITY.md`: the default-privilege
root cause (**132** anon-reachable SECURITY DEFINER functions remain), a frozen
2026-05-12 security baseline holding 259 HIGH findings that a green gate does
not read, post media being publicly fetchable regardless of `posts.privacy`,
and four advisor ERRORs.

Also in the private project: the full forensic audit
(`POST_REMEDIATION_FORENSIC_AUDIT_2026-08-13.md`), the approved architecture
(`ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md`), the Phase 0 design review, and
`M2_PREFLIGHT_2026-08-14.md`.

---

## Why 1086 was halted, and what 1088 fixes

**1. `+ Create` was in the middle of the app top bar, over the wordmark.**
The cause was layout, not a coordinate: the bar is `justify-between`, and in
the app the logo `<Link>` collapses to zero width because its image and
wordmark are both `hidden lg:*`. Three flex children with a zero-width first
one spread as `[nothing] … [+ Create] … [actions]`.
Fixed by putting the logo and the button in **one wrapper** = one flex item.
Measured in a headless render: 24px from the edge, ends at 61px, wordmark
starts at 69px. The "Create" caption is gone — icon only, name on `aria-label`.

**2. Verified members showed no blue tick** — tagged names *and* post authors.
Checked against production first: the badge row exists, RLS is
`"Anyone can view badges" USING (true)`, and a real anonymous REST call returns
it. The data was fine and the component was fine; the **lookup between them**
was the problem. The tick came from a second, per-name request fired at render
time, while the query that built that line had already fetched those profiles
*with their badges* and thrown them away. `author_badges` had been computed by
every feed/wall/hashtag query for months and no caller read it.
Fixed by carrying badges **on the post**, the same correction as the
"names showing as ?" fix.

---

## The two lessons that cost the most, stated plainly

1. **A fix was reported as done because the code changed.** The tagged-name
   test asserted names and counts and said in its own comment that it did *not*
   depend on the badge resolving. A verified member and a broken tick produced
   identical DOM. → **Assert the claim.** There are now 5 tests that check the
   tick in the DOM, one with the lookup forced to return nothing.
2. **A layout claim shipped without a measurement.** → Render it and measure it
   before saying it is fixed.

Both are written up as traps #12–#15 in `HANDOVER_2_KNOWN_TRAPS_READ_FIRST.md`.

---

## What to do next

1. **Nothing ships until the owner has tested 1088 on a phone.** The debug APK
   is on the run page for exactly that. Checklist:
   `+ Create` in the left corner clear of the wordmark · the tick on a verified
   member **as author AND as a tagged name** in "with X" · hard scroll and back
   with no blank cards or scroll jump · comment typing · a like moving by
   exactly one.
2. **Transport the two local SQL files to GitHub** so the repo stops being a
   migration behind production.
3. Then the backlog. The **image derivative pipeline** is the next large item —
   read trap #1 before touching any image URL; a previous attempt broke every
   photo for four days. The approved design is in
   `ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md`, and it supersedes the older
   `image_meta` approach, which was **withdrawn**.
4. The **Instagram-style in-app photo picker** is confirmed wanted and **has
   not been started**. The picker screens are unchanged in every build so far.
   Do not describe it as done or partly done.
5. **Resumable uploads** have not been started either.

## If two sessions are running at once

`main` moves through the GitHub web upload page, not `git push` (403 — the
repository is not in the session's authorised set). Before you transport
anything, `git fetch origin main` and rebase — another session may have moved
it. Always finish with `git diff --stat HEAD origin/main` empty.

⚠ The upload page **silently drops `.github/` paths** — 9 dropped, 8 uploaded,
no error shown. Verify every file with `git hash-object` against
`git rev-parse origin/main:<path>` afterwards.
