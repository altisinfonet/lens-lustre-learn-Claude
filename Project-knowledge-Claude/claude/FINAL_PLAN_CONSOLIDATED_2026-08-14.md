# FINAL PLAN — consolidated, supersedes v1/v2/v3 (2026-08-14)

The owner holds the DOCX (`50mm_FINAL_PLAN.docx`); this is the canonical text.
The three earlier plan docs (MASTER_PLAN_INSTAGRAM_STRONG, PLAN_V2_CHECKLIST_MAPPING,
PLAN_V3_ADDENDUM_8_ITEMS) are historical records; THIS file governs.

## Answer
Instagram-strong: YES, achievable. Engine room rebuilt since 13 Aug to verified
Instagram-grade discipline. Showroom (Phase F) not started — where the owner's
complaints live; opens with his bug list.

## Standing rules (permanent)
1. CONTROL loop per production change (hash-bound GO).
2. Alarms not memory; every test mutation-tested. Suite 1,449+.
3. **Deletion Protocol**: no delete without successful fail-loud reference-graph
   enumeration + dry-run → expected count → sample → max-delete threshold →
   execute → post-verify. Goes into AI_CONTROL.md + permanent regression test.
4. **Cross-Surface Visibility Invariant**: oracle = can_view_post(); 9 surfaces
   (Feed, Profile, Wall, Search, Trending, direct post URL, Notifications,
   Media URL, Competition). Today 8/9; Media URL RED until B5 (CDN ignores
   privacy; safe only because 0 non-public posts — verified).
5. Targets never move to pass (open: buffers 2,359 vs 2,000 → retried in D).
6. Evidence log, including self-caught mistakes (12 to date).

## DONE (production-verified)
- Phase A: 7 migrations live; email queue + 4 writers closed (SECDEF 136→132);
  two mutation-tested gate tests force every new migration to close functions
  AND tables.
- Feed: candidate pool, 18.8 ms (was 941 ms / 88× data); deterministic
  per-viewer-per-hour; fairness verified at 1M seeded; live E2E verified incl.
  owner's Chrome, 24/24 CDN OK; legacy overloads intact.
- Media engine: 3-identity system + state machine (pending→verified→ready,
  quarantine terminal, trigger-enforced even vs postgres); idempotent uploads
  (6 retries = 1 object, live-proven). Tables empty by design until B5.
- B3a built awaiting **GO 0555226f**: orphan reference list rebuilt from
  schema (263-file near-miss measured), fail-loud errors, snapshots as
  references, 47 tests 7/7 mutations.

## Roadmap (execution order)
**B remainder**: B3a deploy → B3b R2-aware orphans (Deletion Protocol, dry-run,
delete cap) → B3c scheduled-post thumbnails (+backfill 9) → **B3c-2 EXIF/GPS
stripping (pulled up; live exposure)** → B3d derivative worker (600/1080/1440;
Instagram's core photo trick) → B4 retry/resume (gate: Multi-media Post
Atomicity Matrix — no half-publish, no dup post/ref/object/orphans) → B5 client
switch behind flag + guarded backfill of 210 posts + authorized media delivery
(closes Media-URL red) + written privacy transition matrix incl. CDN cache
invalidation.

**W1 Wallet/payment (engine room)**: full-chain matrix payment → verification →
ledger → balance → entitlement; rows: dup webhook, dup verification,
disconnect-after-success, ledger-write-failure, webhook×2, wrong amount, wrong
user/order, refund, withdrawal race. Signature verification FIRST; daily
Razorpay-vs-ledger reconciliation with alerts. Needs owner's Razorpay sandbox
credentials; never live money.

**CG Competition engine gate (engine room)**: judge authz, participant
isolation, round transitions, score immutability, deterministic winners, dup
submission prevention, award stacking, completed-round protection, audit
trail. First task: the SKIPPED judging-invariants test; then audit
judging-invariants-nightly itself. UI stays in F.

**F Showroom**: owner's bug list drives; per bug reproduce→fix→verify
live→alarm. Areas: Feed (10-s skeleton — server is 19 ms, delay is app-layer;
scroll; back; sizing), Competition, Course (+entitlements), Wallet (UI vs W1
ledger), Search (+9th-surface privacy). Cross-cutting: navigation audit,
scroll pass, loading-state pass. **Capacitor Android Lifecycle Matrix** — 11
rows (bg-during-upload, bg-during-feed, process kill, resume, Back, deep link,
notif routing, picker interruption, permission denial, network switch,
low-memory recreation), each AUTOMATED or DEVICE with recorded evidence; no
green from reasoning. **Gate: binding per-page performance budgets + memory
soak.**

**C Observability & lifecycle**: device-level error/latency + independent
alerting; Notification Recipient-Integrity Matrix (inventory first; wrong
recipient impossible, dedup, deleted user, privacy change, retry, reconnect);
**backup/RESTORE proof early** (a restore executed, not assumed);
account-deletion lifecycle audit (posts, media, R2, wallet, notifications);
rate-limit/abuse audit (spot protections live: presign 60/5min, in-flight cap
50 proven, email allow-list); realtime firehose decision + implementation;
/profile unbounded queries; CDN economics.

**D Scale & resilience**: 100k/1M re-runs (buffer gate retried honestly);
keyset pagination; chaos testing (kill storage/DB/webhooks/CDN on purpose);
written Idempotency Matrix over every writer.

**E Independent final certification**: blind re-audit from zero; verdict from
independent inspection of git/DB/migrations/RPCs/storage/CDN/network/Android/
tests/security/performance — never from the builder's claims. Precondition:
transport solved. Also: legacy 132 SECDEF sweep, dead-code sweep, API +
legacy-client compatibility matrices, whole-schema invariant sweep.

## 35-item reviewer checklist status
2 DONE (media state machine, media referential integrity) · 14 IN PROGRESS ·
19 NOT STARTED · 0 N/A. Full mapping in PLAN_V2_CHECKLIST_MAPPING (historical).

## Risks
1. **Transport (#1)**: 30+ commits only in session; push blocked (per-repo
   allowlist; owner must attach repo with push access). Also precondition of E.
2. Realtime firehose (decision pending, C).
3. Media-URL visibility (RED until B5; 0 non-public posts today).
4. Buffer gate 18% over (D).
5. Frontend alarm blind spot (F fixes incrementally).

## Honest limits
Delivered: Instagram-grade discipline; Instagram's core photo experience;
solid-feeling app; growth confidence; independent certification.
NOT promised: Instagram's operational scale, ML ranking at their level, human
moderation orgs. "More than Instagram" is a false promise; this plan does not
make it.

## Immediate next steps (owner)
1. `GO 0555226f` — deploy deletion-safety fix.
2. Send the bug list → opens Phase F.
3. Attach GitHub repo with PUSH access → retires risk #1, unlocks E.
4. Razorpay sandbox credentials when W1 starts.
