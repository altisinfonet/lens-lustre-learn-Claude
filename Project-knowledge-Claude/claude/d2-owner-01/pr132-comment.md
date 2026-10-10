**OWNER-01 — the outstanding admin-preview capture (D2, 2026-09-03T09:12Z)**

The `CertificatePreviewCard` rendered at this PR's head `c72609d` shows **"Authorized Signatory"**; the same scene at `origin/staging` (`d1aed35`, unfixed) shows "Authorized Signature" — the control that proves the capture can tell the two apart.

Rendered from the repository's UI harness (`uiharness.html`, real `AdminCertificates` component, Signature tab, fake backend, 1280×900 @2×), not from the Pages preview: that URL is behind Cloudflare Access plus the admin sign-in, neither of which is mine to complete. Playwright's text assertion on the card: `/authorized signatory/i` true and `/authorized signature\b/i` false at `c72609d`; the inverse at staging.

Files for `docs/evidence/d2/owner-01/`: `admin-preview-signatory.png`, `admin-preview-control-staging.png`, `admin-preview-README.md` (method, reproducible in four steps; temporary harness scene reverted, worktrees clean). Delivered via the transfer channel — no new commit on this branch, per the order.

Classification: VERIFIED (local harness render at the PR commit). The Access-gated preview screenshot remains available to whoever holds the login.
