# THE BROWSER AND THE ACCOUNTS. Settled 2026-08-10. Do not ask again.

> Owner: *"in your memory fix this browser. Only this browser you will access
> for 50mm retina project. dont ask 500 times on guess"*

---

## THE ONE BROWSER

**Use "Browser 2".**
`deviceId 83b2a473-482e-4648-9073-827b31847d5d`

```
mcp__claude-in-chrome__select_browser  { deviceId: "83b2a473-482e-4648-9073-827b31847d5d" }
```

Select it and start working. **Do not ask the owner which browser to use.** If
the tool insists a browser be chosen and refuses to proceed, select this
deviceId — that is the answer, permanently.

## WHY THERE ARE TWO, AND WHY IT WASTED HIS TIME ONCE

Two Chromes are connected to this account. They are **different Chrome
profiles**, and Chrome keeps a separate login for each one:

| | GitHub | Push access to the repo | Supabase |
|---|---|---|---|
| **Browser 2** ← use this | `altisinfonet` | **yes** | signed in |
| Browser 1 | `altisappdev` | **no** — GitHub shows "Uploads are disabled" | signed out |

On 2026-08-10 a session read `meta[name="user-login"]` on the upload page, got
`altisappdev`, and told the owner GitHub was signed in as the wrong account. He
replied *"you are wrong, github is logged in altisinfonet"* — **and he was
right about his own window.** Both readings were true at once: his window was
`altisinfonet`, and the window the extension handed the session was
`altisappdev`. The mistake was not the measurement, it was concluding something
about HIS browser from a reading taken in a DIFFERENT one.

**The tell:** `document.querySelector('meta[name="user-login"]').content` on
`/upload/main/<dir>` plus `document.querySelectorAll('input[type=file]').length`.
`altisinfonet` and one file input = the right profile. `altisappdev` and zero
file inputs = the wrong one. Check it once at the start of a browser session;
never argue about it.

## THE ACCOUNTS, FOR THE RECORD

* **GitHub repo owner / the account that can push:** `altisinfonet`
  (repo `altisinfonet/lens-lustre-learn-Claude`).
* `altisappdev` is the owner's other GitHub account and has **no push access**.
  It is also his e-mail address — which is why
  `grep -rn "altisappdev" src public index.html supabase` must always return
  nothing before shipping. That grep is about the e-mail leaking to members and
  has nothing to do with the GitHub account; do not "fix" one by touching the
  other.
* The Chrome profile is **`mr.neilbasu`**. A Chrome profile named `mr.neilbasu`
  signed in to GitHub as `altisinfonet` is **normal and correct** — not a
  mismatch, not something to report.

## WHAT ELSE LIVES IN THAT BROWSER

* **Supabase dashboard** — project `jtdtehuqtinjxropkkcn`.
* **Cloudflare dashboard.**
* **50mmretina.com**, signed in.

### The SQL editor trap
Supabase's SQL editor is Monaco and it **never mounts while its tab is in the
background** — `document.hidden === true` and
`window.monaco.editor.getModels()` stays empty forever, no matter how long you
poll. Bring the tab to the front (or close the others in the group) before
calling `setValue`. The hosted dashboard's `/api/platform/pg-meta/.../query`
proxy answers `{"success":false,"message":"Endpoint not supported on hosted"}`,
so there is no API shortcut around this.

## THE UPLOAD ROUTE, WHICH WORKS EVERY TIME

`git push` is blocked (the sandbox proxy refuses to inject a credential for
this repo, and there is no `add_repo` tool). Use GitHub's web upload:

1. Stage files under `/mnt/user-data/outputs/<dir>/` — the upload tool rejects
   any other path. **One directory per commit**; the upload page writes into the
   directory in its URL.
2. Navigate to
   `https://github.com/altisinfonet/lens-lustre-learn-Claude/upload/main/<target-dir>`.
3. `find` the file input → `mcp__claude-in-chrome__file_upload` (several files
   at once is fine, ≤10 MB).
4. Set the message on **`#commit-summary-input`** — the FIRST box — with the
   native `HTMLInputElement` value setter. Typing does not register, and the
   second box is the *description*, which leaves the commit titled "Add files
   via upload".
5. **Screenshot before committing.** Confirm the path in the breadcrumb, the
   file list, and that "Commit directly to the `main` branch" is selected.
6. Click via
   `[...document.querySelectorAll("button")].find(b => /^\s*Commit changes\s*$/.test(b.textContent))`.
7. **Byte-verify, always:**
   `git show origin/main:<path> | cmp -s - <path>`.
   Clicking Commit is not evidence it committed. Only this is.

`.github/workflows/**` cannot be uploaded — GitHub refuses it. That one needs
the pencil (CodeMirror) editor; see `NEXT_RELEASE_RUNBOOK.md` Route B.
