# WEB STAGING · GATE 1 — LIVE STATUS (append-only, updated 2026-08-21 ~18:5x UTC)

PR #87 (staging/web-isolation-guard → main), head `a7004b2`. Three commits, each
independently byte-verified by the authoring session:
1. `6b33e78` isolation change (tree f65447f6… identical to audited cf3eb6a)
2. `87f7a91` workflow env fix — 4 files/+34 lines only; 5 steps: web-build:47 prod trio,
   ui-gate:113 synthetic trio, android-build:363 synthetic / :519 prod trio,
   health.yml:55 SUPABASE_ANON_KEY (script's first preference)
3. `a7004b2` .gitleaks.toml — ONE exact-literal allowlist of the public anon key
   (useDefault=true; rotated/service-role keys still caught; doctrine:
   docs/claude/SECURITY_GATE_AND_FALSE_ALARMS.md:34 ".env committed — Fine… public by design")

CI on a7004b2: secret scan GREEN (allowlist held) · 3 of 4 Actions suites GREEN ·
1 still running (ui-gate/web-build class). Local pre-proofs for this exact tree: guard
harness 8/8+6/6 · production lane 263-asset PASS · ui:gate 148/0 baseline clean (twice,
two sandboxes) · gitleaks repro→fix→control (3 findings→0; service-role still caught).

Pages preview: RED **by design** (fail-closed — production Pages project has no env vars
yet). Clears only with the owner card (three VITE_* vars in Production+Preview +
build command + guard step) on project lens-lustre-learn-claude.

Production: www.50mmretina.com serving normally (checked ~18:5x UTC). main untouched at
c737de9. No staging infrastructure created (gate rule held).

REMAINING TO GATE-1 GREEN: (1) 4th suite green — code session reports; (2) OWNER card
(Cloudflare) — OWNER_CARD_CLOUDFLARE_5_MIN.md, all copy-paste; (3) OWNER word "merge";
(4) post-merge: production Pages deploy log shows ISOLATION-GUARD PASS + site loads →
GATE 1 GREEN → Step 3 fires from the Cowork session (staging Supabase project ₹0
API-confirmed + R2 bucket; GATE2_READY_PACKAGE has the exact calls).
