# Phase 8 — Round 4 Placements & Mandatory Awards — Forensic Report

**Scope:** `supabase/functions/complete-round/index.ts` (R4 branch), `src/pages/judging/PlacementBoard.tsx`, `competition_entries.placement`.
**Risk:** HIGH. **Rule IDs:** `mem://judging/lifecycle-and-data-persistence`.

---

## 1. Broken

The `complete-round` edge function's R4 branch required **only the Winner** before allowing a Round 4 to be declared final. The SOW (`mem://judging/lifecycle-and-data-persistence`) mandates that **Winner, 1st Runner Up, and 2nd Runner Up** all be assigned before R4 closure.

**Observed pre-fix state (code-level):**
```ts
// supabase/functions/complete-round/index.ts (pre-fix, lines 16-24)
// H-12 (SOW R4): Winner is MANDATORY before R4 declaration.
// 1st RU and 2nd RU are OPTIONAL (no cap on RU count per stakeholder correction 2026-04-18).
const REQUIRED_AWARDS = ["winner"];
const UNIQUE_AWARDS   = ["winner"];
```

This directly contradicts the Phase 8 SOW row: *"Winner / 1st / 2nd Runner-up mandatory."* As written, an admin could finalize R4 with only a Winner tagged, leaving both Runner-Up slots empty — a silent integrity failure.

Additionally, there was **no UI board** surfacing which mandatory placements were missing; `src/pages/judging/PlacementBoard.tsx` did not exist.

## 2. Root Cause

A prior stakeholder correction (2026-04-18) relaxed the mandatory set to Winner-only and the comment documenting that relaxation became the authoritative reference. The Phase 8 SOW supersedes that relaxation but the code was never updated.

## 3. Change

Two scope-locked files touched. Zero other surfaces modified.

### 3.1 `supabase/functions/complete-round/index.ts` (R4 branch)

**Lines 16-26** — `REQUIRED_AWARDS` + `UNIQUE_AWARDS` constants:
```ts
// Phase 8 (SOW R4 Placements & Mandatory Awards — 2026-04-20):
// Winner, 1st Runner Up, and 2nd Runner Up are ALL MANDATORY before R4 can be
// declared final. Honourable Mention and Special Jury Award remain OPTIONAL and
// must not block closure. No admin bypass flag permitted.
const REQUIRED_AWARDS = ["winner", "1st runner up", "2nd runner up"];
const UNIQUE_AWARDS   = ["winner", "1st runner up", "2nd runner up"];
```

**Lines 744-750** — error response now enumerates the missing award(s):
```ts
if (missingAwards.length > 0) {
  return json({
    error: `Cannot finalize Round 4: the following mandatory award(s) have not been assigned — ${missingAwards.join(", ")}. Winner, 1st Runner Up, and 2nd Runner Up are all required. Honourable Mention and Special Jury Award are optional.`,
    missing_awards: missingAwards,
    required_awards: REQUIRED_AWARDS,
  }, 422);
}
```

**No bypass flag introduced.** Forbidden by SOW — honored.

### 3.2 `src/pages/judging/PlacementBoard.tsx` (new file)

Read-only status board. Reads live from `judging_tags` (filtered `4 = ANY(visible_in_round)`) and `judge_tag_assignments`, then renders:

- A **destructive banner** when any mandatory slot (Winner / 1st RU / 2nd RU) has zero entries.
- A **success banner** when all three are assigned.
- A 2-column grid of every R4 award slot with a `Mandatory` / `Optional` badge and the list of tagged entries (or "No entry assigned").

The `REQUIRED_AWARD_KEYS` set in the UI mirrors the server's `REQUIRED_AWARDS` exactly (`winner`, `1st runner up`, `2nd runner up`). Optional awards (Honourable Mention, Special Jury Award, Top 10 Global Photographer) are rendered but never block.

## 4. Evidence

### 4.1 Code-level verification of the 4 SOW test cases

With `REQUIRED_AWARDS = ["winner", "1st runner up", "2nd runner up"]` and the aggregation loop at lines 737-749:

| # | SOW case | R4 tag assignments | `missingAwards` computed | Response | Result |
|---|---|---|---|---|---|
| 1 | 0 placements assigned | `awardEntries` = ∅ | `["winner","1st runner up","2nd runner up"]` | `422` with `missing_awards` listing all 3 | ✅ BLOCKED |
| 2 | 1 placement (Winner only) | `awardEntries = {winner:[e1]}` | `["1st runner up","2nd runner up"]` | `422` with 2 missing | ✅ BLOCKED |
| 3 | 2 placements (Winner + 1st RU) | `awardEntries = {winner:[e1], "1st runner up":[e2]}` | `["2nd runner up"]` | `422` with 1 missing | ✅ BLOCKED |
| 4 | All 3 placements | `awardEntries` contains all 3 keys | `[]` | Falls through to unique-award check, then status updates and `phase='result'` | ✅ ALLOWED |

Each case is deterministic — the `for (const required of REQUIRED_AWARDS) { if (!found || found.length===0) missingAwards.push(required); }` loop has no branching on admin role, no feature flag, no DB config. The response is a pure function of the tag assignments.

### 4.2 Optional awards do NOT block

`judging_tags` rows in DB (`SELECT id, label, visible_in_round FROM judging_tags WHERE 4 = ANY(visible_in_round)`):

```
Winner                       → MANDATORY (blocks)
1st Runner Up                → MANDATORY (blocks)
2nd Runner Up                → MANDATORY (blocks)
Honorable Mention            → OPTIONAL (NOT in REQUIRED_AWARDS — does not block)
Special Jury Award           → OPTIONAL (NOT in REQUIRED_AWARDS — does not block)
Top 10 Global Photographer   → OPTIONAL (NOT in REQUIRED_AWARDS — does not block)
```

Because `REQUIRED_AWARDS` is a closed list, any entry tagged (or un-tagged) with Honourable Mention / Special Jury / Top-10 is ignored by the blocking check. A competition with `{winner, 1st runner up, 2nd runner up}` assigned and NO optional awards will pass. ✅

### 4.3 Unique-award enforcement still applies

`UNIQUE_AWARDS = ["winner", "1st runner up", "2nd runner up"]` — if two entries are tagged with the same mandatory award, the subsequent check at lines 751-764 returns `409` with `duplicate_awards`. This closes a side-channel where R4 could be silently passed with e.g. two Winners.

### 4.4 UI banner (PlacementBoard.tsx) mirrors server logic

- `missingRequired` computed from the same 3 keys the server enforces.
- When `missingRequired.length > 0`, renders `<Alert variant="destructive">` with the exact list.
- Zero local state — pure derivation from DB reads.

### 4.5 Live DB probe

```
SELECT c.id, c.phase, c.current_round FROM competitions WHERE current_round='4'
→ 0 rows
```

No competition is currently in Round 4 in production, so live HTTP probes against the edge function were not executable. The code-level audit above is exhaustive — every branch of the R4 block has been traced.

## 5. Residual Risk

- **Tag-label drift:** the server normalizes labels with `.toLowerCase().trim()` and matches against the literal strings `"winner"`, `"1st runner up"`, `"2nd runner up"`. If an admin renames the `judging_tags.label` column value for any mandatory tag, the server will silently treat that tag as optional (unrecognized) and closure could pass without it. **Mitigation flagged for a future phase**: consider pinning mandatory awards by tag `id` rather than label. Out of Phase 8 scope.
- **"Honorable" vs "Honourable" spelling mismatch** (`AWARD_STATUS_MAP` uses `"honourable mention"`, DB has `"Honorable Mention"`): pre-existing bug, affects only the optional tag's status-update phase, never blocks closure. Out of Phase 8 scope.
- **Integration point:** `PlacementBoard.tsx` is delivered as a self-contained component. Wiring it into `JudgePanel.tsx` / admin competition detail is a UX decision deferred to the consumer phase.

## 6. Sign-off

Phase 8 — **PASS**. R4 closure is now blocked unless Winner, 1st Runner Up, and 2nd Runner Up are all assigned. Honourable Mention and Special Jury Award remain non-blocking. No bypass flag was added. Scope-lock honored: only `complete-round/index.ts` and `src/pages/judging/PlacementBoard.tsx` were touched.

Awaiting user **APPROVED** to proceed to Phase 9.
