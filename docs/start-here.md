# START HERE

**50mm Retina World** — a photography social platform. This is a **LIVE site and
a LIVE Android app**. Read this file before doing anything else.

`origin/main` = **`c7c591b`** (2026-08-14). Working tree clean, nothing
half-done.

⚠ **Build 1088 / v1.2.5 is cut, green and waiting for the owner to upload.**
Build 1086 was **halted in Play** — do not ship it. See
`status-done-and-remaining.md`.

---

## The four other files, and when to read each

| File | Read it when |
|---|---|
| [`known-traps-read-first.md`](known-traps-read-first.md) | **Before writing any code.** Things that have already broken production once. |
| [`how-to-ship-code-and-sql.md`](how-to-ship-code-and-sql.md) | Before trying to get anything to GitHub or the database. `git push` does not work here. |
| [`status-done-and-remaining.md`](status-done-and-remaining.md) | To find out what is finished and what to pick up next. |
| [`architecture-and-cto-verdict.md`](architecture-and-cto-verdict.md) | To understand the stack, and before anyone proposes a rewrite. |

Deeper session-by-session detail lives in the claude.ai project under `claude/`.
**These five files in `docs/` are the canonical handover** — if they and a
project doc disagree, these win.

---

## What this product is

- **Web + Android from one codebase.** React 18 + TypeScript + Vite, Supabase
  backend, Cloudflare Pages hosting, Capacitor wrapping the same `dist/` build
  into the APK. No iOS yet.
- **Owner-run.** The owner reviews all SQL, and only the owner uploads App
  builds to Play.
- Verdict from the 2026-08-13 forensic audit: **right architecture, do not
  migrate to React Native or Flutter.** Reasoning in
  `architecture-and-cto-verdict.md`.

## Standing rules — these are not negotiable

- ❌ **No guesswork. No assumptions. No hidden operations. No auto-fix.**
  Read the actual code or query the actual database. Say "I checked X" or say
  "I do not know".
- ❌ **No REELS and no LIVE anywhere in this product.** Written into
  `WallPosts.tsx` because it has been re-suggested more than once.
- ❌ **Never report something as done because the code changed.** Twice now a
  change was reported as shipped on the strength of a green suite that did not
  assert the thing claimed. Check the rendered result, the live row, or the
  real request — then say what you checked.
- 🔒 **Never handle the upload keystore, its passwords, or the Play
  service-account JSON.** Those are the owner's alone.
- 🧪 **Every change passes the full gate before it ships**: `npx tsc --noEmit`,
  `npx vitest run` (1,345 tests), `npm run build`, and
  `node scripts/security-audit.mjs` (must be 0 critical / 0 high).
- 📝 **Comment the WHY, not the what.** This codebase explains the reasoning and
  the incident behind non-obvious code. Match that. A future reader must be able
  to tell a deliberate choice from an accident.

## The one habit that matters most here

Several bugs in this codebase survived for weeks because a test passed against
the wrong thing — a superseded migration file, a source string that no longer
ran, a role name that did not reflect what the client actually receives.

**Verify against the thing that actually runs.** Query production. Fetch the
real endpoint. Diff the deployed file. "It should work" has cost this project
more than any other sentence.
