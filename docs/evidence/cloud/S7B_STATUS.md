# S7b offline runner — status

Updated: 2026-10-29 ~20:25 UTC · branch `status/s7b-runner` (draft, never merged)

**S7b done: ~70 %** (S7b-1/1b, S7b-2, S7b-3, S7b-4 live; S7b-5a/5b in review; S7b-6 waits for #539–#542; S7b-7 harness pending)

| Part | PR | State | merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| S7b-2 own name offline | #543 / #544 | live (app 1.2.30) | c07b6cc / 4151c22 | none | done earlier |
| Weak-network photos | #545 / #546 | live (app 1.2.30) | d3d1ff5 / 262d4cf | none | done earlier |
| S7b-1 photos kept on the phone | #547 → landed in #551; carry #557 | live (switch OFF) | abd26ea / 3f980ba | none | PASS 18:18Z: home + /feed 200 in Chromium, Firefox, WebKit; same text; no new console errors; no photo worker registered (OFF) |
| S7b-1b remote switch `app_image_sw` (default OFF) | #551; carry #557 | live, OFF | abd26ea / 3f980ba | none (row absent = OFF) | as above |
| S7b-3 ~200 feed posts offline | #548 + #566 / carry #563 | live | a244d90 + f5a69ec / 9e14592 | none | PASS 19:49Z: 3 browsers 200, same content, no new console errors (a pre-existing 'Slow connection' bar appeared from this sandbox's slow link) |
| S7b-4 profiles / post pages / comments / notifications offline | #564 (+ follow-up #575) / carry #572 | live; #575 in CI | 9551368 / 0a8ab79 | none | PASS 20:24Z: 3 browsers 200, same text, no new console errors |
| S7b-5a offline follows, reports, pending marks, offline bar, own name | #574 | review nothing blocking (round 2); CI | — | none | — |
| S7b-5b new posts with photos made offline | branch s7b/offline-posts (PR after #574) | built; works only with Owner switch photo_upload_resume ON | — | none | — |
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
