# OWNER-RULING-2026-09-03-01 — certificate label: "Authorized Signature" → "Authorized Signatory"

**Unit:** OWNER-RULING-2026-09-03-01 · **Branch:** `d2/OWNER-01-authorized-signatory-20260903` off `staging` @ `7f9b2ee` · **Target:** `staging`

**Gate (verbatim):** A member opening a certificate on staging.50mmretina.com sees "AUTHORIZED SIGNATORY" in the generated PDF and the admin preview shows "Authorized Signatory"; `git grep -niI "authori[sz]ed signature" src/` returns zero lines; the Android AAB built from the promoted main carries the same label.

**Cause, not symptom: a hard-coded string** — at the jsPDF footer (`generateCertificatePdf.ts:697`) and the admin preview card (`AdminCertificates.tsx:1084`), plus the test that pins the footer's colour and two comments that name the label.

## Paths touched
- `src/lib/generateCertificatePdf.ts` — lines 416 (comment), 697 (`d.text`)
- `src/components/admin/AdminCertificates.tsx` — line 1084
- `src/__tests__/certificatePalette.test.ts` — lines 12 (comment), 114 (assertion)
- `ANDROID_BUILD_TRIGGER` — one line appended, dated 2026-09-03, reason: certificate label
- `docs/evidence/d2/owner-01/**` — evidence (new)

Nothing under `supabase/**`, `package*.json`, `scripts/lane-config.*`, `docs/gates/**`. No other change rides here — not F-58, not #126's fixes.

## Failing test first
The five sites were verified by the grep at `7f9b2ee` before any edit — **5 lines, the Auditor's five exactly.** The assertion (item 4) was changed with the source untouched:

```
 × certificate palette — which element gets which colour > the small print stays TEXT_SUBTLE — the change did not bleed into it 9ms
   → expected null to be 'TEXT_SUBTLE' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)          2026-09-03T02:48:55Z
```

Then the source (items 1–3):

```
 Test Files  1 passed (1)
      Tests  14 passed (14)                     2026-09-03T02:49:21Z
```

`git grep -niI "authori[sz]ed signature" src/` → **0 lines** (02:49:23Z). `npm run typecheck` exit 0; `npx tsc -b tsconfig.json` exit 0.

## Full suite
`npx vitest run`: **2,479 passed, 1 skipped, 1 failed** — `typecheckIsNotVacuous.test.ts › CI runs the same command as the script`. **Pre-existing:** reproduced on pristine `7f9b2ee` with this branch's edits stashed (02:55:50Z). It pins `tsc --noEmit -p tsconfig.app.json` in `typecheck.yml`, which was deliberately widened to `tsc -b tsconfig.json` (F-52). The test is stale, not the workflow. Not touched in this PR; routed to the Auditor for its own unit.

## Evidence — `docs/evidence/d2/owner-01/`
| | Status |
|---|---|
| `grep-before.txt` (5 lines, 02:48:21Z) · `grep-after.txt` (0 lines, 02:49:23Z) | VERIFIED |
| `test-failing.txt` · `test-passing.txt` · `vitest-full.txt` | VERIFIED |
| `pdf-footer-signatory.png` · `pdf-page-signatory.png` — the real `generateCertificatePdf` rendered in Chromium from a staging-lane-defined build of this branch's `src/`; `pdftotext` shows `AUTHORIZED SIGNATORY` on the footer line | VERIFIED (local build — not yet the PR preview) |
| Admin preview screenshot | **OUTSTANDING** — `CertificatePreviewCard` is not exported and the admin panel needs a session; to be taken from the PR preview or staging by whoever pushes. The change itself is the one-line diff at `:1084`. |
| Android AAB label | Not this PR's evidence — fires from `main` after promotion via the trigger bump. |

## Push authority
None on this side (proxy refuses; re-tested 2026-09-03). Delivered as a `git am`-able patch through the transfer channel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017fdB5mybV9pixsM7n9b9Tf
