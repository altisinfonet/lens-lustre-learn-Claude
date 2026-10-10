# PLAN v3 ADDENDUM — reviewer's 8 additions, all adopted (2026-08-14)

Implementation remains FROZEN. Complete plan = v1 (phases) + v2 (35-item
mapping) + this addendum. B3a still awaits `GO 0555226f`.

## The eight, as adopted

1. **W1 Payment/Wallet Transaction Integrity Matrix** — full chain payment →
   verification → ledger → balance → entitlement; duplicate webhook, duplicate
   verification, disconnect-after-success, ledger-write failure, double
   webhook, wrong amount, wrong user/order, refund, withdrawal race. My
   additions: webhook SIGNATURE verification tested first; standing daily
   reconciliation (Razorpay records vs our ledger, alert on delta).
   **Caveat 1: requires Razorpay sandbox/test mode — never live money.**

2. **Notification Recipient-Integrity Matrix** — event → record → recipient →
   realtime → email → dedup → read state; wrong-recipient-impossible,
   dup-event≠dup-notif, deleted user, blocked user, privacy change, retry,
   reconnect. Addition: inventory step first (user_notifications,
   admin_notifications, gift_announcements, friendships, follows, push, email).
   "Blocked user" row conditional on verifying a blocking mechanism exists.

3. **Competition Engine Integrity Gate** — data half promoted to engine room
   (judge authz, participant isolation, round transitions, score immutability,
   deterministic winners, dup-submission prevention, award stacking,
   completed-round protection, audit trail); UI stays Phase F. First task:
   the judging-invariants test currently SKIPPED in the suite; then audit the
   nightly auditor itself.

4. **Cross-Surface Visibility Invariant** — one oracle (`can_view_post()`),
   nine surfaces: Feed, Profile, Wall, Search, Trending, direct post URL,
   Notifications, Media URL, Competition. **Caveat 2: Media URL is honestly RED
   today** — CDN serves images regardless of privacy; safe only because
   production has 0 non-public posts; repaired in B5. Matrix shows 8/9 until
   then.

5. **Capacitor Android Lifecycle Matrix** — 11 scenarios adopted (background
   during upload/feed, process kill, resume, Back, deep link, notif routing,
   picker interruption, permission denial, network switch, low-memory
   recreation). **Caveat 3: rows marked AUTOMATED (CI emulator) or DEVICE
   (scripted manual, evidence-recorded). No green from reasoning alone.**

6. **Multi-media Post Atomicity Matrix** — 5-photo/photo-3-fails must not
   half-publish; retry creates no dup post/reference/object/orphan
   derivatives. Enablers already live: idempotent media_begin_upload +
   post_media composite PK. Becomes the B4/B5 acceptance gate.

7. **Deletion Protocol — standing platform rule** — no delete without
   successful reference-graph enumeration (fail-loud, shipped in B3a) and
   dry-run → expected count → sample → max-deletion threshold → execute →
   post-verify. Elevated: written into AI_CONTROL.md + a permanent regression
   test that every deletion-capable function implements the protocol.

8. **Independent Final Certification Gate** — Phase E verdict cannot rest on my
   PASS/FAIL claims; reviewer inspects git, prod DB, migrations, RPCs, storage,
   CDN, network, Android, tests, security, performance from raw evidence.
   **Precondition: transport solved — commits that exist only in my session
   cannot be independently inspected. The #1 risk and the final gate are the
   same problem.**
