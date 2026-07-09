# Sprint 0 — Phase 0B-5 — Edge Function Authority Guardrail

**Status:** ✅ Complete · **Mode:** AUDIT-ONLY guardrail · **Runtime change:** none

---

## 1. VERIFIED FINDINGS

- 56 edge functions exist under `supabase/functions/`. Of these, **36 fall in
  the Phase 0B-5 sensitive scope** (payments / wallet / notifications /
  judging / admin / roles / moderation / email / finance).
- Static scan against the three forensic patterns produced **41 baseline
  occurrences across 31 sensitive functions**:
  - `ANON_KEY_IN_PRIVILEGED` — 19 (anon-key client created inside a
    privileged fn; usually paired with caller-JWT forwarding)
  - `BROAD_CORS_WILDCARD`    — 19 (`"Access-Control-Allow-Origin": "*"`
    literal — note: most are *fallbacks* inside `_shared/secureHeaders.ts`
    consumers; flagged as a code-shape signal, not a runtime claim)
  - `MISSING_AUTH_VALIDATION` — 3 (`SUPABASE_SERVICE_ROLE_KEY` referenced
    with NO recognized auth-validation token in the same file)
- Severity distribution: **CRITICAL = 7**, HIGH = 13, MEDIUM = 20, LOW = 1.
- Domain distribution: notifications 13, admin 8, judging 8, payments 5,
  wallet 4, moderation 3.
- ESLint plugin `audit-v6` already wired into both
  `eslint.config.js` (browser block + edge-functions block) and
  `.github/workflows/audit-forbidden.yml` grep gate. Rule slot was added
  to the existing edge-function block only.
- Baseline file successfully parsed by the rule loader; all 41 entries
  resolve at lint-time (`audit-v6/no-unsafe-edge-authority` reports **0**
  errors against the current tree).

## 2. NOT VERIFIED ITEMS

The following are documented forensic limitations of the static rule.
They are intentionally **NOT** asserted as facts:

- Whether each baselined `ANON_KEY_IN_PRIVILEGED` site is actually unsafe
  at runtime (anon-key + forwarded user JWT is a legitimate pattern in some
  Lovable Cloud functions). The rule treats these as *code-shape signals*
  to be re-reviewed in 0C, not as live vulnerabilities.
- Whether each baselined CORS wildcard is reached at runtime
  (`getSecureHeaders` may override before response). Marked NOT VERIFIED.
- Service-role audit-logging coverage (forbidden pattern #2 in the brief)
  — no reliable static signature; deferred to a Phase 0C runtime probe.
- Forbidden patterns #3 (missing auth before mutation), #4 (client
  authority assumptions), #5 (mutation without approved path), #6
  (correlation ID logging), #7 (admin bypasses) — partially covered by
  `MISSING_AUTH_VALIDATION` heuristic; full coverage requires runtime
  audit and is out of scope for a guardrail-only phase.
- No edge function code was opened, modified, or executed.

## 3. FILES TOUCHED

| File | Change | Type |
|---|---|---|
| `eslint-rules/no-unsafe-edge-authority.js` | created | new rule |
| `scripts/audits/baselines/edge-authority-baseline.json` | created | baseline (41 entries) |
| `eslint.config.js` | +3 lines (import + plugin slot + rule entry in edge-fn block) | wiring |
| `.github/workflows/audit-forbidden.yml` | +1 token in grep alternation | CI gate |
| `docs/fix-sprints/sprint-0-phase-0b-5-edge-authority-guardrail.md` | created | this report |

No source files under `src/`, no edge function under `supabase/functions/<*>/`,
no migration, no schema, no runtime code, no `package.json`, no
`config.toml` were modified.

## 4. RULE IMPLEMENTED

`audit-v6/no-unsafe-edge-authority` — flags **NEW** occurrences of:

1. `ANON_KEY_IN_PRIVILEGED` — `SUPABASE_ANON_KEY` literal inside
   `supabase/functions/<sensitive-fn>/index.ts`.
2. `BROAD_CORS_WILDCARD` — `"Access-Control-Allow-Origin": "*"` literal in
   the same scope.
3. `MISSING_AUTH_VALIDATION` — `SUPABASE_SERVICE_ROLE_KEY` referenced
   without ANY of: `getClaims`, `getUser`, `has_role`, `is_admin`, `hmac`,
   `signature`, `webhookSecret`, `x-webhook-secret`,
   `crypto.subtle.verify`, `verifyJwt`, `verify_jwt`, `Authorization`,
   `WEBHOOK_SECRET`, `service_role_check`.

Scope is restricted to `supabase/functions/<fn>/index.ts` where `<fn>` ∈
the explicit `SENSITIVE_FNS` allow-list (36 functions). `_shared/`,
non-sensitive functions, and `*.test.ts` / `*_test.ts` are exempt.

Existing sites are allow-listed via `{file, line, issue}` keys in the
baseline. Cleanup of baselined sites is **deferred** to Phase 0C.

## 5. BASELINE CREATED

`scripts/audits/baselines/edge-authority-baseline.json`

```json
{
  "_doc": "Sprint 0 Phase 0B-5 — edge function authority baseline.",
  "_phase": "sprint-0-phase-0b-5",
  "_total": 41,
  "entries": [
    { "file": "...", "line": 20, "function": "create-payment-session",
      "issue": "ANON_KEY_IN_PRIVILEGED", "subsystem": "payments",
      "severity": "CRITICAL" },
    ...
  ]
}
```

Each entry includes: `file`, `line`, `function`, `issue` (one of the three
above), `subsystem`, `severity`.

## 6. CURRENT ALLOWED VIOLATIONS COUNT

**41**, distribution:

| Issue | Count |
|---|---:|
| ANON_KEY_IN_PRIVILEGED | 19 |
| BROAD_CORS_WILDCARD | 19 |
| MISSING_AUTH_VALIDATION | 3 |

| Severity | Count |
|---|---:|
| CRITICAL | 7 |
| HIGH | 13 |
| MEDIUM | 20 |
| LOW | 1 |

CRITICAL list (Phase 0C remediation candidates):

1. `create-payment-session/index.ts:20` — anon key in payments fn
2. `delete-user/index.ts:19` — anon key in admin fn
3. `get-payment-gateways-public/index.ts:21` — service role w/o auth tokens
4. `get-wallet-summary/index.ts:18` — anon key in wallet fn
5. `get-wallet-transactions/index.ts:18` — anon key in wallet fn
6. `hard-delete-competition/index.ts:262` — anon key in admin fn
7. `razorpay-verify-payment/index.ts:30` — anon key in payments fn

## 7. SYNTHETIC FAILURE TEST RESULT

Driven by an in-memory `eslint.Linter` flat-config harness against the
real rule (`scripts/test-rule.mjs`, removed after run):

| Probe | Filename context | Expected | Got | Result |
|---|---|---:|---:|---|
| `SUPABASE_ANON_KEY` + CORS `*` | `cast-photo-vote/index.ts` | ≥2 | 2 | ✅ FAIL as expected |
| Service-role only, no auth tokens | `admin-export-db/index.ts` | 1 | 1 | ✅ FAIL as expected |

Reported messages confirmed (`ANON_KEY_IN_PRIVILEGED`, `BROAD_CORS_WILDCARD`,
`MISSING_AUTH_VALIDATION`) at the correct line numbers.

## 8. APPROVED PATTERN TEST RESULT

| Probe | Filename context | Expected | Got | Result |
|---|---|---:|---:|---|
| Service-role + `Authorization` + `getClaims` | `submit-judge-decision/index.ts` | 0 | 0 | ✅ PASS |
| Same anon+CORS code in non-sensitive fn | `sitemap/index.ts` | 0 | 0 | ✅ ignored (out of scope) |

## 9. FINAL LINT/CI RESULT

- `bunx eslint supabase/functions/ --no-warn-ignored | grep -c
  "no-unsafe-edge-authority"` → **0** hits.
- Other unrelated `@typescript-eslint/no-explicit-any` / `no-empty` errors
  pre-exist and are NOT gated by `AUDIT FORBIDDEN` (the workflow greps
  only `audit-v6/...` rule IDs).
- `AUDIT FORBIDDEN` job: grep alternation extended with
  `no-unsafe-edge-authority`. Local syntax-equivalent grep against an
  empty log returns 0, matching expected pass behavior.

## 10. DIFF SUMMARY

```
A  eslint-rules/no-unsafe-edge-authority.js                            (+177 lines, new)
A  scripts/audits/baselines/edge-authority-baseline.json               (333 lines, new)
A  docs/fix-sprints/sprint-0-phase-0b-5-edge-authority-guardrail.md    (this file, new)
M  eslint.config.js
   +import noUnsafeEdgeAuthority from "./eslint-rules/no-unsafe-edge-authority.js";
   +"no-unsafe-edge-authority": noUnsafeEdgeAuthority,                  (plugin slot)
   +"audit-v6/no-unsafe-edge-authority": "error",                       (edge-fn block only)
M  .github/workflows/audit-forbidden.yml
   ~grep -E "audit-v6/(...|no-unsafe-edge-authority)"                   (1-token extension)
```

## 11. RISKS

- **Heuristic precision** — `MISSING_AUTH_VALIDATION` is text-grep based.
  False negatives possible if a fn validates auth via an indirection name
  not in the AUTH_TOKENS list. False positives mitigated by the file-wide
  any-token rule.
- **Baseline drift** — line shifts inside a baselined file will move a
  legacy occurrence out of the allow-list and trigger CI. Acceptable
  trade-off; forces re-baselining when sensitive fns are touched.
- **Scope ossification** — the `SENSITIVE_FNS` set is hardcoded. New
  sensitive functions will not be auto-covered until the set is updated.
  Tracked as 0B-5 maintenance follow-up.
- **No runtime claim** — this rule cannot prove a flagged fn is exploited
  at runtime; it only blocks NEW shapes that historically correlate with
  unsafe authority. Live verification deferred to 0C.

## 12. ROLLBACK PLAN

Single-commit rollback:

```bash
git rm eslint-rules/no-unsafe-edge-authority.js
git rm scripts/audits/baselines/edge-authority-baseline.json
git rm docs/fix-sprints/sprint-0-phase-0b-5-edge-authority-guardrail.md
# revert the +1 grep token in .github/workflows/audit-forbidden.yml
# revert the +3 lines in eslint.config.js
```

No DB migration, no edge-fn redeploy, no env or secrets touched. Rollback
is fully reversible with zero runtime impact.

## 13. NEXT RECOMMENDED STEP

Two safe options, awaiting explicit user go-signal:

1. **GO 0B-6** — add the next read-only guardrail (e.g.
   `notifications` direct-write block on `notifications` /
   `user_notifications` / `notification_emit_log`, completing the Phase 0B
   guardrail wave).
2. **GO 0C-1** — begin first remediation: convert the highest-severity
   CRITICAL site (`AdminTransactions.tsx` direct
   `wallet_transactions` update from Phase 0B-2) to a server-side edge
   function. Strictly diff-captured, single-target.

No work proceeds without explicit approval.
