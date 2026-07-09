# R6 — Auto-Generated Judging Vocabulary (Forensic Audit)

**Phase:** R6 — DX
**Mandate:** Five Strict Rules (No Assumptions, No Guesswork, No Part Checking, No Casual Approach, Claude Only)
**Date:** 2026-04-25
**Author:** Claude (Lovable)

---

## 1. Source of truth (DB-verified)

Live query against project `isywidnfnjhtydmdfgtk` (Lovable Cloud) on
2026-04-25:

```sql
SELECT m.tag_id, m.round_number, m.decision,
       t.label, t.color, t.icon, t.is_system, t.is_active, t.visible_in_round
FROM public.system_tag_decision_map m
LEFT JOIN public.judging_tags t ON t.id = m.tag_id
ORDER BY m.round_number, m.decision, t.label;
```

- **Row count returned:** **11**
- **Distinct rounds:** 1, 2, 3, 4
- **Distinct decisions:** `accept`, `shortlist`, `needs_verification`, `reject`
- **All tags:** `is_system = true`, `is_active = true`
- **Schema (`system_tag_decision_map`):** `tag_id uuid NOT NULL`, `round_number int NOT NULL`, `decision text NOT NULL`, `created_at timestamptz NOT NULL`
- **RLS on `system_tag_decision_map`:** `SELECT` allowed for `authenticated` (`USING (true)`). **Anon role has no policy** → live REST reads from CI without service-role would return `[]`. This is why the build script reads from a committed JSON snapshot, not from the live API.

## 2. Architecture (Hybrid — option C as confirmed by user)

```
                 ┌──────────────────────────────┐
                 │  system_tag_decision_map     │  (live DB)
                 │       ⋈ judging_tags         │
                 └──────────────┬───────────────┘
                                │
                ┌───────────────▼───────────────┐
                │ scripts/snapshot-vocabulary.mjs │
                │ ─ runs in vocabulary-snapshot.yml │
                │ ─ uses SUPABASE_SERVICE_ROLE_KEY │
                │ ─ NIGHTLY only (03:17 UTC) + manual│
                └───────────────┬───────────────┘
                                │ writes
                ┌───────────────▼───────────────┐
                │ docs/judging/vocabulary.source.json │  (committed)
                └───────────────┬───────────────┘
                                │ read by
                ┌───────────────▼───────────────┐
                │ scripts/generate-vocabulary.mjs │
                │ ─ pure / deterministic / no I/O │
                │ ─ runs in `bun run vocab:generate`│
                │ ─ `--check` mode for CI staleness│
                └───────────────┬───────────────┘
                                │ writes
                ┌───────────────▼───────────────┐
                │ docs/judging/vocabulary.md   │  (committed, generated)
                └──────────────────────────────┘
```

- **PR CI** (`audit-forbidden.yml`) runs `bun run vocab:check`. Fails the
  job if `vocabulary.md` ≠ `render(vocabulary.source.json)`. **No DB
  credentials required for PR CI.**
- **Nightly** (`vocabulary-snapshot.yml`) re-snapshots from the live DB
  and opens a PR if either file changed. Service-role key is scoped to
  this single workflow.

## 3. Files created / edited

| File | Status | Purpose |
|------|--------|---------|
| `docs/judging/vocabulary.source.json` | NEW | Committed snapshot (sourced from live DB) |
| `docs/judging/vocabulary.md` | NEW | Auto-generated glossary (do-not-edit banner) |
| `scripts/generate-vocabulary.mjs` | NEW | JSON → markdown; `--check` for CI |
| `scripts/snapshot-vocabulary.mjs` | NEW | Live DB → JSON (service role; nightly) |
| `package.json` | EDITED | Added `vocab:generate`, `vocab:check`, `vocab:snapshot` scripts |
| `.github/workflows/audit-forbidden.yml` | EDITED | Added vocab staleness gate step |
| `.github/workflows/vocabulary-snapshot.yml` | NEW | Nightly snapshot → PR |
| `scripts/audits/vocabulary_generator_r6.md` | NEW | This forensic audit |
| `.lovable/memory/judging/vocabulary-generator-r6.md` | NEW | Memory: source of truth + how to refresh |

## 4. PROVE — exhaustive verification

### 4.1 Generator is deterministic

```
$ node scripts/generate-vocabulary.mjs
[vocab] Wrote /dev-server/docs/judging/vocabulary.md (3739 bytes).

$ node scripts/generate-vocabulary.mjs --check
[vocab] OK — vocabulary.md is in sync with the JSON snapshot.   (exit 0)
```

### 4.2 Staleness gate fails on drift

```
$ echo "STALE EDIT" >> docs/judging/vocabulary.md
$ node scripts/generate-vocabulary.mjs --check
[vocab] STALE — docs/judging/vocabulary.md does not match the JSON snapshot.
        Run `bun run vocab:generate` and commit the result.   (exit 1)
```

### 4.3 Staleness gate clears after regeneration

```
$ git checkout docs/judging/vocabulary.md   # or restore from backup
$ node scripts/generate-vocabulary.mjs --check
[vocab] OK — vocabulary.md is in sync with the JSON snapshot.   (exit 0)
```

### 4.4 Row-count parity

| Source | Rows |
|--------|------|
| Live `system_tag_decision_map` (SELECT) | 11 |
| `vocabulary.source.json` `row_count` | 11 |
| Distinct tag rows rendered in `vocabulary.md` | 11 |

### 4.5 Round/decision distribution parity

| Round | DB rows | JSON rows | MD rows |
|-------|---------|-----------|---------|
| 1 | 4 | 4 | 4 |
| 2 | 3 | 3 | 3 |
| 3 | 3 | 3 | 3 |
| 4 | 1 | 1 | 1 |

## 5. Mandate compliance

| Rule | Compliance |
|------|------------|
| 1. No Assumptions | Every row in `vocabulary.md` traces back to a SQL row returned in §1. RLS limitation in §1 documented from `pg_policies`. |
| 2. No Guesswork | Hybrid architecture chosen only after the user explicitly answered the multiple-choice question (option C). No live-DB CI calls invented without the service-role key the user controls. |
| 3. No Part Checking | All four PROVE checks (generator, drift, restore, parity) executed. |
| 4. No Casual Approach | This audit, the memory file, and the do-not-edit banner are line-by-line documented. |
| 5. Claude Only | Entire phase produced by Claude (Lovable). |

## 6. Operator runbook

- **Local refresh after admin tag changes:**
  1. Run nightly workflow manually (`Actions → VOCAB SNAPSHOT → Run`), or
  2. Locally: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then
     `bun run vocab:snapshot && bun run vocab:generate`.
- **PR fails on `Vocabulary staleness gate`:** run `bun run vocab:generate`
  and commit `docs/judging/vocabulary.md`.
- **Required GitHub secrets** (one-time setup for the nightly workflow):
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
