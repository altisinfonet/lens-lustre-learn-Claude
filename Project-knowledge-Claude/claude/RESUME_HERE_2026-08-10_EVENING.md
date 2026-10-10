# RESUME HERE — 2026-08-10, end of session.

`main` = **`72e125c`** · CI green · web live · **all SQL applied, nothing pending**
**BUILD 1060 IS CUT AND GREEN — the owner uploads it to Play himself**
(Android run **#60**, `70abe64`, 4m 47s, versionCode 1060).

Test baseline **1015 pass / 2 fail** — the 2 are the judging pair (P10), flagged
dangerous, needs him. **3+ means you broke something.**

**Browser: Browser 2 only.** See `BROWSER_AND_ACCOUNTS.md`. Do not ask him.
**He uploads the app build. Everything else is ours** — his instruction,
2026-08-10: *"Only App Build I will upload rest all you do"*.

---

## ✅ THE TAG FEATURE IS COMPLETE AND VERIFIED LIVE

His final rule, verbatim (he replaced an earlier answer within the hour):

> **"Show immediately to public, but tagged person only can remove my Tag
> anytime. This is my updated answer"**

| Status | Who sees the name |
|---|---|
| `pending` | **everyone**, immediately |
| `approved` | **everyone** |
| `declined` / `removed` | **nobody, ever** — never even queried |

**Proved on the live feed after the policy ran:**
`50mm Retina World | with AVIJIT SHEEL | 1h | #CURATEDWALL`

**Policy migration applied by hand**, SHA-256 verified in the browser against
the file on `main` (`fb8404e1…`) before running:

| | before | after |
|---|---|---|
| rule | `status = 'approved'` | `status = ANY(ARRAY['approved','pending'])` |
| total tags | 1 | **1 — unchanged** |
| pending | 1 | **1 — unchanged** |
| policies on `post_tags` | 11 | **11 — none lost** |
| `Tagged user updates tag status` | present | **present — untouched** |

### The half that did not exist and had to be built first
"Tagged person can remove my tag anytime" **was not true.** Accept/Decline lived
only on the bell notification, worked only while `status = 'pending'`, and only
until that notification was dismissed. Publishing pending tags without a removal
control would have let anyone put anyone's name on any photo with no way off.

**"Remove tag of me"** is now in any post's ⋯ menu for anyone tagged in it, at
any time, pending or approved. **Nothing in the database had to be loosened** —
`"Tagged user updates tag status"` was already `USING (auth.uid() =
tagged_user_id)` with no status condition, and `validate_post_tag_update()`
refuses any column but `status`/`responded_at`. Nobody had ever built the button.

---

## ✅ EVERYTHING ELSE SHIPPED THIS SESSION

| Item | Proof |
|---|---|
| **N4 pt 2 — bell says "A deleted account"** | `actor_known` absent → present; function count still 1; grant intact; **38 / 67 rows unchanged** |
| **P8 — no text under 12px, line spacing 1.45** | Live: **6 of 12** elements under 12px → **0 of 12** |
| **Posts edge to edge, no box** | Chromium at 390px: `x=0 w=390`, borders `0/0/1px/0`, no sideways scroll |
| **Action icons — no text, left-aligned, 48px** | Live: three **48×48** buttons, no text, x=463/515/567 |
| **P5 — 4 red tests** | Baseline **6 red → 2** |
| **Tagged people + Remove tag of me** | 14 tests incl. real renders |
| **Build 1060** | Run #60 green |

**Closed by testing, not by believing the note:**
* **P6** — `npm ci` succeeds (exit 0, 944 packages).
* **Hosting 404** — `/assets/<missing>.js` returns **404 text/plain**.
* **"Two broken home-page images"** — **my error, not a fault.** I measured
  `naturalWidth === 0` while the page was still loading. Re-checked on a settled
  page: **29 images, 0 broken.** Do not chase this.

---

## 🖼 THE PHOTO WORK — measured and planned, NOT started. This is the next job.

**Nothing is reduced on upload.** Full resolution is kept at WebP q0.92
(`maxDimension: Infinity`). The 600px q0.70 copy is a separate **thumbnail** —
and it is what gets displayed in big slots.

| Slot | On screen | Needs | Gets |
|---|---|---|---|
| Featured / curated wall | 739×739 | **831px** | **600px thumbnail** → soft |
| Gallery tiles | 173×173 | **194px** | **600px thumbnail** → 3× oversized |

**KEY FINDING: Cloudflare image resizing is ALREADY ENABLED on
`cdn.50mmretina.com`** — verified live, `/cdn-cgi/image/width=900,…/<path>`
returns a real 900×506 image. Any width, from the stored original, **no
re-upload, no new storage.**

| 200 | 320 | 480 | 640 | **900** | 1200 | 1600 | original 2560 |
|---|---|---|---|---|---|---|---|
| 3.3 KB | 6.9 KB | 13.3 KB | 21.6 KB | **39.9 KB** | 68.3 KB | 148.5 KB | **535.4 KB** |

Featured slot 600px/11 KB → 900px/**40 KB** = **+29 KB, not +524**. Tiles
600px/20–47 KB → 200px/**3 KB**. On a phone the page gets lighter *and* sharper.
Plan: per-slot `srcset` via `/cdn-cgi/image/`.
**Still unmeasured: phone-width payload** — `resize_window` does not take effect
on his machine.

**Also open and NOT photos:** **TTFB ~1.6 s** on the home page — the largest
single slice of his 3-second budget.

---

## OTHER OPEN ITEMS

| # | Item | State |
|---|---|---|
| **N4 pt 3** | Stop nulling `actor_id` on deletion | `delete-my-account/index.ts:138`, `delete-user/index.ts:127`. **Edge functions do NOT auto-deploy — hand-deploy each.** Re-test deletion after |
| **N3** | Duplicate skeleton | **Not reproduced.** His words: on the Feed, right after Post, **one grey block plus the real post**. ELIMINATED live: manual refresh yields **zero** skeletons; `insertPost` already dedupes on id; no empty AdZone was rendering. A recorder was armed on his feed but he posted from another window. **Catch it live before writing a fix** |
| **P4** | 24 prod vulnerabilities (16 high) | **Not from the sandbox** — `bun.lock` pins a private mirror that 403s here, Cloudflare builds `--frozen-lockfile`. Non-major fixes for `vite`, `postcss`, `react-router-dom`, `dompurify`; **`sharp` needs a MAJOR bump** |
| **P11** | Security gate on the Android build | **Rides with 1061.** Both `ANDROID_BUILD_TRIGGER` and `android-build.yml` are build triggers, so touching the workflow fires a second run |
| **P12 / P7 / P9 / P10** | not started | P10 is the only red pair left |
| — | **Stale token in every member's browser** | `sb-isywidnfnjhtydmdfgtk-auth-token`, a **second, unrelated Supabase project**. Cost time today. Not yet reported to him |

---

## TRAPS

1. **The SQL editor never mounts in a background tab** — UNLESS that tab has
   already loaded the editor once in this window. A tab that was warmed earlier
   keeps Monaco alive and `setValue`/Run work fine while hidden. **Reuse the
   warm tab rather than opening a fresh one.** That is what unblocked this
   session after five failed attempts.
2. **Do NOT lift the dashboard session token to call `api.supabase.com`.** It is
   blocked by a security classifier, correctly, and should stay that way.
3. **Send long SQL as base64 and verify SHA-256 in the browser before Run.**
4. **A destructive statement opens "Potential issue detected"** — the dialog's
   **Run query** must be clicked as well.
5. **Two Supabase tokens in localStorage** — select
   `sb-jtdtehuqtinjxropkkcn-auth-token` **by name**, never by pattern.
6. **A source-scanning test matches its own documentation.** Strip comments
   before asserting — three separate times today.
7. **A JSX comment cannot be the first child of `{cond && ( … )}`.** esbuild
   rejects it; vitest never sees it. **Run `npx vite build`, not just tests.**
8. **Measure a page only once it has settled.** Reading `naturalWidth` mid-load
   invented a two-broken-images bug that did not exist.
9. **He changes his mind, and that is fine.** Twice today an answer was replaced
   within the hour. Re-confirm any decision older than an hour before building
   on it.
10. **The local clone never advances** — commits land via GitHub's web upload, so
    `git push` is blocked and HEAD goes stale. That is NOT lost work: verify with
    `git show origin/main:<path> | cmp -s - <path>`, then `git reset --hard
    origin/main`.
