# S11 disaster drills D1–D9 — 2026-10-30

The S11 scope names the drills in this order; this file gives them numbers.

| # | Drill | How | Result |
|---|---|---|---|
| D1 | Point-in-time restore to a branch, with RPO/RTO | Supabase branch + PITR | **Not run — needs `SUPABASE_ACCESS_TOKEN`** (Owner list item 7). Restoring production is never done by hand. |
| D2 | Photo storage / CDN outage | `tools/drills/outage-drills.cjs`: every request to the lane's CDN host fails | see table below |
| D3 | Site edge outage (`/config/*`, Cloudflare Pages Functions) | same tool: `/config/*` fails | see table below |
| D4 | Supabase outage | same tool: every request to `<ref>.supabase.co` fails | see table below |
| D5 | Edge-function outage | same tool: `<ref>.supabase.co/functions/v1/*` fails | see table below |
| D6 | Corrupted derivative | same tool: every CDN image answers 200 with non-image bytes | see table below |
| D7 | Partial migration | local Postgres 16, production- and staging-shaped fixtures: a failure injected just before `COMMIT` of 20261031_0100 | **PASS** — exit 3 on the injected error; the schema is byte-identical (md5 of every public function definition) |
| D8 | Failed rollback | the same, injected into its rollback | **PASS** — exit 3; the applied state is byte-identical. The real rollback returns to the pre-migration state, and a re-apply gives an identical result |
| D9 | Full backup restore → app boots, feed renders | restore into a new project | **Not run — needs `SUPABASE_ACCESS_TOKEN`** (item 7) |

## D7 / D8 — why a half-applied migration cannot happen

`apply-migration.yml` runs `psql --set ON_ERROR_STOP=1 -f <file>` without `--single-transaction`. The guarantee therefore lives in each file: exactly one top-level `BEGIN … COMMIT`.

- All 10 migrations and 10 rollbacks dated 20261028 or later have that shape.
- `src/__tests__/migrationSingleTransaction.test.ts` keeps it true for every new file. PROBEs are exempt, because they end in `ROLLBACK` on purpose.
- A mutation that removed the `COMMIT` from 20261029_0201 turned exactly that file's test red.

Drill transcript (local, 2026-10-30 ~00:31 UTC):

```
== production  setup: real rollback → pre-0100 state  [0|]
D7 injected failure before COMMIT of the apply: [3|ERROR:  division by zero] · nothing applied: YES
   real apply: [0|] · applied: YES
D8 injected failure before COMMIT of the rollback: [3|ERROR:  division by zero] · applied state intact: YES
   real rollback: [0|] · back to pre-0100: YES
   re-apply after rollback: [0|] · same as first apply: YES
== staging  (identical: every line YES)
```

## D2–D6 — outage behaviour in Chromium, Firefox and WebKit (staging)

The tool is read-only. It loads `/` and `/feed` as a signed-out visitor and blocks or corrupts responses inside the test browser only. After each load it waits 20 s and then records:
- the document status;
- the visible text length;
- uncaught page errors;
- whether the crash screen ("Something went wrong while loading this page") shows;
- the most requests made to any single failed URL.

A drill passes when the page returns 200, no crash screen shows, there is no uncaught error, text is present, and **no request reaches the failed host in the last 10 s** of the 20 s watch window. That last column is "After settle". "Max to one URL" is shown for information: a bounded fallback settles, a retry storm keeps going.

Run of 2026-10-30 01:01 UTC against `https://staging.50mmretina.com`:

| Browser | Drill | Path | Result | Status | Text | Crash screen | Uncaught errors | Requests to failed host | Max to one URL | After settle | First uncaught error |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | baseline | / | PASS | 200 | 2525 | False | 0 | 0 | 0 | 0 |  |
| chromium | baseline | /feed | PASS | 200 | 575 | False | 0 | 0 | 0 | 0 |  |
| chromium | D2 photo CDN down | / | PASS | 200 | 2525 | False | 0 | 53 | 5 | 0 |  |
| chromium | D2 photo CDN down | /feed | PASS | 200 | 575 | False | 0 | 3 | 1 | 0 |  |
| chromium | D3 site edge config down | / | PASS | 200 | 2525 | False | 0 | 3 | 3 | 0 |  |
| chromium | D3 site edge config down | /feed | PASS | 200 | 575 | False | 0 | 3 | 3 | 0 |  |
| chromium | D4 Supabase down | / | PASS | 200 | 2119 | False | 0 | 20 | 4 | 0 |  |
| chromium | D4 Supabase down | /feed | PASS | 200 | 575 | False | 0 | 6 | 2 | 0 |  |
| chromium | D5 edge functions down | / | PASS | 200 | 2525 | False | 0 | 2 | 2 | 0 |  |
| chromium | D5 edge functions down | /feed | PASS | 200 | 575 | False | 0 | 2 | 2 | 0 |  |
| chromium | D6 corrupted derivative | / | PASS | 200 | 2525 | False | 0 | 44 | 4 | 0 |  |
| chromium | D6 corrupted derivative | /feed | PASS | 200 | 575 | False | 0 | 3 | 1 | 0 |  |
| firefox | baseline | / | FAIL | 200 | 2525 | False | 1 | 0 | 0 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | baseline | /feed | FAIL | 200 | 575 | False | 1 | 0 | 0 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D2 photo CDN down | / | FAIL | 200 | 2525 | False | 1 | 38 | 3 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D2 photo CDN down | /feed | FAIL | 200 | 575 | False | 1 | 3 | 1 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D3 site edge config down | / | FAIL | 200 | 2525 | False | 1 | 3 | 3 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D3 site edge config down | /feed | FAIL | 200 | 575 | False | 1 | 3 | 3 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D4 Supabase down | / | FAIL | 200 | 2119 | False | 1 | 20 | 4 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D4 Supabase down | /feed | FAIL | 200 | 575 | False | 1 | 6 | 2 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D5 edge functions down | / | FAIL | 200 | 2525 | False | 1 | 2 | 2 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D5 edge functions down | /feed | FAIL | 200 | 575 | False | 1 | 2 | 2 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D6 corrupted derivative | / | FAIL | 200 | 2525 | False | 1 | 44 | 4 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| firefox | D6 corrupted derivative | /feed | FAIL | 200 | 575 | False | 1 | 3 | 1 | 0 | Acquiring an exclusive Navigator LockManager lock "lock:sb-fpszggreish |
| webkit | baseline | / | PASS | 200 | 2525 | False | 0 | 0 | 0 | 0 |  |
| webkit | baseline | /feed | PASS | 200 | 575 | False | 0 | 0 | 0 | 0 |  |
| webkit | D2 photo CDN down | / | PASS | 200 | 2525 | False | 0 | 71 | 7 | 0 |  |
| webkit | D2 photo CDN down | /feed | PASS | 200 | 575 | False | 0 | 4 | 2 | 0 |  |
| webkit | D3 site edge config down | / | PASS | 200 | 2525 | False | 0 | 2 | 2 | 0 |  |
| webkit | D3 site edge config down | /feed | PASS | 200 | 575 | False | 0 | 2 | 2 | 0 |  |
| webkit | D4 Supabase down | / | PASS | 200 | 2119 | False | 0 | 20 | 4 | 0 |  |
| webkit | D4 Supabase down | /feed | PASS | 200 | 575 | False | 0 | 6 | 2 | 0 |  |
| webkit | D5 edge functions down | / | PASS | 200 | 2525 | False | 0 | 2 | 2 | 0 |  |
| webkit | D5 edge functions down | /feed | PASS | 200 | 617 | False | 0 | 2 | 2 | 0 |  |
| webkit | D6 corrupted derivative | / | PASS | 200 | 2525 | False | 0 | 54 | 4 | 0 |  |
| webkit | D6 corrupted derivative | /feed | PASS | 200 | 575 | False | 0 | 4 | 2 | 0 |  |

**Reading:**
- In every drill, in every browser, the page answered 200, there was no crash screen and text rendered. With Supabase down (D4), home shows less: 2,119 characters instead of 2,525.
- Requests to the failed host were zero after the first 10 s, so there is no retry storm. Each failed photo is asked for 1–7 times (about 5 typically) in the first ~5 s (the thumbnail → render URL → original fallback, plus a re-render), and then never again.
- **Firefox fails every row on one uncaught error, the baseline included:** supabase-js auth-lock contention ("Acquiring an exclusive Navigator LockManager lock … immediately failed").
  - auth-js handles it itself, but Firefox also reports the lock callback's rejection.
  - It is not caused by any outage. It is noise, and client telemetry was counting it as a script error.
  - Fixed in telemetry by #614. Only the zero-wait form is ignored; the real 10 s lock timeout still counts.
