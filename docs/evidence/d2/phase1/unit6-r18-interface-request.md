# Unit 6 (R-18) — the test-agent ingest token cannot leave the SQL argument without D1

**D2 · 2026-09-22 · measured against `origin/staging` `247a47b`, not relayed.**

**Status: HELD. No change made to `scripts/test-agent/run-checks.mjs`.**
This document is a request for the Auditor to freeze an interface, and a
record of three things the command did not anticipate. It is *not* a frozen
interface — §3.7: an interface agreed in conversation does not exist.

---

## 1 · Why the unit cannot be executed as written

R-18 says: *"a secret passed as an SQL argument lands in `pg_stat_statements`
and in the catalogue. Move it to a header."* The caller is mine on the R-26
rule. The **validation is not**, and that is the blocker.

`supabase/migrations/20260502072904_f645403a-7c50-49d3-b818-c41cb68ff9e6.sql`
`:110-158` — measured this session:

```sql
CREATE OR REPLACE FUNCTION public.record_test_agent_run(
  p_token TEXT, p_run_id TEXT, … )
…
  SELECT decrypted_secret INTO v_expected_token
  FROM vault.decrypted_secrets
  WHERE name = 'test_agent_ingest_token' LIMIT 1;

  IF v_expected_token IS NULL OR p_token IS NULL OR p_token <> v_expected_token THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
```

The function compares **its own argument** against the vault secret. Nothing
in `supabase/**` reads `current_setting('request.headers', …)` — zero matches
across the whole tree at `247a47b`. So a caller that stops sending `p_token`
and sends a header instead does not move the secret; it raises
`invalid_token` on every run. Moving the value client-side **requires** the
function to learn to read the header first, and function bodies are D1's.

Doing it anyway would be guesswork about a header name the server does not
read, on a path that would then be silently broken until someone looked. That
is the failure Unit 2 exists to prevent, in the opposite direction.

---

## 2 · The interface D2 needs frozen (proposal, for the Auditor)

Expand → behaviour → contract, in this order. **Step 2 is mine and nothing
else here is.**

**Step 1 — D1.** `record_test_agent_run` accepts the token from the request
header when the argument is absent:

```sql
v_header_token := nullif(
  (current_setting('request.headers', true)::json ->> 'x-test-agent-token'), '');
v_supplied := coalesce(p_token, v_header_token);
```

PostgREST populates `request.headers` with every request header, keys
lowercased, so the name below must be matched in lower case. The 15-argument
signature and its grant stay exactly as they are during this step, so nothing
that exists today changes behaviour.

**Step 2 — D2 (this unit, once step 1 is live on staging).**
`scripts/test-agent/run-checks.mjs:139-143` sends

```
x-test-agent-token: <value of TEST_AGENT_INGEST_TOKEN>
```

as a request header and drops `p_token` from the body. The value is read from
the environment and passed through; it is never logged, printed, defaulted or
committed. **D2 does not handle the secret's value — only where it travels.**

**Step 3 — D1, after step 2 has run green.** Contract: drop the `p_token`
argument, or make a non-null `p_token` an error, so the old shape cannot come
back by accident.

**The one thing the Auditor has to fix** is the header name. `x-test-agent-token`
is a proposal. Once it is in the ledger it is frozen, and neither side changes
it without the Auditor reopening it.

**Stated rather than oversold:** a header is a strict improvement over an SQL
argument, but it is not zero-exposure — request headers can still reach an
edge or proxy access log. The secret remains a shared secret in a vault, and
rotating it stays the real control.

---

## 3 · Three things the command did not anticipate

### 3.1 · The caller is not wired to anything. It has not been since `cd3dc7e`.

`.github/workflows/` at `247a47b` contains fifteen workflows and **no
`test-agent.yml`**. Nothing in any workflow references `run-checks.mjs`, and
`TEST_AGENT_INGEST_TOKEN` appears nowhere in the repository except the two
lines of the script that read it (`:17`) and warn when it is unset (`:164`).
The path was deleted by:

```
cd3dc7e Remove CI workflows (not needed for hosting; re-add later with
        workflow-scoped token)
```

Two documents still describe it as live and are wrong:

* `.lovable/memory/ci/test-agent.md:11` — *"**Workflow:**
  `.github/workflows/test-agent.yml` runs `scripts/test-agent/run-checks.mjs`"*;
* `docs/PROMOTION_LEDGER.md:1110`, which counts a `jwt` finding in
  `.github/workflows/test-agent.yml` — a file that is not in the tree.
  (Auditor's file. Reported, not edited.)

`run-checks.mjs:137` guards the whole post on `if (INGEST_TOKEN)`, and
`TEST_AGENT_INGEST_TOKEN` is unset everywhere, so **the secret is not
currently travelling anywhere at all.** That is the cheapest possible moment
to change the shape — and the reason there is no urgency to rush step 2 ahead
of step 1. It also means R-18's finding is, today, about a path that is dark.

**The one thing that must not happen:** the workflow is re-added, as
`cd3dc7e` intends, in its old shape. Whoever re-adds it re-introduces the
argument form. Worth a note against that unit rather than a surprise later.

### 3.2 · The script's own header is a control, and it disagrees with the tree

`scripts/test-agent/run-checks.mjs:3-4`: *"Test Agent — runs every push +
every 5 min."* It runs on neither. Standing Rule 21: an instructing comment is
a control, and a comment that disagrees with its code is a finding rather than
cosmetics. Left in place — correcting it is a change to this file, and this
file is held.

### 3.3 · The default project ref in the script is a third project

`run-checks.mjs:15-16` default to `isywidnfnjhtydmdfgtk` and a baked anon JWT
for that ref. `docs/PROMOTION_LEDGER.md:1110` already classifies that JWT as
*"a third (test-agent) project's anon key — public by design"*, so the key
itself is not the finding. The finding is the **default**: it is neither
production (`jtdtehuqtinjxropkkcn`) nor current staging, and
`functions/_seo.ts` was rewritten under G5b precisely because a lane-defaulting
literal "silently becomes" another lane. Same class, different file. Not
changed here — it is a behaviour change to a held file and belongs to whichever
unit re-adds the workflow.

---

## 4 · What I am asking for

1. Freeze the header name (`x-test-agent-token`, or the Auditor's choice).
2. Sequence step 1 to D1.
3. Re-issue step 2 to D2 once step 1 is live on staging. It is a four-line
   change and it will carry its own before/after evidence.


---

# ADDENDUM — the eight-point trace the Auditor asked for

**2026-09-22, second pass. Every line below is from a file at `origin/staging` `247a47b`,
or from `cd3dc7e` itself. `scripts/test-agent/run-checks.mjs` is unchanged.**

| # | Question | Answer | Proof |
|---|---|---|---|
| 1 | What caller is supposed to send the token? | `scripts/test-agent/run-checks.mjs`, the block guarded by `if (INGEST_TOKEN)` | `:137-143` |
| 2 | Does it send an HTTP header carrying the token? | **No.** It sends three headers — `apikey`, `Authorization: Bearer <ANON_KEY>`, `Content-Type` — and the token travels in the JSON body as `p_token` | `:141` (headers) vs `:143` (`p_token: INGEST_TOKEN`) |
| 3 | Is there an exact header name? | **None exists**, in current code or in any prior contract. The deleted workflow used the same three headers | `run-checks.mjs:141`; `cd3dc7e^:.github/workflows/test-agent.yml:114` |
| 4 | Does the function read `request.headers`? | **No.** Zero matches for `request.headers` anywhere under `supabase/**` | `git grep "request\.headers" origin/staging -- 'supabase/**'` → no output |
| 5 | Does `TEST_AGENT_INGEST_TOKEN` exist in repo, workflows or config? | Three occurrences, **none of them a workflow or config binding**: two are the script reading it and warning when unset, one is prose | `run-checks.mjs:17`, `:164`; `.lovable/memory/ci/test-agent.md:34` |
| 6 | Does `.github/workflows/test-agent.yml` exist on `staging`? | **Absent**, on `staging` and on `main` | `git ls-tree origin/staging .github/workflows/` and the same for `origin/main` |
| 7 | Does any workflow invoke `run-checks.mjs`? | **None** | `git grep "run-checks" origin/staging -- '.github/**'` → no output |
| 8 | Is the `p_token` comparison therefore dead code? | **No — and this is the important one.** It has no caller *in this repository*. It is not dead: `20260502072904_….sql:163` grants `EXECUTE … TO anon, authenticated`, so anyone holding the publishable key can call it, and the `p_token` check at `:139-141` is the **only** thing standing between that and a write to `test_agent_runs`. Unreferenced ≠ unreachable | `20260502072904_f645403a-7c50-49d3-b818-c41cb68ff9e6.sql:139-141, :162-163` |

## The root cause, verified independently

`cd3dc7e` — *"Remove CI workflows (not needed for hosting; re-add later with workflow-scoped
token)"*, **Thu 9 Jul 2026**, author `Migration` — deleted **seven** workflows, 638 lines:

```
audit-forbidden.yml  per-photo-status-types.yml  prove-block-required.yml
rpc-contract-parity.yml  test-agent.yml (144 lines)  v3-catalog-parity.yml
vocabulary-snapshot.yml
```

The deleted `test-agent.yml` ran on `push: branches: ['**']`, on `pull_request`, and on
`schedule: '*/5 * * * *'`, and its one job step was `node scripts/test-agent/run-checks.mjs`
(`:59`). That script runs, at `:47`, `:51` and `:57`:

```js
run('tsc',    'npx tsc --noEmit');
run('vitest', 'npx vitest run --reporter=basic');
run('eslint', 'npx eslint . --max-warnings=0 --quiet');
```

So `cd3dc7e` is the commit that removed **vitest and eslint from every pull request**, and the
script's header comment *"runs every push + every 5 min"* was not stale when it was written — it
was true until that commit. (Its `npx tsc --noEmit` is the broken form that compiles the solution
file and checks nothing; `android-build.yml:554-558` later recorded and fixed that separately.)

## Conclusion — STOP, as the command directs

The header name cannot be established from existing code or from any documented contract, because
none has ever existed. Per the command, there is no smallest test-first correction to prepare, and
nothing is invented here. The interface decision in §2 above stands and is the blocker.
