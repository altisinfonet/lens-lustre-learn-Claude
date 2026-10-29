# S7b offline runner — status

Updated: 2026-10-29 ~18:20 UTC · branch `status/s7b-runner` (draft, never merged)

**S7b done: ~40 %** (S7b-2, weak-network photos, S7b-1 + 1b live; S7b-3 merging; S7b-4 in build)

| Part | PR | State | merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| S7b-2 own name offline | #543 / #544 | live (app 1.2.30) | c07b6cc / 4151c22 | none | done earlier |
| Weak-network photos | #545 / #546 | live (app 1.2.30) | d3d1ff5 / 262d4cf | none | done earlier |
| S7b-1 photos kept on the phone | #547 → landed in #551; carry #557 | live (switch OFF) | abd26ea / 3f980ba | none | PASS 18:18Z: home + /feed 200 in Chromium, Firefox, WebKit; same text; no new console errors; no photo worker registered (OFF) |
| S7b-1b remote switch `app_image_sw` (default OFF) | #551; carry #557 | live, OFF | abd26ea / 3f980ba | none (row absent = OFF) | as above |
| S7b-3 ~200 feed posts offline | #548 | 5 review rounds, last: nothing blocking; CI running on e699a0d | — | none | — |
| S7b-4 profiles / post pages / comments / notifications offline | (branch s7b/offline-pages) | building, tests written first | — | none | — |
| S7b-5 offline likes, comments, saves, follows, reports, new posts | — | not started | — | — | — |
| S7b-6 videos offline | — | waits for S7 video PRs #539–#542 on staging | — | — | — |
| S7b-7 flight-mode harness in CI + OFF-2 PROBE on live | — | not started | — | — | — |

## Notes

- #548 CI "App starts offline -> stored feed shown" was red because the saved feed is a second reader of the phone's store and the harness control switched off only the first one. The control now removes the saved-feed records too (same test as before); a new leg 1b proves the saved feed alone shows the post. Fails on staging, passes on #548.
- #548 review found 3 blocking items (sign-out race, a wait that could not be cancelled, flight-mode cold start never reached the saved feed). All fixed with tests that failed first.
- With the switch OFF, the live website also drops the older photo worker it has used since August. It only covered the old photo hosts, so the loss is small. Turning the switch on is the Owner's decision.

## Owner list (click-only, plain words)

- Later, your decision: when to turn on "app_image_sw" (photos kept on the phone for no network) on the live site. Before that, a check of the photo server's sharing headers is needed (I will do it and tell you).
