# D1 · §4.9 — PR #276 VERIFICATION PACKAGE

**Author:** D1, 2026-09-22. **Branch under review:** `origin/d1/P32-session-a-judging-lock-20260921`
@ `c246266`, one commit on `origin/staging` `f0377af`. **Migration:** `20260910_0030_p32_judging_lock_identity_and_apply_tag_closure.sql`.

**The existing migration is NOT altered by this package**, per §4.9. What follows is the probe and
the cross-member test plan that would verify the fix **once its prerequisites are satisfied** —
and the statement of one prerequisite that is not satisfied today.

---

## 1 · What #276 actually changes, read from the file

Four objects, two different treatments:

| object | treatment | mechanism |
|---|---|---|
| `acquire_judge_lock(uuid,int,uuid,int)` | **body fix + grant** | `CREATE OR REPLACE` adding three guards, then `REVOKE … FROM public, anon` + `GRANT … TO authenticated, service_role` |
| `heartbeat_judge_lock(uuid,int,uuid,int)` | same | same |
| `release_judge_lock(uuid,int,uuid)` | same | same |
| `judge_apply_single_tag(uuid,int,int,uuid,uuid)` | **grant only, body untouched** | `REVOKE … FROM public, anon, authenticated` + `GRANT … TO service_role` |

The three guards added to each lock function:

```sql
IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
END IF;
IF _judge_id <> auth.uid() THEN
  RAISE EXCEPTION 'judge_id must match the authenticated caller' USING ERRCODE = '42501';
END IF;
IF NOT (public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')) THEN
  RAISE EXCEPTION 'judge or admin role required' USING ERRCODE = '42501';
END IF;
```

**The gap it closes is real and D1 confirms it independently from the argument lists:** all four
take a caller-supplied `_judge_id` and, before this file, none compared it to `auth.uid()`.
`release_judge_lock` was the sharpest — a bare caller-controlled `_judge_id` let any caller
force-release any judge's active lock.

**`CREATE OR REPLACE`, not `DROP`+`CREATE`** — so F-66 does not bite and the ACL survives the body
change. That is the right choice and it is worth saying so.

---

## 2 · ⚠ PREREQUISITE NOT SATISFIED — #276 breaks the unload release, silently

**This is the finding. It is not an objection to the fix; it is the thing that must land first.**

`src/hooks/judging/useJudgingLock.ts` calls `release_judge_lock` from **three** places. Two are
ordinary authenticated `supabase.rpc` calls (`:59`, `:165`) and are unaffected. The third is the
`beforeunload` handler, and it is **not authenticated at all**:

```ts
// src/hooks/judging/useJudgingLock.ts:183-200
const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_judge_lock`;
const body = JSON.stringify({ _entry_id: …, _photo_index: …, _judge_id: jid });
const headers = {
  "Content-Type": "application/json",
  "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
// sendBeacon can't set custom headers; use fetch with keepalive instead
try {
  fetch(url, { method: "POST", headers, body, keepalive: true });
} catch { /* Best-effort; TTL will expire the lock */ }
```

**There is no `Authorization: Bearer <user JWT>` header.** With only `apikey`, PostgREST executes
that request as **`anon`**. So after #276:

1. `REVOKE ALL … FROM anon` removes its EXECUTE privilege → `42501` at the grant layer; and
2. even with the grant, `IF auth.uid() IS NULL THEN RAISE … '28000'` refuses it at the body layer.

**Two independent reasons the unload release stops working, and no error path to notice by** —
the `fetch` is not awaited and its rejection is swallowed by the surrounding `catch`.

**Severity, stated honestly rather than inflated:** this is a **degradation, not an outage**. The
lock TTL (`LOCK_TTL_MINUTES`, default 5) still expires an abandoned lock. The observable effect is
that a judge who closes the tab leaves the entry locked for up to five minutes instead of
releasing it immediately, and a second judge sees `locked_by_other` in the meantime. It will look
like "stale locks appeared after the security fix", which is exactly the kind of symptom that gets
blamed on the wrong change.

**Standing Rule 21, separately.** The comment on line 192 says *"sendBeacon can't set custom
headers; use fetch with keepalive instead"* and the header comment at `:182` says *"Use sendBeacon
with proper auth headers via Blob"*. The code uses `fetch`, and it does **not** send proper auth
headers. Comment and code disagree; that is a finding, not cosmetics.

**Whose fix this is:** `src/**` is D2's lane. D1 does not touch it. Recorded here and handed over
in `handoff-to-d2-p33-test.md` §2.

### 2.1 · `judge_apply_single_tag` — checked for the same failure mode, and it is clean

Its only caller is `supabase/functions/submit-judge-tag/index.ts:144`, via `admin.rpc(…)` on a
**service_role** client, and #276 grants `service_role`. Its body is **not** modified, so no
`auth.uid()` guard is introduced into a path where `auth.uid()` is `NULL` by design. Revoking
`authenticated` here is right: it removes the ability to call the scoring write directly over
PostgREST and bypass the edge function's JWT, role, assignment, round-lock, tag-visibility and
R4-unique-award checks. **No prerequisite owed.**

### 2.2 · A pre-existing inconsistency, recorded, not introduced by #276

`src/pages/JudgePanel.tsx` maintains `effectiveJudgeId = seatActive ? seatJudgeId! : user?.id`
(`:69`) and passes `effectiveJudgeId` to the tagging path (`:209`, `:1031`) but `user?.id` to the
lock (`:385`). So an admin occupying a judge's seat **locks under their own id while tagging as the
seat judge**. #276's `_judge_id <> auth.uid()` check is satisfied either way, so the fix does not
break it — but the two identities diverge and nothing currently reconciles them. Not #276's to
fix; recorded so it is not discovered as a mystery later.

---

## 3 · The probe

`supabase/migrations/PROBE_p32_judging_lock_verified.sql`, authored in this session.

It is **not** a duplicate of #276's own `PROBE_p32_judging_lock_identity_and_apply_tag_closure.sql`,
which asserts the catalogue state. This one asserts what the catalogue **cannot** show: that the
three guard clauses are actually present in the installed body. A grant probe would pass against a
lane where the migration's `REVOKE`s ran but the `CREATE OR REPLACE` did not — which, given that
this project has four merged-but-unapplied revokes live right now, is not a hypothetical.

Assertions, per object:

| id | assertion |
|---|---|
| V1 | the exact signature resolves to exactly one function |
| V2 | still `SECURITY DEFINER`, still `VOLATILE`, still in `public` |
| V3 | **`prosrc` contains `_judge_id <> auth.uid()`** — the identity check is in the installed body, not merely in the migration file |
| V4 | **`prosrc` contains the `28000` unauthenticated guard** |
| V5 | **`prosrc` contains the judge-or-admin role check** |
| V6 | `anon` cannot EXECUTE, and no PUBLIC entry remains (F-62) |
| V7 | `authenticated` retained on the three lock functions; **revoked** on `judge_apply_single_tag` |
| V8 | `service_role` retained on all four |

V3–V5 are source-text assertions, which is a blunt instrument and is declared as one in the file:
they prove the guard is *present*, not that it is *correct*. Correctness is §4 below, and it needs
two real sessions.

**This probe must be shown failing first.** Against `origin/staging` today all four objects fail
at V3 and V6 — the body has no identity check and `anon` holds EXECUTE. Evidence:
`docs/evidence/d1/phase1/probe-fail-first-20260922.txt` covers V6-equivalent for the whole
population; the V3 half is confirmed by the Set B body readings, which record `_judge_id` as
caller-supplied and unchecked on all four.

---

## 4 · Cross-member test plan

The skill is unambiguous: *"Every definer function or view that stands in for RLS ships with a
cross-member test proving one member cannot read another's rows. That test is the condition of the
design, not a follow-up."* A single-session test cannot prove a two-member property.

**Fixture.** Two real judge accounts on staging, both assigned to the same competition, plus one
member with no judge role. Follow the existing harness shape —
`docs/evidence/d1/P30/P30-fixture-harness.sh` and `P31-fixture-harness.sh` — which already
establish how this project drives real JWTs against `/rest/v1/rpc` rather than simulating them in
SQL. **The RPC must be exercised over HTTP with a real JWT, not via `SET ROLE`**: `SET ROLE anon`
does not populate `auth.uid()`, so an in-SQL simulation cannot distinguish "refused because
unauthenticated" from "refused because the identity did not match", and those are the two
different guards under test (F-53 is the same lesson recorded against this project already).

| # | actor | call | expected | proves |
|---|---|---|---|---|
| X1 | judge A | `acquire_judge_lock(E, 0, A)` | `{acquired:true}` | the fix does not break the sanctioned path |
| X2 | judge B | `acquire_judge_lock(E, 0, B)` | `{acquired:false, locked_by:A}` | ordinary contention still reported, not raised |
| X3 | **judge B** | `release_judge_lock(E, 0, **A**)` | **`42501`** | ⭐ **the vulnerability.** Before the fix this SUCCEEDS and steals A's lock |
| X4 | judge B | `heartbeat_judge_lock(E, 0, **A**)` | **`42501`** | same class, extension path |
| X5 | judge B | `acquire_judge_lock(E, 0, **A**)` | **`42501`** | same class, squat path |
| X6 | member with no judge role | `acquire_judge_lock(E, 0, self)` | **`42501`** role check | the third guard, independent of the identity guard |
| X7 | anon (apikey only, no bearer) | `release_judge_lock(E, 0, A)` | **`42501` / `401`** | the grant-layer closure |
| X8 | judge A | `release_judge_lock(E, 0, A)` | `true`, lock row gone | A can still release their own |
| X9 | anon | `judge_apply_single_tag(…)` | **`42501`** | scoring write unreachable over PostgREST |
| X10 | judge A **directly over PostgREST** | `judge_apply_single_tag(…)` | **`42501`** | ⭐ `authenticated` is revoked — the edge function's validation cannot be bypassed |
| X11 | the edge function `submit-judge-tag` | normal tag submission | **succeeds** | service_role path intact; **X10 and X11 together are the whole point of that object's treatment** |
| X12 | judge A, tab closed (`beforeunload`) | unload release | **FAILS TODAY — see §2** | the prerequisite; re-run after D2 lands the Authorization header |

**X3 is the test that must be shown red before the fix.** Run it against a lane where `0030` has
not been applied; it will return `true` and judge B will hold judge A's lock. A cross-member test
that was never red is not evidence (C-34).

**X12 is expected to fail on the fixed lane** until D2 adds the bearer token. Recording it as an
expected failure with a named owner is the honest form; deleting it from the plan because it fails
is not.

---

## 5 · Sequencing, stated as a precondition rather than a preference

1. **D2 lands the `Authorization: Bearer` header** on `useJudgingLock.ts`'s unload path, and
   corrects the two comments that disagree with the code.
2. `0030` applies to staging. X1–X11 green, X12 green.
3. Seven days of real judging traffic on staging with no `JUDGE-6106`
   `JUDGING_LOCK_NOT_ACQUIRED` rate change — the existing logger event at `useJudgingLock.ts:81`
   is the instrument, and it is already in place, which is why no new telemetry is proposed.
4. Only then production, with the same probe run on that lane.

If `0030` lands before step 1, the result is stale judging locks for up to `LOCK_TTL_MINUTES`
after every tab close, with no error surfaced anywhere.
