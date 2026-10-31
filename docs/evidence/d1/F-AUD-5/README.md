# F-AUD-5 (INFO) · PROBE_p9 long-literal scan

**Cause.** `PROBE_p9_email_queue_wake.sql` judged a "long literal" with `'[^'']{17,}'`.
That pattern also matches the text *between* two short literals, so production's
PASS notice listed `rollup-engagement-daily` (two short literals, no HTTP) as OPEN.
The same pattern was used in E1 (process-email-queue's own command).

**Fix (cause, not symptom).** E1 and the OPEN list now use PROBE_p9c's exact scan:
`regexp_matches(command, '''((?:[^'']|'''')*)''', 'g')`, a literal of 17+ chars,
the job's own name exempt. Nothing else in the PROBE changed. No migration, no rollback
(PROBE only, read-only, ends in ROLLBACK).

**Proof.** `faud5-run-tests.sh` → `faud5-transcript.txt` (15 PASS, staging + production shapes):
- fail first: the merged PROBE (070132a) lists a fixture job with two short literals as OPEN,
  and turns E1 red on a short-literals-only command; the fixed PROBE does neither;
- controls: the fixed PROBE still catches a real long literal, one with `''` inside,
  an `http_post`, and a long literal in process-email-queue (E1 red);
- regression: the full P9 harness (`../P9/p9-email-run-tests.sh`) passes on the fixed PROBE.

Expected on production after merge: `OPEN (P9-c, not this unit): none` (P9-c moved every HTTP job).
