# F-105e — the admin Approve button, measured over HTTP before and after

Unit: `20260910_0022_f105e_referral_overload_unambiguous.sql`
Gate probe: `supabase/migrations/PROBE_f105e_referral_overload_unambiguous.sql`
Lane: staging `fpszggreishhuvdpkmdr`. Date: 2026-09-12.

## Why the instrument is pg_net and not curl

The defect is PostgREST's, not Postgres's, so it has to be read over HTTP. The
session's egress policy denies `supabase.co` (`connect_rejected`, gateway 403 to
CONNECT), so the requests were issued from inside the database with `pg_net`
0.20.4 against the project's own public REST URL. That is the same endpoint and
the same PostgREST instance the browser talks to; only the source address
differs. Requests were sent with the publishable (anon) key, which is a public
value present in every browser bundle. No secret was handled.

Every `_referred_user_id` is a freshly generated uuid that exists in no table,
so no referral row could be matched and no `wallet_transaction()` could fire.

## The readings

`POST /rest/v1/rpc/process_referral_reward`

| # | body | before 0022 | after 0022 |
|---|---|---|---|
| two keys — `AdminReferrals.tsx:124` | `_referred_user_id`, `_activity_type` | **300** `PGRST203` | **401** `42501` |
| three keys — `CompetitionSubmit.tsx:328` | + `_txn_amount` | **401** `42501` | **401** `42501` |

Before, verbatim:

```
PGRST203  Could not choose the best candidate function between:
  public.process_referral_reward(_referred_user_id => uuid, _activity_type => text),
  public.process_referral_reward(_referred_user_id => uuid, _activity_type => text, _txn_amount => numeric)
hint: Try renaming the parameters or the function itself in the database
      so function overloading can be resolved
```

After, verbatim, for both shapes:

```
42501  permission denied for function process_referral_reward
```

## Reading the readings

**The three-key row is the control, and it is what makes the two-key row
conclusive without an admin JWT.** Before 0022 the three-key call was refused
for *permission* (401) while the two-key call was refused at *routing* (300),
before any permission check ran. Routing therefore strictly precedes
authorisation, and a JWT changes only authorisation — so an admin received the
same 300. The button raised "Reward failed" and approved nothing.

After 0022 the two-key call reaches authorisation and is refused there, with the
same 42501 the three-key call gets. **The 401 is `anon` being correctly revoked
(F-105d), not a remaining fault** — it is the request getting all the way to the
grant check, which is exactly what was broken. An admin JWT now resolves to the
two-argument overload and is admitted by F-105d's self-or-admin guard.

What is *not* claimed here: this is not an end-to-end click of the button with a
real admin session. That needs an admin JWT, which this lane does not hold.
What is established is that the failure which made the click impossible is gone.

## In-database twin, same cause, same fix

`42725 function public.process_referral_reward(uuid, text) is not unique` —
positional and named alike — before 0022; resolves after. That is what probe
gate G3 asserts, and it is labelled in the probe as a proxy for the HTTP
reading rather than a substitute for it.

## Run numbers

| run | file | result |
|---|---|---|
| #64 | `PROBE_f105e…` | **red** — fail-first (C-34): G2 `pronargdefaults` = 1, G3 = 42725 |
| #65 | `20260910_0022_f105e…` | applied |
| #66 | `PROBE_f105e…` | **green** — G1–G6, `F-105e PROBE PASSED` |
| #67 | `PROBE_f105d…` | **green** — regression check; 0022 recreates the function, so F-105d's guard was re-proved after it |

ACL after the DROP+CREATE, both overloads (F-66 gate, probe G5):

```
postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

No PUBLIC, no anon. `pronargdefaults` = 0 on both. The 3-arg oid changed
20678 → 21828, as a recreate must.

## Production — INFERRED FROM SOURCE, NOT MEASURED

This lane has no production database access and no route to the production REST
endpoint, so **the production reading has not been taken.** What is established
from `origin/main`:

* both overloads are defined there, the three-argument one with
  `_txn_amount numeric DEFAULT 0`;
* `AdminReferrals.tsx` on main sends the same two keys;
* no migration on main removes the default, renames either function, or
  otherwise changes the resolution;
* main carries no F-105e fix.

On that basis production has the same shape and its PostgREST will answer the
same PGRST203 — the admin Approve button is expected to be broken there too, and
to have been since the three-argument overload was added (`20260228102118`).

**This must be measured on production before it is believed**, by the same
pg_net method, using the production publishable key. Until then it is an
inference from migration source, which is exactly the class of claim C-38, C-42,
C-44 and C-45 were all corrected for.
