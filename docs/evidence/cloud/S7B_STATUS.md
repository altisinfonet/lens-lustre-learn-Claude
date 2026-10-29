# S7b offline runner — status

Updated: 2026-10-29 ~19:30 UTC · branch `status/s7b-runner` (draft, never merged)

**S7b done: ~55 %** (S7b-2, weak photos, S7b-1/1b live; S7b-3 merged on staging, carry #563 in CI; S7b-4 #564 reviewed; S7b-5a built)

| Part | PR | State | merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| S7b-2 own name offline | #543 / #544 | live (app 1.2.30) | c07b6cc / 4151c22 | none | done earlier |
| Weak-network photos | #545 / #546 | live (app 1.2.30) | d3d1ff5 / 262d4cf | none | done earlier |
| S7b-1 photos kept on the phone | #547 → landed in #551; carry #557 | live (switch OFF) | abd26ea / 3f980ba | none | PASS 18:18Z: home + /feed 200 in Chromium, Firefox, WebKit; same text; no new console errors; no photo worker registered (OFF) |
| S7b-1b remote switch `app_image_sw` (default OFF) | #551; carry #557 | live, OFF | abd26ea / 3f980ba | none (row absent = OFF) | as above |
| S7b-3 ~200 feed posts offline | #548 + follow-up #566; carry #563 | staging merged; carry CI running | a244d90 + f5a69ec / — | none | baseline taken 19:20Z |
| S7b-4 profiles / post pages / comments / notifications offline | #564 | 3 review rounds, last: nothing blocking; CI running after rebase | — | none | — |
| S7b-5a offline follows, reports, pending marks, offline bar, own name | branch s7b/offline-actions | built, tests pass; PR after #564 | — | none | — |
| S7b-5b new posts with photos made offline | — | needs Owner switch photo_upload_resume (see list) | — | — | — |
| S7b-6 videos offline | — | waits for S7 video PRs #539–#542 on staging | — | — | — |
| S7b-7 flight-mode harness in CI + OFF-2 PROBE on live | — | PROBE done: production PASS, run 40930361884 (18:27Z); harness part pending | — | PROBE_off2_idempotency production PASS 18:27Z | — |

## Notes

- #548 CI "App starts offline -> stored feed shown" was red because the saved feed is a second reader of the phone's store and the harness control switched off only the first one. The control now removes the saved-feed records too (same test as before); a new leg 1b proves the saved feed alone shows the post. Fails on staging, passes on #548.
- #548 review found 3 blocking items (sign-out race, a wait that could not be cancelled, flight-mode cold start never reached the saved feed). All fixed with tests that failed first.
- With the switch OFF, the live website also drops the older photo worker it has used since August. It only covered the old photo hosts, so the loss is small. Turning the switch on is the Owner's decision.

## Owner list (click-only, plain words)

- Later, your decision: when to turn on "app_image_sw" (photos kept on the phone for no network) on the live site. Before that, a check of the photo server's sharing headers is needed (I will do it and tell you).
- Your decision: new posts with photos made with no network need the switch "photo_upload_resume" (S5, today OFF). Until it is on, a post made offline shows a clear message instead of being kept.
- For the database team (D1), not a click: liking a comment offline can only be queued after "post_comment_reactions" is added to their exactly-once list; until then it says "needs a connection".
