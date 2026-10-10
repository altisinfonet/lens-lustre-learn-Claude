ledger-guard v3: /home/claude/PROMOTION_LEDGER.md
  fact source: ATTESTED
  facts file : facts_rev16.json
  endpoints  : main…staging, main…a42b209e
------------------------------------------------------------------------------
LG-01  WARN line 21   [ATTESTED] canonical code-RC field holds 4 live SHAs; only the first (a42b209e4f70) is treated as the RC
LG-02  INFO line 21   [ATTESTED] code-frozen claim holds: only docs/ changed after a42b209e4f70
LG-03  WARN line 21   [ATTESTED] field "application / code rc": 9faf5a17 is attested only as an abbreviation, not as a full SHA; typed check not possible
LG-03  WARN line 21   [ATTESTED] field "application / code rc": fe4505aa is attested only as an abbreviation, not as a full SHA; typed check not possible
LG-04  INFO -         [ATTESTED] 1 SHA(s) recognised as void/superseded from structured fields
LG-05  FAIL line 120  [ATTESTED] claims 43 commits for main…staging; endpoint value is 49 (47 no-merges)
LG-05  FAIL line 120  [ATTESTED] claims 45 commits for main…staging; endpoint value is 49 (47 no-merges)
LG-05  FAIL line 122  [ATTESTED] claims +9494/-1293 for main…staging; endpoint value is +10159/-1293
LG-05  FAIL line 426  [ATTESTED] claims +9680/-1293 for main…staging; endpoint value is +10159/-1293
LG-05  FAIL line 428  [ATTESTED] claims 44 commits for main…staging; endpoint value is 49 (47 no-merges)
LG-05  FAIL line 428  [ATTESTED] claims 46 commits for main…staging; endpoint value is 49 (47 no-merges)
LG-06  INFO -         [ATTESTED] header REV-16 matches newest table row
LG-08  FAIL line 46   [ATTESTED] §16.4 does not resolve to that exact subsection
LG-08  FAIL line 790  [ATTESTED] §8.6 does not resolve to that exact subsection
LG-09  INFO -         [ATTESTED] no-tags claim confirmed for local AND remote
------------------------------------------------------------------------------
FATAL=0 FAIL=8 WARN=3 INFO=4
