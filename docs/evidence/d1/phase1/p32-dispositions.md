# P32 — the four functions that keep anon EXECUTE, and why

Measured on staging (`fpszggreishhuvdpkmdr`), SELECT only, 2026-09-25, at
`origin/staging` `8b174a1`.

P32's population is the SECURITY DEFINER, VOLATILE, RPC-callable functions in
`public` that `anon` can execute. It stood at 56 on 2026-09-25. Units
`20260910_0034` (27) and `20260910_0035` (25) close 52 of them. These four
remain, deliberately. Each is a decision, not an oversight, and each is
recorded here with the test path that would catch a change of mind.

All four carry the same starting ACL as the other 52:

```
{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

which means each is reachable by a logged-out visitor today. That is the
point of writing the reason down rather than leaving the grant unexplained.

| function | disposition | reason | test path |
|---|---|---|---|
| `log_client_error(_kind text, _message text, _detail jsonb, _platform text, _app_build text, _url text)` | **KEEP anon** | Anon by design, ruled in R-17. A client error has to be reportable by the session that hit it, and a signed-out visitor hitting an error is exactly the case worth capturing. Called from `src/lib/reportClientError.ts:167`. The anon grant is asserted, not incidental: R-17 annotated the assertion so a later sweep does not "fix" it. | `src/lib/reportClientError.ts:167` is the only caller. A regression would show as that call failing with 42501 for a signed-out visitor; the standing assertion on the grant is the thing that must stay green. |
| `log_app_event(_code text, _event text, _severity text, _message text, _fn text, _file text, _reason text, _expected text, _actual text, _next_step text, _duration_ms integer, _correlation_id text, _detail jsonb, _platform text, _app_build text, _url text)` | **KEEP anon** | Anon by design. `src/hooks/core/useAuth.tsx:326` states it in the code: the auth lifecycle itself emits events before anyone is signed in, so requiring a session would lose precisely the events about not having one. Called from `src/lib/logger.ts:275`. | `src/lib/logger.ts:275`; `src/lib/__tests__/loggingStandard.test.ts:293` exercises the call shape. |
| `increment_managed_page_view(_page_id text)` | **HELD — not decided here** | R-16 moves the counter to the edge (#285) and the unit is held on the counting/caching decision, which is not D1's to take. Revoking anon now would silently stop counting logged-out page views, which is most of them, and the replacement is not in place. Called from `src/pages/ManagedPageView.tsx:69`. | `src/pages/__tests__/managedPageViewCounter.test.tsx`. When #285 lands, this row is replaced by a revoke in its own unit. |
| `record_test_agent_run(p_token text, p_run_id text, …, p_github_run_url text)` | **HELD — interface first** | R-37/R-18: the header-token interface comes before the grant change. The function authenticates its caller with `p_token`, a secret passed **as an SQL argument**, which lands in query logs and `pg_stat_statements` — the platform rule this project already has a standing finding about. Revoking anon without first moving the token to a header would break the CI agent; moving the token is the real fix and it is ordered first. Called from `scripts/test-agent/run-checks.mjs:139` over REST. | `scripts/test-agent/run-checks.mjs:139`. The R-37 interface change is the gate; until it lands, the anon grant stays and the secret-as-argument finding stays open with it. |

## How this list was derived

Not copied from a document. Three independent scans at `8b174a1`, all
re-runnable from `docs/evidence/d1/phase1/P32-0034-*`:

1. **Client.** Every occurrence of each function's quoted name with `.rpc`
   within the preceding 300 characters, DOTALL, plus REST `rpc/<name>` paths,
   across `src/**`, `supabase/functions/**`, `functions/**`, `scripts/**`,
   `public/**` and `tools/**` — 1,058 files.
2. **Database.** `pg_proc.prosrc` matched against `\m<name>\s*\(`, with each
   caller classified SECURITY DEFINER or SECURITY INVOKER.
3. **Policies and cron.** `pg_policy` qual and with-check expressions, and
   `cron.job.command`.

All four functions above have a production client call site. None of them has
a database or cron caller. `pg_policy` references none of the 56.

## After 0034 and 0035

P32 on staging = 56 − 27 − 25 = **4**, and those four are the rows above.
