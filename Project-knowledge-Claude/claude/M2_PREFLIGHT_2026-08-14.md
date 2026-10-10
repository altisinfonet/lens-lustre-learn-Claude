# M2 PREFLIGHT — default privileges / anon-executable SECURITY DEFINER

**No production write. No Supabase branch created** (cost quoted below, not spent).
Base `f8c1985` · DB `20260814042609` · state → `READY_FOR_REVIEW`.

## VERDICT: M2 MUST NOT PROCEED ON CURRENT EVIDENCE

Not because it is wrong — because the evidence available today **cannot** tell us which
functions are safe to revoke, and I proved that twice during this preflight rather than
assuming it.

---

## 1. The population is smaller than the audit said

| | count |
|---|---|
| SECURITY DEFINER functions anon-executable (advisor figure) | 246 |
| …of which are **trigger functions** — PostgREST cannot invoke them | 114 |
| **Actually reachable at `/rest/v1/rpc/<name>` by `anon`** | **132** |

The 114 triggers are noise in the advisor count. Real surface is 132.

## 2. M2 is two operations, not one, and only one of them is dangerous

**M2a — `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM anon, authenticated`.**
Postgres consults `pg_default_acl` **only at CREATE time**. It has no retroactive mechanism.
Evidence from production, not assertion: `enqueue_post_job(jsonb)` reads `anon=false` and
`enqueue_email` now reads `anon=false`, while `pg_default_acl` still says `anon=X` — existing
ACLs demonstrably do not track the default.

→ **M2a changes nothing about the 132.** It is near-zero risk and it stops the bleeding: every
*future* function stops being auto-granted. This is the part worth doing soon.

**M2b — bulk `REVOKE` on the existing 132 minus an allow-list.**
This is the entire risk, and it is where the evidence fails.

## 3. Why the allow-list cannot be built from source, proven twice

| Attempt | Result |
|---|---|
| Line-based `grep '\.rpc("name"'` | 101 names. **Missed 7** formatted across lines |
| Multiline-aware regex | 108 names. **Still missed `log_app_event` and `log_client_error`** |
| Cast-aware (`(supabase.rpc as any)("…")`) | **118 names** |

Original method missed **17 of 118 — a 14% error rate.** Among the missed: `log_app_event`
and `log_client_error`, the entire client telemetry path. Both **swallow their own errors by
design** (`logger.ts:292-295`), so revoking them would have silently blinded production
telemetry with no visible failure anywhere.

## 4. The decisive argument — source scanning cannot see installed apps

Production logs, last 24 h, show **34 distinct RPCs** actually invoked. Two of them —
`get_top_contributors_v1` and `record_activity_minute` — **do not appear anywhere in the
current source tree**.

That is the point. **Installed Android builds run their own bundled JavaScript.** Build 1073 is
live on Play, and builds up to 1.2.4 exist. Each carries the RPC calls of the source tree at the
time it was cut. No scan of today's `src/` can enumerate what a phone installed in June calls.

A revocation based on today's source would break those users, silently, and only for them —
the exact asymmetry of trap #3, where the owner sees everything working.

## 5. Current partition — for information, NOT for action

| Bucket | count |
|---|---|
| Evidence of use (source ∪ 24 h logs) → **KEEP** | 86 |
| No evidence of use → **candidates only** | 46 |

The 46 are candidates, not a plan. A monthly admin drift report, a certificate verification, a
competition submission path — none would appear in a 24-hour window, and several of the 46 are
exactly those.

## 6. What M2 actually requires — instrument, then revoke

1. **`ALTER DATABASE … SET track_functions = 'all'`** — makes Postgres itself record every
   execution, including calls from old installed APKs. This is the missing instrument, and it
   is the only source of truth that covers clients we cannot read.
2. **Gather for a defined window.** Long enough to cover monthly admin cycles — 30 days is the
   honest figure, not 24 hours.
3. **Then revoke** only functions with zero recorded calls across the window *and* no source
   reference *and* no reference in any shipped APK's bundle.
4. Apply in **tranches**, most-obviously-dead first, with a gate report each time.

This mirrors the project's own standing rule for the feed RPC: *measure before choosing a fix.*
Applying it here means M2b is weeks away, and that is the correct answer rather than a
disappointing one.

## 7. Incidental findings

- **`read_email_batch` was called 16,952 times in 24 hours** (~12/min). That is
  `process-email-queue` polling. Post-M1 it is `service_role` only, so it is not a security
  issue — but it is by far the largest RPC consumer on the project and worth a look for cost
  and noise.
- Postgres `track_functions` is **`none`**, so the database currently records no function usage
  at all. That is why step 1 above is a prerequisite rather than a nicety.
- A Supabase branch costs **$0.01344/hour**. Not created — the read-only route answered the
  question better, and I do not spend on the account without a word.

## 8. Recommendation

- **Do M2a now** (default privileges). Near-zero risk, stops recurrence, needs one `GO`.
- **Enable `track_functions`** in the same cycle. It is the instrument M2b depends on.
- **Defer M2b** until the window has data. Revisit with real call counts.
- Meanwhile Phase 1 (feed database) is unblocked and is the larger user-visible win.
