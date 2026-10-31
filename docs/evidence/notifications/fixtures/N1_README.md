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
