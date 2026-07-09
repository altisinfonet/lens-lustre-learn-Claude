---
name: Email Re-Keying Phase 7
description: Every judging-lifecycle email payload now carries canonical v3 stageKey via _resolve_stage_key_from_entry; legacy placement/entryStatus kept for back-compat
type: feature
---

# Phase 7 — Email Template Re-Keying (DONE)

## What changed

Every judging-lifecycle DB function that calls `public.emit_notification` now
embeds a canonical v3 `stageKey` (e.g. `r1_shortlisted_r2`, `r4_top_50`,
`r4_winner`) in the `email_data` jsonb payload.

Single source of truth: `public._resolve_stage_key_from_entry(status,
current_round, progression_decision)` — IMMUTABLE helper. `progression_decision`
wins when present; otherwise the legacy `status` + `current_round` text pair is
mapped via the same CASE table that `trg_entry_status_lifecycle_emit` uses.

## Functions updated

- `notify_entry_status_change` (the trigger actually wired to
  `competition_entries`)
- `notify_round_published`
- `notify_round_published_insert`
- `backfill_judging_notifications`
- `trg_entry_status_lifecycle_emit` (already had stageKey from earlier work)

## Templates

No template changes were needed — every transactional template under
`supabase/functions/_shared/transactional-email-templates/` already prefers
`stageKey` and resolves the human-readable label via `labelForStageKey()` from
`stageCatalog.ts`. Legacy `placement` / `entryStatus` props are still accepted
as fallbacks (safe for in-flight queue items).

## Regression lock

`src/test/notifications-stage-key-payload.spec.ts` — 6 tests, parses the
latest migration that defines each emitter and asserts every
`emit_notification(...)` call site has a matching `'stageKey'` in its payload.
Will fail CI if a future edit drops the canonical key.

## Why this matters

Before Phase 7: `notify_entry_status_change` and the round-publish triggers
sent payloads like `{placement: "honourable_mention"}`. Templates worked
because they had a back-compat alias map, but the source of truth was the
legacy string. Any template that lost its back-compat map (or any new
template added) would render the raw legacy string to participants.

After Phase 7: every payload includes `stageKey: "r4_honorary_mention"`
(canonical v3 key from `v3_stage_catalog`). Templates resolve the label via
`labelForStageKey()` — same path as the in-app UI. Email and UI now share one
vocabulary.
