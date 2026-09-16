# Build 1062 — cut and green. 2026-08-10, late.

`main` = **`32c7249`** · Android Build **#62** ✅ (4m 48s, 1 artifact) ·
Typecheck **#610** ✅ · Security **#98** ✅ · web live.
**versionCode 1062** (1000 + run number). **Waiting on the owner to upload it to Play.**

Predecessor: 1061 is LIVE on Play. Nothing in this build reverts anything in it.

---

## What went in AFTER 1061

| # | What | Commit | Proof |
|---|---|---|---|
| **N4 pt 3** | Deleting an account no longer erases who sent a notification | `eaff538` `2a6c001` `8664ea2` + **both edge functions hand-deployed** | See below — this is the only item that needed a deploy outside git |
| **P7** | Returning to the app now refreshes what changed | `fe9eb63` | Live bundle read back from production: `defaultOptions:{queries:{staleTime:300000, gcTime:600000, refetchOnWindowFocus:!0, retry:1}}` |
| **P11** | **The security gate now blocks the Android build** | `32c7249` | Run #62 shows two jobs: `Security gate (blocks the build)` 12s ✅ → `build-aab` 4m30s ✅. The arrow is the gate |

Gates before each commit: typecheck clean, **1033 pass / 2 fail** (the same judging
pair, P10 — 3+ failures means something broke), `npx vite build` ✅,
`node scripts/security-audit.mjs` → CRITICAL 0 · HIGH 0 · MEDIUM 2 · LOW 2 PASS.

---

## N4 part 3 — how the edge functions were deployed, and how it was proved

Edge functions do **not** deploy from git. Both were deployed by hand through the
Supabase dashboard code editor, and this is the method that worked — record it,
because the naive one is dangerous:

1. Read the LIVE code out of the dashboard's Monaco model
   (`document.querySelector('.cm-content')` is GitHub; Supabase exposes
   `window.monaco.editor.getModels()[0]`).
2. Strip comments, collapse whitespace, **SHA-256 both sides**. The live code and
   the repo file hashed IDENTICALLY once the one offending line was removed —
   `87aa26a2…` for `delete-my-account`, `791ec781…` for `delete-user`. That
   proved there was **zero drift** between the deployed function and the
   repository, so a surgical one-line removal was safe and a 10 KB paste
   (which can silently mistype) was unnecessary.
3. Remove exactly that line with a Monaco edit, re-hash, confirm the match,
   then Deploy.
4. **Reload the page and hash again**, so the check reads what the SERVER now
   returns rather than what was typed into the box. Both came back
   `actor_id: null` absent and hash-equal to the repo.

Deployed lines removed:
* `delete-my-account/index.ts` line 138 (last element of a `Promise.all` array —
  the trailing comma left behind is valid).
* `delete-user/index.ts` line 127 (a standalone `await` statement).

**Still to do:** delete a throwaway account end-to-end and confirm the bell then
reads "A deleted account". The mechanism was verified on production before the
change (zero foreign keys on `user_notifications`; no database function writes
`actor_id`), so nothing else can put the null back — but nobody has watched a
real deletion since.

## P11 — what the gate actually is

`android-build.yml` gained a first job, `security-gate`, and `build-aab` gained
`needs: security-gate`. A red gate means **`build-aab` never starts**, so no
`.aab` exists to sign or upload by accident.

It runs `scripts/security-audit.mjs` and nothing else, deliberately: that script
uses only Node built-ins, so a broken or unfetchable dependency cannot stop it
running — which is exactly when a gate matters. Secrets-over-full-history and the
production dependency audit already run on **every** push in `security.yml`;
repeating them here would add minutes to every build and gate the phone release
on a threshold that is still being ratcheted down.

### How the workflow file was edited safely — this is the part to copy
GitHub refuses workflow files through the "Upload files" UI, and the CodeMirror
route has broken `main` here before. What worked, with no typing into the editor
at all:

* `document.querySelector('.cm-content').cmTile.view` **is the CodeMirror 6
  EditorView** on GitHub's edit page. (`cmView`/`__cmView` are not.)
* Hash the editor's document first and compare it to the repo file — it matched
  `4e99ec31…`, proving the editor held exactly what git holds.
* Build the target file **locally**, validate it (`yaml.safe_load`, check
  `jobs` keys and `needs`), `diff` it (2 additions, 0 deletions), and hash it.
* Apply the same change in the browser with a single `view.dispatch({changes})`,
  then hash the editor again and **only commit if it equals the local hash**.
  It did: `eced4fe2…`.
* After committing, `git show origin/main:<path> | cmp -s -` — byte-identical.

Auto-indent never gets a chance to mangle anything, and nothing is committed on
the strength of a screenshot.

---

## Still pending after 1062

| # | Item | State |
|---|---|---|
| **N3** | Duplicate skeleton on posting | **Not reproduced.** Needs him to post in the driven Chrome window while the DOM is watched. Do not write a fix |
| **P4** | 16 high / 6 moderate / 2 low production vulnerabilities | Cannot be done from the sandbox (private mirror 403 + Cloudflare `--frozen-lockfile`). `sharp` needs a MAJOR bump. **Awaiting his answer** on doing the safe ones only |
| **P12** | Admin Security Audit panel | Not started — substantial new feature |
| **P10** | 2 judging tests | The only 2 red tests. Judging is flagged dangerous — needs him |
| **P9** | Cache persistence | Needs a security review (shared phones) |
| — | Home page TTFB ~1.6s | The biggest slice of the 3-second budget, and it is **not** images |
| — | Gallery tiles serve 600px into 173px boxes | Wasteful, not soft. Any fix must not repeat the Curated Wall failure (a cold `/cdn-cgi/` size loses the 5-second carousel race and renders nothing) |
| — | A missing `/assets/*` returns the homepage, not 404 | Open since 5 August |
| — | Stale `sb-isywidnfnjhtydmdfgtk-auth-token` in every member's localStorage | A second, unrelated Supabase project. Reported here for the first time; harmless but should be cleaned |
| — | Nobody has hand-tested the app with a finger | 1055–1062 |

## Watch after this deploy
P7 changes fetch behaviour for every member. A focus refetch **respects
`staleTime`**, so data under five minutes old still comes from cache and this
cannot storm the free tier — but if request volume looks wrong in
Admin → Error Log, set `refetchOnWindowFocus` back to `false` in `src/App.tsx`.
One line, nothing depends on it.
