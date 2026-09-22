# D1 → D2 HANDOFF — one file, P33 definer-view predicates test

**`src/__tests__/p33DefinerViewPredicates.test.ts` is D2's to carry, in D2's own PR.**

It was authored on `d1/P1-session-b-p30-p31-p33-20260921` (PR #275) by a D1 session. `src/**` has
one owner and it is not D1 (Addendum A §2; skill §2 — *"a file has exactly one owner"*). This
re-cut, `d1/P1-session-b-p33-recut-20260922`, therefore carries the two migrations, their two
rollbacks, their two probes and the P30/P31/P33 evidence, and **leaves that file out**.

D1 has not edited, moved or deleted it, and will not — it still exists unchanged on
`d1/P1-session-b-p30-p31-p33-20260921` @ `2bc2e39`, which is where D2 should take it from.

**Its content has not been reviewed by D1 and is not being vouched for here.** This is an
ownership handoff, not a code review.

---

## 2 · A second item for D2, found this session and unrelated to that test

`src/hooks/judging/useJudgingLock.ts:183-200` — the `beforeunload` release path posts to
`/rest/v1/rpc/release_judge_lock` with an `apikey` header and **no `Authorization: Bearer` header**,
so PostgREST executes it as `anon`.

**PR #276 will break it, twice over and silently:** `REVOKE ALL … FROM anon` removes the grant,
and the new body guard `IF auth.uid() IS NULL THEN RAISE … '28000'` refuses it even with the
grant. The `fetch` is not awaited and its rejection is swallowed, so nothing surfaces. The
observable effect is a lock held for up to `LOCK_TTL_MINUTES` after every tab close.

Two comments in that file disagree with the code as written — `:182` says *"Use sendBeacon with
proper auth headers via Blob"* and `:192` says *"sendBeacon can't set custom headers; use fetch
with keepalive instead"*. Standing Rule 21: a comment is a control, and this is a finding rather
than cosmetics.

Full write-up, with the twelve-case cross-member test plan it belongs to:
`docs/evidence/d1/phase1/pr276-verification-package.md` §2 and §4 (test X12).

D1 has not touched the file.
