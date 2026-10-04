# P3 · client subscription inventory — producer and PROPOSED schema

**D2 · 2026-10-04 · staging `1677dc2` · `scripts/web-subscription-scan.mjs`.**

## Status: proposal, not a frozen interface

P3's parity check is two producers and a comparator: `scripts/web-subscription-scan.mjs`
(D2, this file's subject), `scripts/db-publication-export.mjs` (D1), and a third
script that compares them and fails the build **in both directions**. The plan
says the JSON schema is frozen by the Auditor first, and neither developer edits
the other's producer.

**There is no P3 interface under `docs/gates/` today** (checked on staging
`1677dc2`: the directory holds `P1-interface.md` and `TC-v3-interface.md`, no P3).
That is the same test P1 had to pass before its client half could be written —
the interface exists as a file or the unit has not started.

So this PR ships **the producer and the reading only**. It does not ship the
comparator and it wires nothing into the build. A comparator written against a
shape nobody froze is how two halves drift; the shape below is submitted for the
Auditor to freeze, amend or reject.

## The reading, 2026-10-04

```
node scripts/web-subscription-scan.mjs --out docs/evidence/d2/phase3/subscription-scan.json
web-subscription-scan: 52 subscription(s) in 23 file(s), 29 table(s), 0 unresolved
```

**The plan's figure of "56 subscriptions across 26 files" is close but not right,
and the difference is worth stating rather than rounding away:**

| | |
|---|---|
| `postgres_changes` occurrences anywhere under `src/` | **56** |
| of those, inside `__tests__` / `*.test.*` / `uiharness` / `test-utils` | **4** |
| real subscriptions the client opens | **52**, in **23** files |
| tables subscribed | **29** |
| tables the scan could not resolve | **0** |

Reconciled per file against a raw `grep -c postgres_changes` over the same
exclusion set: **no file differs**. The scanner is not quietly missing four.

## Proposed output shape (`schemaVersion: 1`)

```jsonc
{
  "producer": "web-subscription-scan",
  "schemaVersion": 1,
  "generatedBy": "scripts/web-subscription-scan.mjs",
  "root": "src",
  "counts": { "subscriptions": 52, "files": 23, "tables": 29, "unresolved": 0 },
  "tables": ["ad_creative_reactions", "…"],      // sorted, de-duplicated — what the comparator reads
  "subscriptions": [
    {
      "file": "src/hooks/core/useAuth.tsx",
      "line": 200,
      "channel": "profile-guard-…" ,             // null when the name is a template literal
      "schema": "public",
      "table": "profiles",                        // null ONLY when unresolved, never guessed
      "event": "*",
      "filter": "id=eq.…"                         // null when absent
    }
  ],
  "unresolved": [ { "file": "…", "line": 1, "raw": "table: tableName" } ]
}
```

`tables` is the field a comparator needs; the rest is there so a mismatch can be
traced to a line rather than argued about.

## What it refuses to guess, and why that is the point

A `table:` whose value is not a string literal goes into `unresolved` — never
dropped, never inferred from a variable name. A scan that silently skips what it
cannot read reports fewer subscriptions than exist and **looks like good news**.
That is the failure the P10 inventory had to close by failing on an unresolvable
delay instead of assuming it was fine. `--strict` exits 1 when `unresolved` is
non-empty, so the comparator can refuse to run on a partial reading.

## Honest limits of a regex scan

1. **Channel association.** A file may open several channels; the scanner records
   "the last `.channel(` opened above this call". It is recorded as an
   association, not asserted as a fact, and `channel` is null when the name is
   built from a template literal.
2. **A table name built at runtime** cannot be resolved by any static scan. It is
   reported, which is the most a scan can honestly do.
3. **It reads `postgres_changes` only.** Presence and broadcast channels are not
   publication subscriptions and are deliberately out of scope —
   `src/lib/presence/online.ts` is a presence channel and does not appear here.

## Already visible in the reading, for P4

All five configuration tables named in the client rules carry exactly one
subscribing file each:

| table | file |
|---|---|
| `site_settings` | `src/lib/liveAdminSync.ts` |
| `role_display_config` | `src/hooks/profile/useRoleDefinitions.ts` |
| `badge_definitions` | `src/hooks/profile/useBadgeDefinitions.ts` |
| `courses` | `src/hooks/content/useCourses.ts` |
| `support_tickets` | `src/components/admin/AdminLayout.tsx` |

That is the 580,000-requests-for-35-rows shape, and it is P4's subject, not this
unit's. Recorded here because the reading already answers it.

## Ask of the Auditor

Freeze, amend or reject `schemaVersion: 1` above. Once a shape is frozen and
D1's `scripts/db-publication-export.mjs` exists, the comparator and the build
gate are one further PR.
