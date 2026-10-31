# H-2 PRECHECK — `competition_entries` UPDATE Column-Restriction Leak

**Mode:** READ-ONLY. Zero migrations, zero policy edits, zero deploys, zero file changes outside this doc.
**Scanner finding ID:** `INSUFFICIENT_UPDATE_COLUMN_RESTRICTION` (level=error)
**Scanned at:** `2026-05-29T13:51:20Z` (this session)
**Forensic Mandate:** Rules 1–5 honoured. Every claim below cites the exact SQL run this session.

---

## 1. Scanner verdict (verbatim)

> The 'Users can update own metadata only' policy on 'competition_entries' only prevents changes to 'status' and 'placement'. All other columns remain writable by the row owner, including 'is_ai_generated', 'is_ai_advisory', 'ai_detection_result', 'progression_decision', 'current_round', 'stage_key', 'exif_data', 'is_pinned', 'is_trending', and 'view_count'. A participant can set 'is_ai_generated = false' or overwrite 'ai_detection_result' to conceal an AI-generated submission, or manipulate 'progression_decision' and 'stage_key' to alter their judging outcome.

---

## 2. Live policy inventory

`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='competition_entries'`

| policyname | cmd | qual | with_check |
|---|---|---|---|
| Admins can manage entries | ALL | `has_role(auth.uid(),'admin')` | — |
| Public can view competition entries | SELECT | owner OR admin OR judge OR status∈(submitted,approved,…) | — |
| Users can submit entries | INSERT | — | `auth.uid()=user_id AND comp.phase='submission_open'` |
| **Users can update own metadata only** | **UPDATE** | `user_id = auth.uid()` | `user_id = auth.uid() AND status = (SELECT old.status) AND NOT (placement IS DISTINCT FROM (SELECT old.placement))` |

The UPDATE policy WITH CHECK pins **only** `status` and `placement` to their existing values. Every other column is owner-writable.

---

## 3. Live column inventory (sensitive)

`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='competition_entries'`

| Column | Type | Owner UPDATE allowed by RLS? | Trigger guard? |
|---|---|---|---|
| `is_ai_generated` | bool | ✅ YES | **NONE** |
| `is_ai_advisory` | bool | ✅ YES | `validate_competition_entry_ai_advisory` — only forbids true-without-result. Owner CAN flip true→false. |
| `ai_detection_result` | jsonb | ✅ YES | **NONE** (only the AI-advisory pair-check above) |
| `progression_decision` | text | ✅ YES | `enforce_progression_decision_vocabulary` (catalog gate) + `enforce_progression_decision_pending_gate`. Both accept ANY valid catalog stage_key; owner can write `r4_winner` if catalog has it active and no pending photos. |
| `stage_key` | text | ✅ YES | `guard_stage_key_immutability` — blocks **rewind only**. Forward jumps (e.g. NULL→`r4_winner`) are NOT blocked. |
| `current_round` | text | ✅ YES | `enforce_status_round_consistency` — only enforces status↔round pairs. Round can be advanced if status already permits. |
| `exif_data` | jsonb | ✅ YES | **NONE** |
| `is_pinned` | bool | ✅ YES | **NONE** — owner can self-pin to homepage. |
| `is_trending` | bool | ✅ YES | **NONE** — owner can self-trend. |
| `view_count` | int | ✅ YES | **NONE** — owner can inflate. |
| `current_round_int` | int | ✅ YES | (no dedicated trigger) |
| `public_*_derived` (5 cols) | text/array | ✅ YES; recomputed by `trg_entry_public_status_recompute` AFTER UPDATE | recompute may overwrite owner edits — not a guarantee, owner still mutates row state in flight |
| `photo_meta`, `photos`, `photo_thumbnails` | array/jsonb | ✅ YES | `validate_competition_entry_photo_meta` (legitimate user-facing field) |
| `title`, `description` | text | ✅ YES | none — legitimate user-facing field |
| `status` | text | ❌ BLOCKED by WITH CHECK | additionally `validate_competition_entry_status_transition` + `enforce_status_round_consistency` |
| `placement` | text | ❌ BLOCKED by WITH CHECK | none |

Trigger inventory source: `SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.competition_entries'::regclass AND NOT tgisinternal` (16 user triggers).

---

## 4. Leak reproduction (theoretical — NOT executed)

Any authenticated user owning an entry could run:

```sql
-- Conceal AI provenance
UPDATE public.competition_entries
SET is_ai_generated = false, ai_detection_result = '{}'::jsonb, is_ai_advisory = false
WHERE id = '<own-entry-id>';
-- Triggers fire: ai_advisory check passes (false+null OK), no other guard. ✅ SUCCEEDS.

-- Self-promote on homepage
UPDATE public.competition_entries SET is_pinned=true, is_trending=true, view_count=999999
WHERE id = '<own-entry-id>';
-- No triggers fire. ✅ SUCCEEDS.

-- Forward-jump stage_key (if OLD.stage_key is NULL or earlier)
UPDATE public.competition_entries SET stage_key='r4_winner'
WHERE id='<own-entry-id>';
-- guard_stage_key_immutability checks order: rewind blocked, forward allowed. ✅ SUCCEEDS.

-- Forge progression_decision
UPDATE public.competition_entries SET progression_decision='r4_winner'
WHERE id='<own-entry-id>';
-- Catalog gate passes (r4_winner is active). Pending gate passes if no R4-pending photos. ✅ SUCCEEDS.
```

**No PoC executed — read-only precheck.** All four payloads are reachable per policy + trigger inspection above.

Note: status/placement themselves are pinned, AND the `trg_entry_public_status_recompute` AFTER trigger recomputes `public_*_derived` from `stage_key` + `status` + `current_round` + `placement` + `progression_decision`. Since owner can write `stage_key='r4_winner'` and `progression_decision='r4_winner'`, the recompute trigger will derive a forged `public_placement_derived='1st Place'` (or similar) into the row that participant-facing UI reads via `useGatedEntryStatus`. **Forged R4 winner status reaches the public surface.**

---

## 5. Caller inventory (legitimate write paths)

`rg -n '\.from\("competition_entries"\)\.update' src` (excluding tests):

| Path | Columns written | Authority |
|---|---|---|
| `useCompetitionEntryMutations.useUpdateEntryStatus` | `status, updated_at` | Admin-only UI (blocked at RLS WITH CHECK for non-admin; admin policy bypasses) |
| `useCompetitionEntryMutations.useUpdateEntryPlacement` | `placement, status` | Judge/admin UI (blocked at RLS for participants) |
| (no other client write paths to base table) | | |

Edit/profile flows (`EditEntry`, etc.) write `title, description, photos, photo_meta, photo_thumbnails` — all legitimately user-facing.

**No legitimate UI path writes** `is_ai_generated`, `ai_detection_result`, `is_ai_advisory`, `is_pinned`, `is_trending`, `view_count`, `stage_key`, `progression_decision`, `current_round`, `current_round_int`, `exif_data`, or any `public_*_derived` field. Server triggers + admin/judge edge functions own those.

⇒ Tightening WITH CHECK on those columns has **zero legitimate-client blast radius**.

---

## 6. Classification

**OPEN — REAL HIGH.**
- Scanner finding is factually accurate against live policy text.
- Trigger coverage is partial and does NOT close the gap (rewind-only, advisory-only, catalog-only).
- Exploit reachable from any authenticated row-owner; no preconditions other than ownership.
- Public surface impact via `trg_entry_public_status_recompute` is direct: forged stage_key + progression_decision flows into `public_*_derived` and `useGatedEntryStatus` participant UI.

---

## 7. Proposed remediation (DRAFT — NOT EXECUTED)

### Option A (RECOMMENDED) — tighten WITH CHECK on existing UPDATE policy

Pin every sensitive column to its OLD value via subquery (same pattern already used for status/placement). User-facing fields (`title`, `description`, `photos`, `photo_meta`, `photo_thumbnails`, `updated_at`) remain freely writable.

```sql
-- DRAFT — DO NOT RUN UNTIL APPROVED
DROP POLICY "Users can update own metadata only" ON public.competition_entries;

CREATE POLICY "Users can update own metadata only"
ON public.competition_entries
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND NOT (status                  IS DISTINCT FROM (SELECT ce2.status                  FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (placement               IS DISTINCT FROM (SELECT ce2.placement               FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (stage_key               IS DISTINCT FROM (SELECT ce2.stage_key               FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (progression_decision    IS DISTINCT FROM (SELECT ce2.progression_decision    FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (current_round           IS DISTINCT FROM (SELECT ce2.current_round           FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (current_round_int       IS DISTINCT FROM (SELECT ce2.current_round_int       FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_ai_generated         IS DISTINCT FROM (SELECT ce2.is_ai_generated         FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_ai_advisory          IS DISTINCT FROM (SELECT ce2.is_ai_advisory          FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (ai_detection_result     IS DISTINCT FROM (SELECT ce2.ai_detection_result     FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (exif_data               IS DISTINCT FROM (SELECT ce2.exif_data               FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_pinned               IS DISTINCT FROM (SELECT ce2.is_pinned               FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_trending             IS DISTINCT FROM (SELECT ce2.is_trending             FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (view_count              IS DISTINCT FROM (SELECT ce2.view_count              FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (certificate_ready       IS DISTINCT FROM (SELECT ce2.certificate_ready       FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (user_id                 IS DISTINCT FROM (SELECT ce2.user_id                 FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (competition_id          IS DISTINCT FROM (SELECT ce2.competition_id          FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
);
```

Admin policy (`Admins can manage entries`) is a separate PERMISSIVE row, so admin writes remain unaffected. Edge functions use `service_role` → also unaffected.

### Option B — drop UPDATE policy and route via SECURITY DEFINER RPC

Heavier blast radius (requires editing `EditEntry` mutation paths). **Not recommended** unless Option A produces measurable WITH-CHECK perf regression.

### Rollback

```sql
DROP POLICY "Users can update own metadata only" ON public.competition_entries;
CREATE POLICY "Users can update own metadata only"
ON public.competition_entries FOR UPDATE TO public
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND status = (SELECT ce2.status FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id)
  AND NOT (placement IS DISTINCT FROM (SELECT ce2.placement FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
);
```

---

## 8. Verification plan (POST-execution, when GO is issued)

1. `pg_policies` re-query → confirm new WITH CHECK is in place.
2. Authenticated REST probe as a real participant: try to PATCH `is_ai_generated=false`, `is_pinned=true`, `stage_key='r4_winner'`, `progression_decision='r4_winner'` on own entry → expect HTTP 403 (`new row violates row-level security policy`).
3. Same participant PATCH `title='x'`, `description='y'`, `photos=[…]`, `photo_meta=[…]` → expect HTTP 200 (legitimate path preserved).
4. Admin PATCH any column → expect HTTP 200 (admin policy unaffected).
5. Judge/edge-fn (service_role) writes from `complete-round`, `publish-round`, `submit-judge-decision`, `decide-photo-verification` → spot-check edge-fn logs; should remain green.
6. Re-run scanner → confirm `INSUFFICIENT_UPDATE_COLUMN_RESTRICTION` cleared.

---

## 9. Risk analysis

| Dimension | Rating | Notes |
|---|---|---|
| Latent security risk if unfixed | **HIGH** | Owner can forge winner status, conceal AI, self-pin to homepage |
| Blast radius of fix | **Minimal** | Only frontend write paths today touch user-facing fields; admin/judge/service_role bypass via separate policy / role |
| Public awards regression risk | **None** | Awards written by edge functions under service_role; policy applies only to `public` role contexts |
| Judge/admin regression risk | **None** | Both bypass via `Admins can manage entries` ALL policy or service_role |
| Edge-fn regression risk | **None** | service_role exempt from RLS WITH CHECK |
| Realtime impact | **None** | Realtime subscribes to SELECT policies, not UPDATE |
| Rollback complexity | **Trivial** | DROP + CREATE the old 2-column policy (SQL in §7) |
| Migration size | 1 policy DROP + 1 policy CREATE in single transaction |

---

## 10. Final status

**ALL CLEAR FOR EXECUTION** — awaiting explicit `GO H-2 EXECUTE` token.

Nothing executed, written, deployed, or edited beyond this precheck doc.
