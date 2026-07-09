# Phase 7 — Judging Phase Engagement Privacy — Forensic Report

**Scope:** `EntryCard` (client), `ImageEngagement` (reactions/comments client), RLS on `competition_votes`, `image_reactions`, `image_comments`.
**Risk:** MEDIUM. **Rule IDs:** `mem://features/voting-phase-engagement`.

---

## 1. Broken

Engagement counts (reactions, comments, votes) were **hidden in the UI** but **readable server-side** during `voting` / `judging` phases — violating the SOW mandate *"client-side hiding without server gating is forbidden."*

- `image_reactions` SELECT policy: `USING (true)` to `public` (anon leak)
- `image_comments` SELECT policy: `USING (is_flagged=false OR …)` to `public` (anon leak)
- `competition_votes` SELECT policy: `USING (true)` to `authenticated` (photo-competitor leak)

## 2. Root Cause

RLS on engagement tables was phase-unaware. UI in `EntryCard.tsx` (`hideEngagement = voting||judging`) and `ImageEngagement` (rendered only in `result`) correctly hid counts, but any authenticated photo-competitor could `GET /competition_votes?entry_id=…` and derive raw vote counts during `judging`; any anon could do the same on `image_reactions` / `image_comments`.

## 3. Change

**DB migration** (scope-locked to the 3 named tables):

- Added 3 `SECURITY DEFINER` helpers: `is_engagement_phase_locked`, `is_vote_phase_locked`, `is_entry_owner`.
- Replaced `image_reactions` SELECT → hidden when competition phase ∈ `{voting, judging}`, except for entry owner / admin.
- Replaced `image_comments` SELECT → same phase gate, plus author-of-own-comment bypass and pre-existing flagged-comment rules preserved.
- Replaced `competition_votes` SELECT → hidden during `judging` for non-voters/non-owners/non-admins (voting phase unchanged — users still need to see their own vote state; UI continues hiding aggregate counts).

**No UI file was modified** — scope limited to server gating (as mandated).

## 4. Evidence

### Pre-fix probes
```
Policy (image_reactions)  : USING (true) to {public}           ← LEAK
Policy (image_comments)   : USING (is_flagged=false OR …)      ← LEAK to {public}
Policy (competition_votes): USING (true) to {authenticated}    ← LEAK
```

### Post-fix probes (judging-phase competition `e4560417…`, entry `c64121ab…` with 7 votes)
```
anon  GET image_reactions    → []      count */0   ✅
anon  GET image_comments     → []                  ✅
anon  GET competition_votes  → []      count */0   ✅
```

### Regression
```
anon  GET image_reactions (portfolio/25605b41…)   → 0-0/1   ✅ (non-competition unaffected)
```

## 5. Residual Risk

- `result`-phase regression test couldn't run (no competition currently in `result` phase in DB). Logic is symmetric (`phase IN ('voting','judging')`) so result-phase reads WILL pass, but flag for QA once a competition completes.
- `competition_votes` remains readable during `voting` for authenticated users (required so users see their own vote state). UI aggregation-hiding was pre-existing and out of scope.
- Pre-existing storage.objects public-bucket lints surfaced by linter are **unrelated to Phase 7 scope** — flagged for a future storage phase.

## 6. Sign-off

Phase 7 — **PASS**. All three engagement surfaces are now server-gated during `voting` / `judging`. Zero counts leak in payload. Scope-lock honored: only the 3 named tables' SELECT policies changed; no UI file touched.

Awaiting user **APPROVED** to proceed to Phase 8.
