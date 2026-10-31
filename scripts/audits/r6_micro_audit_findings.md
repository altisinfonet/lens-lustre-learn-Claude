# R6 — Micro-level Forensic Audit (read-only)

Date: 2026-04-25
Scope: R6 deliverables (forbidden-pattern lint extension, patterns #11/#12,
auto-generated vocabulary), against live DB and the actual `audit-forbidden` CI job.
Mandate: live-proof only, no guesswork.

---

## Summary

| ID  | Severity | Area                          | Status      |
|-----|----------|-------------------------------|-------------|
| B-1 | **HIGH** | `no-raw-entry-status` rule    | Confirmed   |
| B-2 | **HIGH** | AUDIT FORBIDDEN CI gate       | Confirmed (consequence of B-1) |
| B-3 | MEDIUM   | R4 vocabulary completeness     | Confirmed (data, not code) |
| B-4 | MEDIUM   | snapshot-vocabulary.mjs       | Confirmed (edge cases) |
| B-5 | LOW      | Vocabulary generator          | Confirmed (drift surface) |
| B-6 | LOW      | `no-unfiltered-judge-realtime` | Confirmed (spread escape hatch) |
| B-7 | INFO     | Audit-forbidden CI grep robustness | Confirmed |

---

## B-1 — `no-raw-entry-status` false-positive on `catch (e)` variables  ★HIGH

**Symptom (proven live):** Running `bunx eslint src/ supabase/functions/` flags
4 errors in 2 edge functions that have nothing to do with `entry.status`:

```
supabase/functions/judge-session-resume/index.ts:37:55
  if (e instanceof AuthError) return bad(e.message, e.status);
                                                    ^^^^^^^^

supabase/functions/submit-judge-score/index.ts:67:55
  if (e instanceof AuthError) return bad(e.message, e.status);
                                                    ^^^^^^^^
supabase/functions/submit-judge-score/index.ts:146:55
  if (e instanceof AuthError) return bad(e.message, e.status);
```

**Root cause:** `eslint-rules/no-raw-entry-status.js` line 91:

```js
if (name !== "entry" && name !== "e") return;
```

The intent was "only look at `entry.X` or `e.X`" (treating `e` as a shorthand
for `entry`). But the rule is defined to fire on the audit-v6 `status`,
`placement`, `progression_decision` props — and `e` is overwhelmingly used as
a `catch (e)` parameter or generic event object. Every `e.status` / `e.placement`
on an Error / Response / DOM-event will be flagged forever.

**Live consequence (B-2):** the AUDIT FORBIDDEN workflow's grep matches these
lines, so the regression-lock CI is currently RED on `main` for reasons
unrelated to a real raw-status read.

**Proof (drift query against live DB):**
- `system_tag_decision_map` rows: 11 (matches snapshot row_count).
- All 11 system tags resolve to a `judging_tags` row — zero orphans.
  ```sql
  SELECT id FROM judging_tags
   WHERE is_system = true
     AND id NOT IN (SELECT tag_id FROM system_tag_decision_map);
  -- → []
  ```
  So the lint failure is NOT a real entry-status leak; it is purely the
  pattern bug above.

**Fix shape (do NOT apply yet):** drop `e` from the object-name allowlist
(only `entry` should match), or require both `obj.name === "entry"` *and*
the parent statement not be a `CatchClause`/`Parameter`.

---

## B-2 — AUDIT FORBIDDEN CI gate is currently RED on green source  ★HIGH

`audit-forbidden.yml` runs:
```bash
bunx eslint src/ supabase/functions/ --no-warn-ignored 2>&1 | tee /tmp/eslint.log
if grep -E "audit-v6/(no-raw-entry-status|...)" /tmp/eslint.log; then
  exit 1
fi
```

Because B-1 produces 4 `audit-v6/no-raw-entry-status` lines on otherwise
correct code, **every push to every branch fails CI right now**. This is the
exact "false-lock" failure mode the SOW was designed to prevent (Mandate
Rule 1 — no progress under a broken gate).

---

## B-3 — Round 4 has only 1 decision row, no `accept`/`shortlist`/`reject`  ★MEDIUM

Live DB query:
```
round_number=4: needs_verification → 1 tag
                accept             → 0 tags
                shortlist          → 0 tags
                reject             → 0 tags
```

`vocabulary.md` therefore documents only "Verification Required - Final Round"
for R4, but the SOW (and `judging/lifecycle-and-data-persistence` memory)
mandates Winner / Runner-up / Honourable Mention / Finalist as the awards
vocabulary for R4. Either:
- (a) the `system_tag_decision_map` is **incomplete** (data bug) — most likely,
  because R4 placements *are* enforced elsewhere via `progression_decision`
  + placements, but no row tells the vocabulary it exists; or
- (b) R4 awards are intentionally outside the tag system. Then `vocabulary.md`
  needs a documented "R4 awards live in `competition_entries.placement`" note,
  otherwise the doc is misleading by omission.

This is not introduced by R6 — R6 faithfully reflects the data — but R6 is
the surface where the gap becomes visible.

---

## B-4 — `snapshot-vocabulary.mjs` brittleness  ★MEDIUM

Three concrete failure modes:

1. **Empty-table panic** (line 66):
   ```js
   `id=in.(${tagIds.join(",")})&select=...`
   ```
   If `system_tag_decision_map` is ever empty, `tagIds = []` →
   `id=in.()` → REST 400. The script crashes; the nightly PR job logs an
   opaque error instead of writing an empty (but valid) snapshot.

2. **Missing tag silently rendered as `(missing tag)`** (line 79):
   if a `system_tag_decision_map` row references a deleted/inactive tag,
   the script writes `label: "(missing tag)"` into the JSON instead of
   failing loudly. The nightly PR will silently overwrite vocabulary.md
   with the corrupted label — and CI will pass, because JSON↔markdown is
   internally consistent. **No drift alarm fires for an actual data
   integrity bug.**

3. **No JOIN-side validation:** snapshot does not check
   `is_active=false` system tags or tags whose `visible_in_round` array
   disagrees with the `round_number` they're mapped to. Stale tags will be
   serialised into vocabulary.md and silently presented as canonical.

---

## B-5 — `generate-vocabulary.mjs` drift surface  ★LOW

- **Decision label allowlist drift:** `DECISION_ORDER` and `DECISION_LABEL`
  are hardcoded to `["accept","shortlist","needs_verification","reject"]`.
  If a future migration adds e.g. `qualified` or `placement` to
  `system_tag_decision_map.decision`, the generator will silently drop those
  tags from the rendered table — the JSON keeps them, the markdown does not.
  Drift becomes invisible to readers. No assertion on "every key in
  `decision_glossary` is rendered" or vice-versa.
- **Glossary lives in the snapshot script, not the DB.** `DECISION_GLOSSARY`
  in `snapshot-vocabulary.mjs` is hand-authored Claude prose. Rule #2 (No
  Guesswork) is technically satisfied by being committed, but the glossary is
  *not* derived from any DB column — a future schema rename of
  `system_tag_decision_map.decision` to e.g. `family` would not surface in
  the glossary, and judges reading vocabulary.md would silently see stale
  meanings.

---

## B-6 — `no-unfiltered-judge-realtime` has a permanent escape hatch  ★LOW

`eslint-rules/no-unfiltered-judge-realtime.js` lines 72-75:
```js
// A spread element (`...judgeFilter`) suppresses the warning…
function hasSpread(objNode) {
  return objNode.properties.some((p) => p.type === "SpreadElement");
}
```

Any developer can defeat the gate by writing
```ts
.on('postgres_changes', { table: 'judge_decisions', ...{} }, …)
```
or any spread that happens to evaluate to `{}` at runtime. The rule
documents this as intentional ("if a file uses spreads to fake filter
presence, allowlist it explicitly with a memory") — but there is no
follow-up audit, no test, and no CI check enforcing the allowlist
discipline. Forbidden Pattern #12 is therefore *advisory* rather than
mechanical for any file using spreads.

---

## B-7 — AUDIT FORBIDDEN grep is brittle  ★INFO

`audit-forbidden.yml`:
```bash
if grep -E "audit-v6/(no-raw-entry-status|...)" /tmp/eslint.log; then
```
- ESLint format changes (e.g. `--format json`, `--format unix`) break this.
- Disabling colour output is not enforced (`FORCE_COLOR=0` not set); CI
  ANSI codes can prevent the regex from matching depending on runner config,
  silently turning the gate from RED to GREEN.
- The grep does not distinguish ERROR vs WARNING — if any of the three rules
  is downgraded to `warn`, the grep still matches and CI still fails. Likely
  the desired behavior, but undocumented.

---

## What is NOT broken (verified)

- `bun run vocab:check` passes — the committed JSON ↔ markdown pair is
  byte-equal.
- `system_tag_decision_map` has zero orphan tag references in the live DB.
- `eslint-rules/no-direct-transactional-email.js` has no false positives in
  current source (`grep "transactional" src/` → 0 hits).
- `eslint.config.js` correctly scopes `react-hooks` to `src/**/*.{ts,tsx}`
  and only audit-v6 rules to `supabase/functions/**`.
- The vocabulary nightly workflow's `peter-evans/create-pull-request` step
  has correct `add-paths` and a single dedicated branch, so concurrent runs
  will overwrite cleanly.

---

# Repair phases (proposed — NOT executed)

## Phase R6.1 — Unblock CI (HIGH priority, ~30 min)

1. Fix `no-raw-entry-status.js`: remove `e` from the object-name allowlist
   *or* gate on `node.parent` not being a `CatchClause` parameter scope.
2. PROVE: re-run `bunx eslint src/ supabase/functions/` and confirm the four
   `judge-session-resume` / `submit-judge-score` lines are gone, while a
   planted real `entry.status` violation in `src/lib/__r6_planted.ts` still
   fires.
3. PROVE: re-run AUDIT FORBIDDEN locally and confirm exit 0.
4. Forensic report under `scripts/audits/`.

## Phase R6.2 — Snapshot hardening (MEDIUM, ~1 hour)

5. Make `snapshot-vocabulary.mjs` defensive:
   - Empty `tagIds`: write a valid empty-rounds snapshot, exit 0.
   - Missing tag: **fail hard** (exit 3) with the offending `tag_id`, so the
     nightly PR job leaves a clear failure record instead of silently
     publishing `(missing tag)`.
   - Cross-validate every map row: `t.visible_in_round` must contain
     `round_number`; mismatches go in a `warnings: []` field in the JSON
     so they surface in the generated markdown.
6. Move `DECISION_GLOSSARY` into a DB-backed `decision_family_glossary`
   table (or into `system_tag_decision_map` as a column on the family) so
   the SOW Rule 2 (No Guesswork) is enforced at the data layer.

## Phase R6.3 — R4 vocabulary completeness (MEDIUM, ~45 min, **needs user input**)

7. Confirm with user: is R4 represented by tags or by
   `competition_entries.placement` only?
8. Either:
   - Insert the four R4 award rows into `system_tag_decision_map` (Winner,
     Runner-up, Honourable Mention, Finalist), or
   - Extend the generator to read `placement` enum values and render an
     "R4 Placements" section sourced from the DB enum, so vocabulary.md
     is complete by construction.

## Phase R6.4 — Strengthen #12 + CI grep (LOW, ~45 min)

9. Tighten `no-unfiltered-judge-realtime`: a spread suppresses the warning
   ONLY if the file is in `FILE_ALLOWLIST` *and* the spread identifier
   resolves to a known per-judge filter helper (e.g. `judgeFilter`,
   `currentJudgeFilter`). Otherwise still flag.
10. Replace the `grep` in `audit-forbidden.yml` with `eslint --format json`
    parsed by a tiny node script that asserts `0 problems with ruleId in
    {audit-v6/*}`. Add `FORCE_COLOR=0` and `--no-color` for safety.
11. Vitest sanity test: planted `e.status` in a fixture file in
    `src/test/__fixtures__` does NOT trigger the rule; planted `entry.status`
    in the same file DOES.

## Phase R6.5 — Verify (REQUIRED for closure)

12. After R6.1: AUDIT FORBIDDEN green on `main`.
13. After R6.2: Force `system_tag_decision_map` row referencing a deleted
    tag → snapshot fails hard, no PR opened, alarm visible.
14. After R6.3: vocabulary.md surfaces all R4 awards, judges can be onboarded
    without reading SOW prose.
15. After R6.4: Plant `.on('postgres_changes', { table: 'judge_decisions',
    ...{} })` in `src/hooks/judging/<random>.ts` → ESLint error fires
    despite the spread.

---

## Five-rule mandate compliance

- **Rule 1 (No Premature Move):** R6 was declared complete with B-1/B-2
  causing CI red. Phase invalid until B-1 fixed.
- **Rule 2 (No Guesswork):** B-3, B-4, B-5 each surface places where
  glossary text or row presence was assumed rather than proven against
  the DB.
- **Rule 3 (No Part Checking):** the previous R6 audit ran `bunx eslint`
  on planted files only, not the full repo. A complete-repo lint would
  have surfaced B-1 immediately.
- **Rule 4 (No Casual Approach):** B-6 and B-7 are casual escape hatches
  shipped without a written justification and without a test asserting
  the boundary.
- **Rule 5 (Claude Only):** N/A — all code under audit is Claude output.
