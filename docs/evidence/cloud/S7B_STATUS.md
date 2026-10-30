# S7b offline runner — status

Updated: 2026-10-30 ~13:00 UTC · branch `status/s7b-runner` (draft, never merged)

**S7b done: ~97 %** (all parts merged on main; S7b-6 live check and the Android 1.2.32 bump carry #688 in progress)

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
| S7b-6 videos offline (feed videos: 240p first ≥25 s saved; budget 300 MB default; Wi-Fi only default on; lessons say 'needs a connection') | #674 / carry #682 | on main; review nothing blocking after 4 rounds (7 blocking items fixed, each fail-first) | 0ff0537 / 5d79e0e | none | before-check 11:5xZ: 3 browsers 200; after-check pending deploy |
| App version bump Android 1.2.32 | #683 / carry #688 | merged on staging; carry in CI (review nothing blocking) | 1d5a305 / — | none | — |
| S7b-7 flight-mode harness in CI + OFF-2 PROBE on live | #584 / carry #598 | live in CI (staging 3ad1ef3 / main e27ebe1). PROBE done: production PASS, run 40930361884 (18:27Z). Harness legs 3 (post page + profile offline, bar, no error/'Photographer') and 4 (offline follow exactly once): FAIL on staging before S7b-5a and before S7b-4 ('Post not found'), PASS on the branch; review nothing blocking | 3ad1ef3 / e27ebe1 | PROBE_off2_idempotency production PASS 18:27Z | with #598 |

## Notes

- #548 CI "App starts offline -> stored feed shown" was red because the saved feed is a second reader of the phone's store and the harness control switched off only the first one. The control now removes the saved-feed records too (same test as before); a new leg 1b proves the saved feed alone shows the post. Fails on staging, passes on #548.
- #548 review found 3 blocking items (sign-out race, a wait that could not be cancelled, flight-mode cold start never reached the saved feed). All fixed with tests that failed first.
- With the switch OFF, the live website also drops the older photo worker it has used since August. It only covered the old photo hosts, so the loss is small. Turning the switch on is the Owner's decision.

- 21:00Z: the carry of S7b-5a to main failed the production build's size limit by 66 bytes; staging built the same way fails too. Root cause: a 74 KB photo-details reader was loaded with the app although it is only needed when a photo is picked. #587 loads it only then, so the limit is not raised.

## Owner list (click-only, plain words)

- Your decision: when to turn on "app_image_sw" (photos kept on the phone for no network) on the live site. The photo server's sharing headers were checked and are ready (cdn.50mmretina.com answers the app and the website correctly).
- Your decision: new posts with photos made with no network are kept only while "Upload resume" is on. Click path (added by another session, #652): Admin → Video Feature → Upload Resume → "Selected members" to try it on yourself first, or "All members". Until it is on, a post made offline shows a clear "not sent, still here" message.
- Your decision: course lesson videos are YouTube links. YouTube does not allow saving them on the phone, so with no internet a lesson now says "this video needs a connection". If you want lessons to play offline too, they would have to be uploaded to our own video system instead of YouTube — tell me if you want that as a later job.
- For the database team (D1), not a click: liking a comment offline can only be queued after "post_comment_reactions" is added to their exactly-once list; until then it says "needs a connection".
