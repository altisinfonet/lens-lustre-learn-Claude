# Next release runbook

## Build 1053 — ✅ LIVE ON THE PLAY STORE (2026-08-06)

The owner uploaded it and it went live the same day. **Nothing outstanding.**

- Workflow run **#53**, `Android Build`, commit `679d25f`, **Success in 3m 39s**.
- `VC=$(( 1000 + 53 ))` → **versionCode 1053**, versionName **1.2.2** — read
  from the "Set app version" step log (`versionCode=1053 versionName=1.2.2`),
  not assumed.
- **versionName was deliberately left at 1.2.2.** Play only requires a higher
  versionCode. The in-app label reads "1053 (1.2.2)". **Offer a bump to 1.2.3
  before the next cut** — it is a one-line workflow change.
- "Prove the notification icon is actually inside the bundle" — a hard-fail
  assert step; the job went green, so the icon is really in the AAB.
- `@capacitor/filesystem` is in the install list (workflow line 51), so in-app
  saving of photos and article PDFs ships in this bundle.
- Artifact `app-release-aab`, 8.86 MB, 14-day retention:
  https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31063602205
- "Upload to Google Play" step skipped (no Play secret) — the owner uploads
  manually.

**Play "What's new" is always exactly:**

```
Bug fixes and improvements.
```

Nothing else, ever. The detailed changelog lives ONLY in `ANDROID_BUILD_TRIGGER`.

### What 1053 contains (over 1052)

Stories at the right size (80/96px rings, feed + profile) · a story opens FULL
PAGE from a profile, with progress bars, tap zones and auto-advance · a story
stays 10 seconds, not 5 (one shared constant) · delete your own story anytime
and SEE it go — the row was always being deleted, the screen just never
refreshed; a failed delete now reports honestly instead of a false "removed" ·
**@mentions in post captions** (pick from the dropdown → tappable profile link;
hand-typed names stay plain text so nobody is mis-tagged) · admin members list
shows last-active + App/Website origin · bare `50mmretina.com` → `www` ·
web build `2026-08-06-1`.

**NOT in 1053** (landed on web after the cut — ships with **1054**):
the enterprise logging standard — logger, error catalog, database sink, the
converted risky paths, and the **Admin → Error Log** screen.

**Also not in 1053:** the true 301 in the Cloudflare Worker (in the repo; the
owner must paste-deploy it in the dashboard) · a "mentioned you" notification
for caption mentions (comments do not send one either; new DB work if wanted).

---

## Cutting the NEXT build (1054 = run #54)

**Do it only on the owner's explicit GO.**

### The one-run rule
The workflow's trigger is:
```yaml
on:
  push:
    branches: [main]
    paths:
      - ".github/workflows/android-build.yml"
      - "ANDROID_BUILD_TRIGGER"
```
- **If only `ANDROID_BUILD_TRIGGER` needs to change:** push every other file
  FIRST (they do not match the paths filter → no run), then push the trigger →
  **exactly one run**. This is how 1053 was cut.
- **If the workflow file must change too:** use a **feature branch + a PR merged
  as a single merge commit**. Two direct pushes to `main` fire two runs and
  **waste a build number**. This is how 1052 was cut (PR #64).

**versionCode = 1000 + `github.run_number`.** Check the workflow's run count on
the Actions page before promising a version number.

### Checklist
1. Owner says GO.
2. Bump `(window as any).__APP_BUILD` in `src/main.tsx` (currently
   `2026-08-06-1`). Push it — no run fires.
3. Write the new entry at the **TOP** of `ANDROID_BUILD_TRIGGER`, in plain
   member-readable language, covering **ALL** accumulated changes since the last
   build. Push it — one run fires.
4. Watch the run. When green, **read the raw "Set app version" step log** and
   quote `versionCode=… versionName=…` — never infer it.
5. Give the owner the run URL and remind him: "What's new" = exactly
   `Bug fixes and improvements.`
6. Update this file, `BUILD_<n>_PROGRESS.md`, and `PROJECT_MASTER_RECORD.md` §15.
7. Give a **Completion Verification Report** (standing owner directive).

### Editor technique that made the trigger edit safe
`ANDROID_BUILD_TRIGGER` is 500+ lines; selecting it all is the risky operation
that once duplicated a file. Instead: click in the editor, `ctrl+Home`,
`shift+Down` ONCE, verify with `window.getSelection().toString()` that exactly
line 1 is selected, then paste `<new entry> + <original line 1> + "\n"`. The
rest of the file is never touched.

### Reading the signing result
The string *"building UNSIGNED"* appears inside the **echoed script**, before
any decision is made. The real answer appears **after `##[endgroup]`**. Do not
report a build unsigned on the strength of the echoed line.

---

## Committing from the sandbox — `git push` is BLOCKED

Proxy 403: *"…is not in this session's authorized repository set"*.
`git fetch origin main` always works for verification.

### Route A — GitHub's "Upload files" page (PREFERRED, byte-exact, fast)
Established 2026-08-02, and used for 16 files in one session on 2026-08-06.
1. Stage the files under `/mnt/user-data/outputs/<dir>/` (the upload tool
   rejects any other path).
2. Navigate to `https://github.com/altisinfonet/lens-lustre-learn-Claude/upload/main/<target-directory>`.
3. `find` the file input → `mcp__claude-in-chrome__file_upload` with the staged
   absolute paths (multiple files per call are fine; ≤10 MB total).
4. Set the commit message with the **native `HTMLInputElement` value setter**
   (typing does not register), then click the `Commit changes` button.
5. **Verify:** `git show origin/main:<path> | diff - <path>`.
It overwrites existing files cleanly and preserves bytes exactly.

### Route B — the tiled (CodeMirror) editor
The ONLY way to change `.github/workflows/**`, which GitHub refuses to accept as
an upload.
- **NEVER trust `ctrl+A` / `ctrl+shift+End`** — it silently selects nothing and
  the paste APPENDS, duplicating the file. This broke `main` once
  (`useLastActive.ts`, 2026-08-05).
- Use counted `shift+Down` (batches of ≤100) + `shift+End`, and **verify with a
  screenshot** before pasting.
- Paste via a `ClipboardEvent` with a `DataTransfer` on `.cm-content`.
- **The first click/keypress after a navigation is often silently ignored** —
  redo it once the page has visibly loaded.
- On `/new/main`, set the filename with the native value setter on the input
  whose placeholder is **"Name your file..."** — a generic input search lands on
  the sidebar "Go to file" search instead (its "No matches found" popup is the
  tell).
- The commit dialog's confirm button:
  `[...document.querySelectorAll("button")].find(b => /^\s*Commit changes\s*$/.test(b.textContent))`.
- GitHub may REPLACE a JS-set commit message with its own AI suggestion. Verify
  bytes, never the message.

---

## Traps worth keeping

- **Migrations do NOT auto-apply.** SQL Editor (Monaco:
  `window.monaco.editor.getModels()[0].setValue(sql)` then click `Run`) or the
  pg-meta platform API. **Destructive statements open a confirmation dialog
  ("Potential issue detected" → Run query) — clicking Run is NOT enough.**
  Always screenshot the result. Never click "Run and enable RLS".
- **Edge functions do NOT auto-deploy from GitHub.** Dashboard → Edge Functions
  → Code → Deploy updates.
- **Never add parameters to a live database function that installed apps still
  call** — it creates an ambiguous overload and breaks every shipped build.
  Give the new function a new name.
- **Verify a web deploy in the LAZY ROUTE CHUNK**, not `index-*.js` — fetch
  `/?cb=<random>`, read the chunk names out of the entry bundle, then grep the
  specific chunk. Checking only the entry bundle gives false negatives.
- **The app bundles its own `dist`** — every frontend change needs a new AAB to
  reach app users. Database/RPC changes reach both web and app instantly.
- **AGP 9 upgrade** — deliberately deferred (needs Gradle 9.1.0 and refuses
  projects applying the Kotlin plugin, which Capacitor's template does).

---

## Build history

| Build | Run | Commit | State |
|---|---|---|---|
| **1053** | #53 | `679d25f` | ✅ **LIVE ON PLAY (2026-08-06)** |
| 1052 | #52 | `24efda1` (PR #64) | superseded by 1053 |
| 1051 | #51 | `d36aad8` | superseded |
| 1050 | #50 | `a73830b` | superseded |
| 1044 | #44 | `86153a7` | superseded |
| 1043 | #43 | `6525916` | was live before 1053's line of builds |

Live for all builds regardless (database side): birthday `LIMIT 50` removed,
birthday notification cron at 09:00 IST, About Us logo reference corrected,
Google-avatar hotlinks blanked, the profile-photo posting gate removed,
`profiles.last_platform` recording, and the structured `log_app_event()` sink.
