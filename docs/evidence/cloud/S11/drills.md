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

A drill passes when the page returns 200, no crash screen shows, there is no uncaught error, text is present, and no failed URL is requested more than 4 times. A retry storm would show up as one URL requested many times.

_Results pending: the run with the settle-time rule is in progress (2026-10-30 ~00:50 UTC). An earlier run with a cruder metric showed every page 200 with no crash screen in all three browsers; the only uncaught error was the Firefox auth-lock noise fixed by #614._
