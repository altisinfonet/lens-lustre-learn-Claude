# 2026-08-16 — Audit items 3, 5 and 6 CLOSED. Android build 1.2.6 cut and green.

**Everything in this document is live on `main` and verified against origin with
`git hash-object`.** Android Build **#93**, commit `cf62eaf`, **Success**, 7m19s,
two artifacts: `app-release-aab` (8.48 MB) and `app-debug-apk-SIDELOAD-THIS`
(13.9 MB).

> **Numbering.** In conversation these were items **3, 5, 6**. In
> `docs/PATCHWORK_AUDIT.md` they are sections **4, 6, 9**. Same work. The
> mapping is now recorded in the audit itself so neither list reads as a
> different job.

---

## Item 5 (audit §6) — the comment stripper. CLOSED.

41 chain sites across 33 files now call the safe `stripComments()`. Landed in
nine commits (`test: use the safe comment stripper (1/9)` … `(9/9)`); every file
verified byte-for-byte against `git rev-parse origin/main:<path>`.

Two mutations proved the migrated alarms still fire (`WallPosts`
`space-y-0`→`space-y-4`; `Navbar` `bg-background/80`→`/10`). Both caught.

## Item 3 (audit §4) — react-day-picker, and the `.npmrc` hold. CLOSED.

**8.10.1 → 10.0.1. `.npmrc` is DELETED.**

v8 peered on React ≤18, so every clean install failed after the React 19
upgrade — that is what took the website down for nine hours, and
`legacy-peer-deps=true` was the hold. That flag makes npm ignore peer conflicts
*entirely*, so the next stale dependency would have hidden identically.

- **Proved, not assumed:** `package.json` + `package-lock.json` copied to an
  empty directory with no `.npmrc`; `npm ci` → exit 0, zero ERESOLVE. GitHub's
  own clean checkout then agreed: **6/6 checks green** on the deletion commit.
- **v9 rejected on measurement:** 9.14 hard-depends on `date-fns-jalali` *and* a
  hijri converter; v10 carries only `date-fns` + `@date-fns/tz`.
- **Bundle: 439.44 → 439.42 kB gzip.** No cost.
- `security.yml`'s `npm audit --omit=dev --audit-level=critical` still exits 0.
- Both lockfiles regenerated, including `bun.lock` — what Cloudflare installs from.

**The lesson worth keeping:** v9 renamed every `classNames` key and moved the
DOM they land on. `classNames` is a partial record, so an un-renamed key does
not throw and does not fail typecheck — it is ignored and that part renders
unstyled. **Typecheck passed on the first attempt; the SCREENSHOT did not**
(dropdowns gone, both nav arrows stacked top-left, selection lost). Two harness
scenes (`calendar-plain`, `calendar-dob`) were added *before* the upgrade for
exactly this.

## Item 6 (audit §9) — tap targets. CLOSED. **63 screenshots, 0 problems.**

Feed 29→0, profile 17→0, post detail 14→0, login 2→0, notification settings 24→0.

**Nothing was silenced.** Controls that genuinely grew:

| control | was | now |
|---|---|---|
| Settings switches (24 findings) | 44×24 | the whole ROW is a `<label>` (~300×64) |
| Avatar links | 32×37 | 44×44 (`p-1.5 -m-1.5`; photo still 32px) |
| Carousel dots | 8×8, 6×6 | 44×32 buttons; dot centre still **exactly 16px** above the image edge, measured |
| Profile action row | 35 tall | all four at 44, not just the two reported |
| Back-to-top, Cookies, See more, Back, View, login back | 16–32 | 44, with negative margins keeping layout identical |

**Three checker CORRECTNESS fixes**, each narrow, each mutation-proved:

1. A form control inside a ≥44px `<label>` is covered by it. Reverting the
   settings row to a `<div>` brings all 24 findings back.
2. `display:inline` anchors are flowing text. For an inline box the client rect
   is the font em-box, not the line box, so the old shape test could not reach
   them (70×15 vs 21.1px line-height).
3. An image with no layout box cannot render. The profile QR is in the
   desktop-only sidebar; `naturalWidth: 0` at 700ms, 2s and 5s, on both phone
   widths and neither desktop width.

---

## Build 1.2.6 — what the owner must check on his phone

**versionName is 1.2.6, not 1.2.5.** #90 and #91 both carried 1.2.5 and neither
was promoted. Different code gets a different name.

1. **The date pickers** (rewritten): Edit Profile → Date of Birth (month + year
   dropdowns, arrows both sides, date highlighted); Create post → Schedule (past
   dates greyed out).
2. Settings → Notifications: **tap the WORDS of a row**, not the switch. It must toggle.
3. An album post's dots — identical to look at, much bigger to hit.
4. A post from the WALL vs the FEED — still identical (#91's fix, confirming it survived).
5. Download an image and an article PDF.

## Still open

- **Audit §8** — the lint rule that would make the "one funnel" gate a *build*
  failure rather than a test failure. Not built.
- **`svgo`** is absent from both lockfiles (an *optional* peer of
  `vite-plugin-image-optimizer`), so SVGs ship unoptimised. **Pre-existing, not
  caused by this work**; build warns and exits 0. Deliberately left — adding a
  dependency beside a build is how the last outage started.

## Transport note

`git push` still 403s ("access denied by the git proxy"). Everything ships via
the GitHub browser-upload route, one directory per commit, then verified with
`git hash-object` vs `git rev-parse origin/main:<path>`. **File deletion cannot
be done that way** — use `https://github.com/<repo>/delete/main/<path>`, which
is how `.npmrc` was removed.
