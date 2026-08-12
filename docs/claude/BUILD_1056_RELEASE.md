# BUILD 1056 — the Play upload. Built and green. 2026-08-06.

**`main` = `b057f9a`. Android Build run #56 → versionCode 1056 → SUCCESS in
4m 22s.** Artifact `app-release-aab`, no UNSIGNED notice. This is the build to
install and upload.

> Play "What's new" stays exactly: `Bug fixes and improvements.`
> The detailed changelog lives only in `ANDROID_BUILD_TRIGGER`.

---

## Why 1056 and not 1055

`versionCode = 1000 + github.run_number`, so the number is decided by the run,
not by us. Run #55 fired and completed before the owner's "wait" arrived, which
permanently consumed 1055. **1055 was built but never installed and never
uploaded**; the owner chose to discard it. 1056 is the first build that carries
the image-zoom work to a handset, and its changelog entry says so in place so
nobody later reads the 1055 entry as shipped.

## What 1056 contains

Everything in 1055 (the whole image-zoom feature) **plus**:

- **The account sheet swapped sides.** Version on the LEFT, Logout on the
  RIGHT. Owner instruction from a screenshot: *"logout will be right and
  Version will be left"*. Both children stay `flex-1`, so each still takes
  exactly half the row.
- **The version reads `V1056 (1.2.2)`.** Owner: *"version write like
  V1055(1.1.2.) like so"* — the V prefix confirmed with him, existing spacing
  kept, no trailing dot, and the `1.1.2` treated as a typo for the real `1.2.2`
  after asking. **Both numbers still come from the build itself**
  (`versionCode`/`versionName` stamped by the workflow); the V is decoration in
  front of a real number, never an invented one.
- **The website stamp is deliberately NOT prefixed.** The web has no
  versionCode; it shows its deploy stamp (`2026-08-06-11`). `V2026-08-06-11`
  would read as a version number that does not exist.

## Commits, all byte-verified

`60149b8` (1055) → **`b057f9a`**

| Commit | File |
|---|---|
| `4c7f716` | `src/components/MobileProfileSheet.tsx` |
| `28c9d0e` | `src/lib/appVersion.ts` |
| `51c3a71` | `src/lib/__tests__/appVersion.test.ts` |
| `7d70065` | `src/main.tsx` — marker `2026-08-06-11` |
| `b057f9a` | `ANDROID_BUILD_TRIGGER` — pushed LAST, so the build picked up everything |

`git show origin/main:<path> | diff - <path>` → **5 of 5 identical.**

**The 1055 sequencing mistake was not repeated.** In 1055, `package.json` went
last and left 11 intermediate commits unbuildable. Here every code file was
pushed and byte-diffed BEFORE the trigger fired, so exactly one build ran and
it ran on the complete tree.

## Verification

- `tsc --noEmit` — clean.
- Full suite — **886 passing / 25 failing / 1 skipped**. The 25 are the known
  pre-existing set (4 ProfilePhotoPrompt + 21 competition/judging); the owner
  chose to ship first and clean them afterwards. Zero new failures.
- Shipped tree re-checked after reset: version renders before logout in the
  row, `V${build} (${version})` present, marker `2026-08-06-11`.
- `appVersion` tests updated to pin the new format, including that the website
  stamp never receives a V.

## Error-code coverage, measured for the owner's debug document

595 source files · **115 logger calls, 0 without a code** · **0 `console.*`
left in the app** · 72 codes · 0 duplicates · 0 unknown codes used.
**6 codes are reserved and cannot fire**: AUTH-1002, VAL-2001, DB-3002,
DB-3003, API-4001, FILE-5001 — if one ever appears in the Error Log, treat it
as suspicious.

354 catch blocks: 191 log/show/rethrow, 163 deliberately swallow, **143 of
those with a written reason beside them**. That is the honest answer to "is
every error numbered" — every log is, not every silent catch.

Delivered as `50mm-error-code-reference.docx`: 14 pages, grouped by subsystem,
every row carrying the emitting **function and file**.

## Still open

1. **🔴 Cloudflare Pages is publishing nothing.** The `.pages.dev` origin was
   still on `2026-08-06-8` — verified at origin, so not an edge cache and not
   the Worker. See `DEPLOY_STUCK_2026-08-06.md`. Does not affect 1056: the
   Android workflow builds `dist` itself.
2. **The zoom has never been driven by a finger.** The sandbox has no touch
   input. SPEC §6's four confirmations and the 13-item checklist in SPEC §7 can
   only be judged on 1056, on a handset.
3. **25 stale tests** pinning removed rules — cleanup agreed for after release.
4. **`package-lock.json` out of sync** with `package.json`, pre-existing;
   `npm ci` fails and every workflow silently falls back to `npm install`.
