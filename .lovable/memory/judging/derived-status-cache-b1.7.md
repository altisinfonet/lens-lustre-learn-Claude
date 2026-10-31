---
name: Derived Status Cache (B1.7 + B1.8 + B1.9)
description: competition_entries.public_*_derived cache (5 fields) + recompute triggers + admin drift audit RPC; get_gated_entry_status reads from cache with view fallback
type: feature
---

## Cache columns (all on `competition_entries`)
- `public_status_derived text` (B1.7)
- `public_round_derived text` (B1.9)
- `public_placement_derived text` (B1.9)
- `public_progression_note_derived text` (B1.9)
- `public_r4_tags_derived text[]` (B1.9)

All mirror the canonical `entry_public_status` view 1:1.

## Recompute triggers
- `trg_entry_public_status_recompute` — AFTER INSERT/UPDATE OF (`stage_key`, `status`, `current_round`, `placement`, `progression_decision`) on `competition_entries`. Recomputes ALL 5 fields atomically.
- `trg_round_publish_recompute` — AFTER INSERT/UPDATE/DELETE on `competition_round_publish`; fans out to every entry of the competition.
- Helper: `recompute_entry_public_status(p_entry_id uuid)` (idempotent, only writes when any field drifts).

## Drift audit
- `get_gated_status_runtime_drift_admin(p_entry_ids uuid[] DEFAULT NULL)` — admin/super_admin only; returns `(entry_id, field, cache_value, view_value)` rows for any of the 5 cached fields that drift. Anon-blocked at GRANT layer.

## B1.8 + B1.9 — UI consumer migration (LIVE)
`get_gated_entry_status` now reads ALL 5 publish-gated fields from the cache (`public_*_derived`), with `COALESCE(..., view.*)` defensive fallback. Signature unchanged — every UI consumer (`useGatedEntryStatus`, `useEntryPublicStatus`, certificates, dashboard, profile, admin audits) automatically benefits without code changes.

## Status (post-B1.9 deploy)
- 30/30 entries backfilled.
- Drift across all 5 fields: 0/30 at deploy.

