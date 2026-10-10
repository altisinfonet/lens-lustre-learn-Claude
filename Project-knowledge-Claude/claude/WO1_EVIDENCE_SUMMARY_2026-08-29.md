Nothing in this evidence pack closes any §25 audit row — §25.4 means measurement performed by an owner or compiler session (this one) is OWNER-ATTESTED evidence for the independent human auditor to validate, not a closure of blocker 9 or any of its four §25.7.2 workstreams.

## What this pack is
A read-only provider-measurement pass against production (`jtdtehuqtinjxropkkcn`) and staging (`ztzutckwdhetphwghuzj`) Supabase projects and the Cloudflare account backing them, performed 2026-08-29 ~18:19Z–18:46Z UTC, per `claude/WORK_ORDER_WO-1_2026-08-29.md`. No provider mutation of any kind was performed: no `apply_migration`, no `deploy_edge_function`, no non-SELECT SQL, no branch operations, no edits to `docs/PROMOTION_LEDGER.md`, no N1, no §5.3 probe.

## What was measured (VERIFIED this session)
- **T1.1** — function inventory, both lanes: production N=**71**, staging N=**74**, both duplicate-free and 100% ACTIVE. Two independent production captures ~15 minutes apart showed **zero drift** (identical ids, versions, hashes, status — see `exports/two_capture_drift_check.json`).
- **T1.3** — full source + independent hash captured for 7 of 71 production functions. Cross-validated the provider's `ezbr_sha256` field against 7 candidate reconstructions from raw source text; **none matched** — see `T1_HASH_CROSS_VALIDATION.md`. `ezbr_sha256` remains usable as a change-detection identity (confirmed by the zero-drift result above) but not as an independently-reproducible content hash from this session's tooling.
- **T1.7** — of the three 2026-08-26 "production ahead of repo" functions: `send-gift-credit` CONFIRMED by direct source read (uses the indexed RPC `admin_lookup_user_id_by_email`); `detect-ai-image` and `analyze-gallery-image` CONFIRMED to carry the described AI-key fallback chains. The repo-side "ahead of" comparison itself is BLOCKED (no GitHub access) — only the production-side half of each claim could be measured.
- **T1.8** — `_shared/imageDims.ts` fetched from all three named functions (`backfill-image-dims` v5, `measure-post-media` v6, `migrate-post-media` v6). All three are byte-distinct (3 different SHA-256 hashes, confirmed pairwise with `diff`). Divergence detail in `T1.8_IMAGEDIMS_COMPARISON.md`: the core parsing logic reads as identical across all three; the differences are a doc-comment header and the presence/absence of `insertDimsInName`.
- **T2 Row 1** — production `ad_creative_comments`: 7 RLS policies, migration `20260828082136` absent. This is the AF-17 expected pre-state, not a defect.
- **T2 Row 2** — staging `ad_creative_comments`: 9 RLS policies, migration `20260828082136` present. Matches expected post-M2 state.
- **T2 Row 6a** — Cloudflare R2: both `50mm` (production) and `50mm-staging` (staging) buckets confirmed to exist as distinct objects with different creation dates and different geographic locations.

## What is BLOCKED (full detail and "who can close it" in `BLOCKED.md`)
- The WS4 harness pack (`07_ws4_reference_impl.py` and its companion scripts) is **not present anywhere in this session's reachable storage** — only its hashes and prose descriptions survive in project docs. Consequently: T1.5 (full 71-function MATCH/DRIFT/UNKNOWN classification), T1.6 (per-DRIFT review), and the mandatory harness self-verification (`10_verify_pack.sh`, `08_selftest.sh`, `11_mutation_control.sh`) could not be run at all — see `HARNESS_VERIFICATION_TRANSCRIPT.md`.
- The literal `06_RESULTS_TEMPLATE.md` file (original) is likewise absent; the version in this pack is an explicitly-labeled reconstruction of its required content, not the original file.
- GitHub access is disabled for this session (confirmed by direct API attempt) — this blocks the 138-file review, the independent test-suite run, and every repo-side half of a production-vs-repo comparison.
- §25.3 rows 4 (R2 token scope), 6b (R2 isolation-probe prefix search), and 6c (Cloudflare Zero Trust posture) are blocked for lack of the relevant tool in this session's Cloudflare MCP connection — not for lack of trying.

## Hand-back contents
- `06_RESULTS_TEMPLATE.md` — reconstructed §R.1, all 8 rows addressed, no blank cells
- `inventory.tsv` — 145 rows (71 production + 74 staging), tab-separated
- `manifests/*.manifest.json` — per-function manifests for the 7 sampled production functions
- `exports/*.json` — raw per-row provider query results for T2, plus the two-capture drift check
- `production/`, `staging/` — raw `list_edge_functions` JSON captures and fetched function source
- `T1_HASH_CROSS_VALIDATION.md`, `T1.8_IMAGEDIMS_COMPARISON.md` — the two detailed T1 findings
- `HARNESS_VERIFICATION_TRANSCRIPT.md` — records that the harness could not be run, and why
- `BLOCKED.md` — every blocked item, its reason, and who can close it
- `MANIFEST.sha256` — sha256 + byte size for every file in this pack

## Capture window
Start: 2026-08-29T18:19:47Z (see `CAPTURE_START_UTC.txt`). End: 2026-08-29T18:46Z (approx, this file's generation).
