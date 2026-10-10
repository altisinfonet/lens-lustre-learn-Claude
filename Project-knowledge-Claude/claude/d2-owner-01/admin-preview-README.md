# OWNER-RULING-2026-09-03-01 — the outstanding admin-preview capture

**D2 · captured 2026-09-03T09:12Z (fixed) / 09:13Z (control) · for `docs/evidence/d2/owner-01/` · no new commit on `d2/OWNER-01-authorized-signatory-20260903`**

## What was captured, and from where
The PR preview (`d2-owner-01-authorized-signa.lens-lustre-learn-claude.pages.dev`) sits behind **Cloudflare Access** (email login code) and then the admin sign-in; neither login is D2's to perform, and the Owner's login in the shared Chrome tab had not completed by 09:08Z. So the card was rendered from **the repository's own UI harness** (`uiharness.html`, `src/uiharness/**`, the tool this project uses for every screenshot gate), at the PR's exact commit:

| File | Commit rendered | Footer text (Playwright `innerText` of the card) |
|---|---|---|
| `admin-preview-signatory.png` | **`c72609d`** (= #132 head, `AdminCertificates.tsx:1084`) | **"Authorized Signatory"** — `/authorized signatory/i` **true**, `/authorized signature\b/i` **false** |
| `admin-preview-control-staging.png` | `origin/staging` @ `d1aed35` (unfixed) | "Authorized Signature" — `/authorized signatory/i` **false**, `/authorized signature\b/i` **true** |

Same scene, same viewport (1280×900, DPR 2), same fixtures; only the commit differs. The control is what makes the capture evidence rather than a picture (C-34): the method can show the old label, and did.

## Method, reproducible
1. `git worktree add <dir> c72609d` (and `origin/staging` for the control); `node_modules` symlinked from the staging worktree.
2. A **temporary, uncommitted** scene in `src/uiharness/realScreens.tsx`: `"screen-admin-certificates-temp": () => screen(<AdminCertificates />, "/admin", "/admin")`. Reverted with `git checkout --` afterwards; both worktrees verified `git status` clean.
3. `npx vite --host 127.0.0.1 --port 5199 --strictPort` with the **public** staging-lane values from `.github/workflows/web-build.yml` (the harness's fake backend intercepts every request; nothing reached a real database — its "NO FIXTURE" log shows the two unmatched calls: `admin_list_certificates`, `record_activity_minute`, both irrelevant to the card, which reads `site_settings` and has a fixture).
4. Playwright/Chromium: open `?scene=screen-admin-certificates-temp`, click the **Signature** tab (the card lives there, `AdminCertificates.tsx:835`), screenshot the card's container, assert on its text.

## Classification
**VERIFIED (local harness render of the real component at the PR commit).** Not the PR preview and not staging.50mmretina.com; #132 is not yet merged to `staging`, so no lane URL can show the new label until it is. If the Auditor wants the Access-gated preview screenshot as well, the Owner's login is the only path and the capture is one click once that is done.

Push authority on this side: none. These three files are delivered through the transfer channel for whoever commits to `docs/evidence/d2/owner-01/`.
