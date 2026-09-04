# P30 — `email_exists` off `anon`. Evidence.

**Unit:** P30 · Phase 1 · D1
**Branch:** `d1/P30-email-exists-revoke-20260910` off `staging` (`e74d977`)
**Authority:** `docs/gates/P1-revocation-list.md` rev 2, commit `e74d977`, blob `88c08093`, §2.1 — the
one item cleared for revocation in that issue of the list.

---

## 1 · The gate, verbatim, and what this PR actually closes

> **P30** — `email_exists` removed from the `anon` role; signup and password-reset responses are
> identical whether or not the address is registered.

| clause | closed here | instrument |
|---|---|---|
| 1 · `email_exists` removed from the `anon` role | **on apply, yes** | `PROBE_p30_email_exists_closed.sql` B2 — `has_function_privilege('anon', oid, 'EXECUTE') = false`, per function, per lane |
| 2 · signup and reset responses identical | **NO — and this PR does not claim it** | an HTTP-response measurement from the client. The register's own note: "needs a test proving the two responses are byte-identical". A database grant cannot prove it; `curl` is not a browser (F-53). |

**The unit does not close until both clauses close.** This PR removes the only mechanism by which
the application produced a differing response — the `No Account Found` screen — which is the
*precondition* for clause 2, not the evidence for it. A green probe run here must not be recorded as
a closed P30.

---

## 2 · Readings — production and staging, `SELECT` only, 2026-09-04

| requirement | instrument | evidence | result | status |
|---|---|---|---|---|
| the pre-revoke grant state of `email_exists(text)` | `pg_proc.proacl`, `has_function_privilege`, `aclexplode` via Supabase MCP, read-only | staging `ztzutckwdhetphwghuzj` oid **17719**; production `jtdtehuqtinjxropkkcn` oid **34459** | both lanes: `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` · `anon_exec=true` · `authenticated_exec=true` · `prosecdef=true` · `provolatile=s` · **PUBLIC entries = 0** | **VERIFIED** |
| the only call site is fail-open | read `src/pages/ForgotPassword.tsx:37-45` | `exists` initialised `null`, written only under `if (!checkError && typeof data === "boolean")`; `if (exists === false)` gates the `No Account Found` return | after the revoke PostgREST answers `42501`, `checkError` is set, `exists` stays `null`, control falls through to `resetPasswordForEmail` | **VERIFIED** |
| no other caller exists | `grep -rn email_exists` over the tree excluding `node_modules`, 2026-09-04 | one hit in `src/**`: `ForgotPassword.tsx:39`. No edge function, no Pages function, no script. | **1 call site as of 2026-09-04 09:12Z** | **VERIFIED** |

*Every negative statement carries its moment: "0 PUBLIC entries" and "1 call site" are true **as of
2026-09-04**, not in general.*

---

## 3 · C-34 — the test was shown failing before it was shown passing

`P30-fixture-transcript.txt`, reproducible via `P30-fixture-harness.sh`. Scratch PostgreSQL
**16.13**, in the D1 container, **not a lane** — the F-65 rule that grant controls are exercised on
fixtures. The fixture's `proacl` is **byte-identical** to the string measured on both lanes (PART A).

| part | what runs | probe exit | meaning |
|---|---|---|---|
| **B** | probe **before** the revoke | **3 — B2 FAILED** | the negative control. The assertion can fail. |
| **C** | the apply migration | — | `anon` → false; `authenticated`/`service_role` unchanged; a real `SET ROLE anon` call returns `ERROR: permission denied for function email_exists` |
| **D** | probe **after** the revoke | **0 — all five pass** | clause 1 holds |
| **E** | the rollback file | **3 — B2 FAILED again** | the rollback genuinely reopens the gate, and the probe is sensitive in **both** directions rather than green-on-green |

The catalogue reading and a real call agree at every step: `t` → `permission denied` → `t`.

---

## 4 · F-62 demonstrated, and an honest limit on it — PART F

F-62 says `REVOKE … FROM anon` is a no-op wherever `PUBLIC` holds the grant.

**That condition is not satisfied by `email_exists` today.** Both lanes carry zero PUBLIC entries, so
`REVOKE … FROM anon` alone *would* have closed this one. F-62's own register row says exactly that:
*"`email_exists` (P30), `verify_staff_id` (P31) and the other seven volatile P32 functions carry clean
grants and are unaffected."* Claiming otherwise would be the C-49 / C-53 error — a finding quoted
without its instrument. **The migration is written `FROM public` first anyway**, for three reasons:
§1 of the frozen list mandates the shape; F-66 means the function reopens to PUBLIC the moment anyone
recreates it; and it costs one statement.

PART F builds that recreated state and shows the difference rather than asserting it:

```
fresh CREATE FUNCTION, no grants issued at all:
  proacl            : NULL          <- the BUILT-IN DEFAULT = EXECUTE TO PUBLIC, not "no grants"
  anon can execute? : t

after REVOKE ALL ... FROM anon:
  proacl            : {=X/postgres,postgres=X/postgres}
  anon can execute? : t             <- STILL TRUE. The statement succeeded and closed NOTHING.

after REVOKE FROM public, then FROM anon (the form 20260910_0001 uses):
  proacl            : {postgres=X/postgres}
  anon can execute? : f             <- closed.
```

---

## 5 · A Standing Rule 21 finding against D1's own file, found by the fixture

The first draft of the rollback file claimed the restored ACL is **byte-identical** to the pre-apply
reading. It is not:

```
before apply    {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
after rollback  {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,anon=X/postgres}
                                                                                 ^^^^ re-appended
```

`REVOKE` removes `anon`'s aclitem and `GRANT` appends a new one, so **element order** differs while the
**grants are identical**. The restore is *privilege-equivalent*, not byte-equal, and `proacl::text`
string equality is the wrong instrument — the right one is set-wise over `aclexplode` (PART E prints
it: `anon/EXECUTE`, `authenticated/EXECUTE`, `postgres/EXECUTE`, `service_role/EXECUTE`, and **0**
PUBLIC rows). The comment was corrected rather than reworded away. An instructing comment is a
control; a comment that disagrees with its code is a finding, and this one was D1's own.

---

## 6 · Raised for the Auditor — NOT acted on

**`authenticated` keeps EXECUTE.** The frozen list authorises `FROM public, anon` and no more, so
`authenticated` is untouched and probe assertion B4 asserts it *survived* — an over-revoke is as much
a defect as an under-revoke, and it would break the rollback's fidelity.

But anyone may create an account, so `authenticated` is not a meaningfully higher bar than `anon`
against the enumeration class this unit exists to close: a signed-up attacker can still ask this
function about any address. It is a smaller door, not a shut one — and it is rate-limitable and
attributable in a way `anon` is not, which may be exactly why the list stopped where it did. **The
Auditor's call, and it belongs in a revision of the frozen list, not in a developer's migration.**

**Wording refinement to the frozen list, §2.1**, offered as a strengthening rather than a defect: the
list says the call site "is wrapped in try/catch, any error sets `exists = null`". `supabase-js`
`.rpc()` resolves with `{ data, error }` on an HTTP error — it does not throw — so the `catch` never
runs after this revoke. What carries it is the `!checkError` guard on the assignment. **Fail-open
either way, by two independent mechanisms rather than one.** D2's conclusion is unaffected and correct.

---

## 7 · What is deliberately untouched

| object | why |
|---|---|
| `search_certificates(...)` | §2.2 **BLOCKED** on a client fix. All four verification pages collapse error and empty into one branch, so on revoke day a real certificate holder is told their certificate could not be verified — which reads as a forgery and nobody reports it. A silent wrong answer is worse than an error. |
| `increment_managed_page_view(...)` | §2.2 **BLOCKED**. `ManagedPageView.tsx:34` has no rejection handler; a revoke becomes an unhandled rejection on a public page. |
| `verify_staff_id(text)` | §2.3 **WITHDRAWN as C-60.** `blood_group` is a designed feature of the public staff-card page — printed on the card the caller is already holding — not a leak. Its real gate is unchanged from the Addendum: a session or a rate limit. Not a revocation. |
| `entry_vote_counts` | §2.3 — a design decision (revoke `SELECT`, or drop `adjustment_votes`), not a revocation on this list. 0 rows today. |

---

## 8 · Not applied

Committing is not applying. **The Auditor authorises the apply, staging first.** Nothing in this PR
has been run against either lane; every reading above is `SELECT`-only, and every state change was
made on a scratch fixture in the D1 container.
