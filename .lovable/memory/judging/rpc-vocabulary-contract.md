---
name: RPC Vocabulary Contract (16+2 strict)
description: Phase 6 closure (2026-05-02) — every status emitted by get_per_photo_consensus + get_per_photo_placement must be in PARTICIPANT_LABELS (16) ∪ {pending_consensus, r1_needs_review} (2 sentinels). R4 legacy aliases ('winner','finalist') were retired from the consensus RPC; R4 is now owned exclusively by the placement RPC.
type: feature
---

## Frozen Contract

The two read-only RPCs that drive every per-photo participant UI MUST only ever emit `status` values from this 18-key superset:

### 16 PARTICIPANT_LABELS keys (Frozen Contract v3 stage_keys)
- **R1**: `r1_accepted`, `r1_shortlisted_r2`, `r1_needs_verification`, `r1_rejected`
- **R2**: `r2_accepted`, `r2_qualified_r3`
- **R3**: `r3_accepted`, `r3_qualified_final`
- **R4**: `r4_winner`, `r4_runner_up_1`, `r4_runner_up_2`, `r4_honorary_mention`, `r4_special_jury`, `r4_top_50`, `r4_top_100`, `r4_finalist`

### 2 sentinels
- `pending_consensus` — no consensus reached / pre-publish (consensus RPC only)
- `r1_needs_review` — R1-only NR; not in PARTICIPANT_LABELS, UI maps to "Needs Review"

**Total: 16 + 2 = 18 allowed values.**

## R4 separation of concerns

- `get_per_photo_consensus` emits **only R1/R2/R3 + `pending_consensus`** (9 keys total). R4 photos collapse to `pending_consensus` because R4 awards are not derived from raw decisions.
- `get_per_photo_placement` emits **only the 8 R4 award keys** (`r4_*`), sourced from `judge_tag_assignments` joined with `judging_tags.label`.
- The frontend chokepoint `fetchPhotoStatusMaps` merges them with placement priority (`mergeConsensusAndPlacement`) — placement always wins for R4.

## Enforcement

| Layer | File | Trigger |
|---|---|---|
| Static spec | `src/test/rpc-consensus-vocabulary.spec.ts` | Runs in vitest CI on every PR |
| Live audit | `scripts/audits/rpc_contract_parity.mjs` | Hits live DB, fails if unknown key found |
| GitHub Actions | `.github/workflows/rpc-contract-parity.yml` | Both checks run on PRs touching `supabase/migrations/**` or `src/lib/judging/**` |
| DB comment | `COMMENT ON FUNCTION public.get_per_photo_consensus(uuid[])` | Documents the 9-key emit set as part of the schema |

## Live verification (post Phase-6-closure migration, 2026-05-02)

Live DB sample (1000 entries) returns exactly these distinct values:
- consensus: `pending_consensus, r1_accepted, r1_rejected, r1_shortlisted_r2, r2_accepted, r2_qualified_r3, r3_accepted, r3_qualified_final` (8)
- placement: `r4_honorary_mention, r4_runner_up_1, r4_runner_up_2, r4_special_jury, r4_top_100, r4_top_50, r4_winner` (7)

All 15 emitted values are inside the 18-key contract. ✅ `winner` and `finalist` no longer appear in consensus output.

## Migration history

- **Phase 6 initial (2026-05-02 morning)** — implemented as 16+2+2 (=20 keys); `winner`/`finalist` were tolerated R4 legacy aliases in consensus.
- **Phase 6 closure (2026-05-02 afternoon)** — migration `20260502090*` updated `get_per_photo_consensus` to drop the two R4 CASE branches. R4 awards are now sourced exclusively from `get_per_photo_placement`. The `mergeConsensusAndPlacement` chokepoint was already giving placement priority, so live UI behaviour is byte-identical for the only photo previously emitting `winner` (entry `31dc23d4-…cc5`, photo 16).

## Adding a new key

1. Add to `STAGE_CATALOG` (DB migration + `src/lib/judging/stageCatalog.ts`).
2. Add to `PARTICIPANT_LABELS` (`src/lib/judging/participantWording.ts`).
3. Re-run `bunx vitest run src/test/rpc-consensus-vocabulary.spec.ts` — should still pass.

If the new key is a sentinel (not a participant-facing label), add it to `ALLOWED_EXTRAS` in BOTH the spec and the audit script with a `// reason:` comment, and update this memory file.
