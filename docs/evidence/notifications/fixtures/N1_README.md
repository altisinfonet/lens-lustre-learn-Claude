# N1 fixture (local Postgres 16)

The 12 functions created from the snapshot text (= live on both lanes, N0).

| Case | Result |
|---|---|
| PROBE 0150 before apply | FAIL — not tagged as captured (expected) |
| apply on matching functions | OK; every body md5 and attribute identical before/after; an existing comment kept, tag appended |
| PROBE 0150 after apply | PASS — 12 of 12 equal the text in git |
| rollback | tag removed; the earlier comment restored exactly; untagged comments back to none |
| PROBE after rollback | FAIL again; second rollback refused |
| a live body that differs from the pinned md5 | REFUSED (`NC-0150-PRE-002`), nothing written |
| a live attribute that differs (search_path) | ROLLED BACK (`NC-0150-POST-003`) |
| a live grant that differs | kept as it is (CREATE OR REPLACE preserves grants) — no change |

N5 guard after this file: git now matches live — `notify_post_reaction /
_comment / _tag` queue jobs (no direct write → removed from the allow-list) and
`pj_handle_tag_notification` writes (added).

## Review round 1 (blocking: planner cost not covered)

A re-create without a COST/ROWS clause resets them. Reproduced: live
`get_my_notifications_grouped` set to COST 7 ROWS 20 → the first version
applied cleanly and silently reset them to 100 / 1000. Now the attribute hash
also covers procost, prorows, prosupport, prosqlbody and protrftypes → that
case ROLLS BACK (`NC-0150-POST-003`). Matching functions still PASS 12/12. A
second apply is refused (`NC-0150-PRE-003`, already tagged).

## CI round (two repo tests failed — both real findings)

1. `m2FunctionCallersExplicit`: functions created by a migration must state
   their grants. Added explicit REVOKE/GRANT that reproduce the **live ACL read
   by PROBE 0100** (identical on both lanes). Fixture: ACLs identical before and
   after; a live ACL that differs (anon on `emit_notification`) → ROLLED BACK.
2. `notifications-stage-key-payload.spec` (Phase 7 lock): the live
   `notify_round_published()` / `_insert()` carry 0 / 1 `'stageKey'` for 2
   `emit_notification` calls each — git's latest (20260502090928) has one per
   call. Live is **behind** the project's own rule, so these two are **not
   captured** (capturing would erase the intended code; applying git's version
   would change e-mails members receive). Gap recorded for the judging work.
   N1 now captures 10 functions; PROBE 10/10.
