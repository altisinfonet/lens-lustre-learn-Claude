# S7b offline runner — status

Updated: 2026-10-30 ~09:40 UTC · branch `status/s7b-runner` (draft, never merged)

**S7b done: ~90 %** (S7b-1/1b, 2, 3, 4, 5a, 5b, 7 live; S7b-6 blocked: the S7 video PRs #539–#542 it must build on are still open (another session's, untouched since 14:19Z); the app version bump waits for all parts — see Owner list)

| Part | PR | State | merged sha (staging / main) | SQL runs | Live check |
|---|---|---|---|---|---|
| S7b-2 own name offline | #543 / #544 | live (app 1.2.30) | c07b6cc / 4151c22 | none | done earlier |
| Weak-network photos | #545 / #546 | live (app 1.2.30) | d3d1ff5 / 262d4cf | none | done earlier |
| S7b-1 photos kept on the phone | #547 → landed in #551; carry #557 | live (switch OFF) | abd26ea / 3f980ba | none | PASS 18:18Z: home + /feed 200 in Chromium, Firefox, WebKit; same text; no new console errors; no photo worker registered (OFF) |
| S7b-1b remote switch `app_image_sw` (default OFF) | #551; carry #557 | live, OFF | abd26ea / 3f980ba | none (row absent = OFF) | as above |
| S7b-3 ~200 feed posts offline | #548 + #566 / carry #563 | live | a244d90 + f5a69ec / 9e14592 | none | PASS 19:49Z: 3 browsers 200, same content, no new console errors (a pre-existing 'Slow connection' bar appeared from this sandbox's slow link) |
| S7b-4 profiles / post pages / comments / notifications offline | #564 (+ follow-up #575) / carry #572 (+ #579) | live | 9551368 + 23cb7ac / 0a8ab79 + 459926f | none | PASS 20:24Z: 3 browsers 200, same text, no new console errors |
| S7b-5a offline follows, reports, pending marks, offline bar, own name | #574 / carry #579 | live | 29f949d / 459926f | none | PASS ~22:45Z: home + /feed 200 in Chromium, Firefox, WebKit; no new console errors; no photo worker (switch OFF). Text changes = the sandbox's 'Slow connection' bar (Chromium) and the home page's live times/counters (stable between back-to-back loads) |
| S7b-5b new posts with photos made offline | #583 / carry #598 | live (works once the Owner turns on photo_upload_resume) | 6c5629b / e27ebe1 | none | PASS ~23:40Z: home + /feed 200 in 3 browsers; /feed text identical; home differs only by one relative time ('7h' → '8h'); no new console errors; no photo worker |
| P13 entry budget (unblocks carries) | #587 / carry #579 | live; exifr loaded on demand: entry −74.6 KB, ceiling unchanged | d597979 / 459926f | none | with #579 |
| S7b-6 videos offline | — | waits for S7 video PRs on staging: #539 merged 09:10Z; #540, #541, #542 still open | — | — | — |
| S7b-7 flight-mode harness in CI + OFF-2 PROBE on live | #584 / carry #598 | live in CI (staging 3ad1ef3 / main e27ebe1). PROBE done: production PASS, run 40930361884 (18:27Z). Harness legs 3 (post page + profile offline, bar, no error/'Photographer') and 4 (offline follow exactly once): FAIL on staging before S7b-5a and before S7b-4 ('Post not found'), PASS on the branch; review nothing blocking | 3ad1ef3 / e27ebe1 | PROBE_off2_idempotency production PASS 18:27Z | with #598 |

## Notes

- #548 CI "App starts offline -> stored feed shown" was red because the saved feed is a second reader of the phone's store and the harness control switched off only the first one. The control now removes the saved-feed records too (same test as before); a new leg 1b proves the saved feed alone shows the post. Fails on staging, passes on #548.
- #548 review found 3 blocking items (sign-out race, a wait that could not be cancelled, flight-mode cold start never reached the saved feed). All fixed with tests that failed first.
- With the switch OFF, the live website also drops the older photo worker it has used since August. It only covered the old photo hosts, so the loss is small. Turning the switch on is the Owner's decision.

- 21:00Z: the carry of S7b-5a to main failed the production build's size limit by 66 bytes; staging built the same way fails too. Root cause: a 74 KB photo-details reader was loaded with the app although it is only needed when a photo is picked. #587 loads it only then, so the limit is not raised.

## Owner list (click-only, plain words)

- Your decision: when to turn on "app_image_sw" (photos kept on the phone for no network) on the live site. The photo server's sharing headers were checked and are ready (cdn.50mmretina.com answers the app and the website correctly).
- Your decision: new posts with photos made with no network are kept only while "Upload resume" is on. Click path (added by another session, #652): Admin → Video Feature → Upload Resume → "Selected members" to try it on yourself first, or "All members". Until it is on, a post made offline shows a clear "not sent, still here" message.
- Your decision (or the supervisor session's): S7b-6 (videos offline) can only start once the S7 video PRs #540, #541, #542 are merged on staging (#539 merged 2026-10-30 09:10 UTC). They belong to another session.
- Your decision: the app version bump. The rule is one bump when ALL S7b parts are live. Everything except S7b-6 is live on the website now, but reaches phones only with a new app version. Choose: (a) wait for S7b-6, or (b) reply "bump now" and I bump now and again after S7b-6.
- For the database team (D1), not a click: liking a comment offline can only be queued after "post_comment_reactions" is added to their exactly-once list; until then it says "needs a connection".
