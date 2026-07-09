<!--
  AUTO-GENERATED — DO NOT EDIT BY HAND.
  Source:    docs/judging/vocabulary.source.json
  Generator: scripts/generate-vocabulary.mjs
  To refresh: bun run vocab:generate
  CI fails if this file is stale (audit-forbidden workflow).
-->

# Judging Vocabulary

Single, authoritative glossary for every system decision tag in the judging pipeline.
Generated from `system_tag_decision_map` joined to `judging_tags`.

- **Snapshot taken (UTC):** `2026-04-25T00:00:00Z`
- **Row count:** 11
- **Source view:** `system_tag_decision_map ⋈ judging_tags`

---

## Decision Families

| Decision | Meaning |
|----------|---------|
| `accept` | Photo is accepted in the current round and advances to the next round. |
| `shortlist` | Photo qualifies and advances to the next round (used for explicit progression labels in Rounds 1–3). |
| `needs_verification` | Photo is placed on hold; participant must upload the original/RAW source file before judging continues. |
| `reject` | Photo is removed from contention. In Round 1 this exits the competition entirely. In Rounds 2–3 it keeps current-round qualification but is OUT for the next round. |

---

## Tags by Round

### Round 1 — Initial Screening

| Decision | Tag Label | Color | Icon | System | Active | Visible In | Tag ID |
|----------|-----------|-------|------|--------|--------|------------|--------|
| `accept` | Accepted | `#00ff4c` | award | ✅ | ✅ | [1] | `4f1805d5-0a86-4abf-bb27-496da58bd0b2` |
| `shortlist` | Qualified for 2nd Round | `#fee22f` | sparkles | ✅ | ✅ | [1] | `13f2d1bd-06cd-40e8-a086-64762d6fa372` |
| `needs_verification` | Verification Required - Round 1 | `#17d0d3` | check | ✅ | ✅ | [1] | `ec03eecf-800d-4028-909c-a11a75033327` |
| `reject` | Rejected | `#ff0000` | award | ✅ | ✅ | [1] | `4b440411-1efe-49c4-a9ee-a491a78bdb4d` |

### Round 2 — Quality Evaluation

| Decision | Tag Label | Color | Icon | System | Active | Visible In | Tag ID |
|----------|-----------|-------|------|--------|--------|------------|--------|
| `shortlist` | Qualified for 3rd Round | `#00ffaa` | sparkles | ✅ | ✅ | [2] | `67d446d4-fec6-4f45-8643-03c3ff2d462f` |
| `needs_verification` | Verification Required - Round 2 | `#17d0d3` | check | ✅ | ✅ | [2] | `c570fc9f-043b-4ee2-8591-fa2389c55812` |
| `reject` | Not Selected for 3rd Round | `#d31763` | check | ✅ | ✅ | [2] | `bce0e662-76cb-4196-9798-e7d14bd1d782` |

### Round 3 — Penultimate Selection

| Decision | Tag Label | Color | Icon | System | Active | Visible In | Tag ID |
|----------|-----------|-------|------|--------|--------|------------|--------|
| `shortlist` | Qualified for Final Round | `#dcfeb4` | sparkles | ✅ | ✅ | [3] | `df11381a-1d96-4c46-8439-747ed3a7b0c6` |
| `needs_verification` | Verification Required - Round 3 | `#17d0d3` | check | ✅ | ✅ | [3] | `16f90d24-10d8-46a8-8024-202d1fdd80a0` |
| `reject` | Not Selected for Final Round | `#d1cdc2` | gem | ✅ | ✅ | [3] | `15012bbe-9d46-42e1-8e38-a639a3f5769f` |

### Round 4 — Final Round

| Decision | Tag Label | Color | Icon | System | Active | Visible In | Tag ID |
|----------|-----------|-------|------|--------|--------|------------|--------|
| `needs_verification` | Verification Required - Final Round | `#17d0d3` | check | ✅ | ✅ | [4] | `7ba445d6-fae5-46b4-8656-f281a6b22159` |

---

## Onboarding Notes

- **Judges** apply tags from this list only — they cannot create new tags.
- **Admins** manage tags via the Judging Tags admin module. New rows in
  `system_tag_decision_map` automatically appear here on the next snapshot.
- **Developers** must regenerate this file after refreshing the snapshot:
  ```bash
  bun run vocab:generate
  ```
- **CI** runs `bun run vocab:check` and blocks PRs where this file does
  not match the JSON snapshot.

