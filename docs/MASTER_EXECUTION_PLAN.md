# 50MM RETINA WORLD — MASTER EXECUTION PLAN

**Revision:** 2026-08-21 (FINAL MASTER PLAN REVISION) · **Supersedes** the REVISED
2026-08-21 draft and every prior Four-Phase Status Plan.
**This is the single authoritative project document.** No parallel plan exists. History
is preserved, not rewritten; where this revision corrects an earlier claim, the
correction says so and cites the evidence.

---

# PART I — FOR THE ENGINEER JOINING IN SIX MONTHS

## What this project is

50mm Retina World (www.50mmretina.com) is a photography community platform —
competitions, education, journal, and an Instagram-style photo feed — built as a React
18 + TypeScript SPA on Supabase (Postgres + RLS + ~70 Deno edge functions), with media
in Cloudflare R2 behind `cdn.50mmretina.com`, deployed on Cloudflare Pages, and shipped
to Android as a **Capacitor app that bundles the web build** (`webDir: 'dist'`, no
`server.url` — an installed APK is frozen at build time; this single fact explains half
the operational history below).

## Why the media architecture exists

Until 2026-08, a published photograph was only `posts.image_urls` — bytes in a bucket
and a string in an array, nothing verifying that the stored file was the chosen file.
Phase 2 built the **media engine**: `media_objects` (server-verified content identity:
owner, sha256, dimensions, bytes, MIME, state machine pending→verified→ready→
quarantined) and `post_media` (post↔media references with dense ordinals), written
through SECURITY DEFINER RPCs only. `posts.image_urls` is retained as a **derived**
dual-write because the installed Android fleet reads it (decision D-004). Legacy-only
posts that can never migrate are documented exclusions (D-006), not backlog.

## What must never be changed (standing rules, each learned the hard way)

1. **`supabase.rpc` / `supabase.from` are called in call position, never stored.** The
   detached-method bug shipped twice (2026-08-12 draft path; 2026-08-20 media path,
   RED-1) and cost members their posts. Locked by a prototype-bound test mock, a
   repository-wide static scan, and mutations R1a–R1f.
2. **The frozen 229-migration fence and historical manifests are immutable.** Mutation
   harnesses go red if any is redefined.
3. **`MIG-1019` / `MEDIA-2102` ownership rules (owner at path segment 2) are not
   widened.** Rejecting 2 cover photos was decided (D-006) rather than weakening this.
4. **Migration work comes only from an approved, hashed manifest — never a live scan.**
5. **`image_urls` is derived inside `post_publish_with_media`, never caller-supplied.**
6. **The legacy insert in `WallPosts.tsx` stays as the airbag** (D-005) with classified
   failure reporting (MEDIA-4009/4010); it must never become the normal route.
7. **No REELS, no LIVE, no video.** Standing owner rule.
8. **Never `npm install` casually; Capacitor versions stay pinned; `android/` is not
   committed.**
9. **Mutation harnesses refuse a RED baseline** (a harness once printed 24 green ticks
   over a failing suite), and **stale mutation targets are retargeted with the
   invariant restated — never deleted, never weakened**.
10. **A human-reported PASS enters this plan only with a correlated production row**
    (Governing Rule G1 below).

## How work ships (the transport reality)

Direct `git push` from the engineering sandbox is proxy-blocked. Work lands via the
GitHub web UI (one directory per commit, **every file byte-verified against its local
git blob SHA after every commit** — silent drops happen), then PR → 7 CI gates →
squash-merge. Database changes go through `apply_migration` with the repo ledger
renamed to the server-assigned version. Android ships only when a human uploads the
signed AAB from the `android-build` workflow artifacts to the Play Console
(`PLAY_SERVICE_ACCOUNT_JSON` has never been configured; if it ever is, upload becomes
automatic as a production draft).

---

# PART II — GOVERNING RULES (all ten sharpenings incorporated)

- **G0 · Evidence beats assumption.** Source PASS ≠ runtime proof ≠ device proof ≠
  production operation. States: NOT STARTED → DESIGNED → IMPLEMENTED → TESTED →
  MUTATION-PROVEN → DRY-RUN-PROVEN → PRODUCTION-VERIFIED → PHASE-CERTIFIED.
- **G1 · Human PASS requires production correlation** *(sharpening 1)*. Any acceptance a
  person performs changes a status cell only after a named query/probe is run and its
  result recorded. Precedents proving the need: 07:08 stale-bundle post; 18:16 app
  post; the 06:18/06:43 "test worked" posts that were legacy-only.
- **G2 · Every item carries an actor** *(sharpening 2)*: **CLAUDE** (executable in
  session), **OWNER** (Play Console, Cloudflare dashboard, physical device, spend),
  **EXTERNAL** (third-party infrastructure/process). And a gate class: **HARD GATE** or
  **INFORMATIONAL**.
- **G3 · The monitoring slice runs from today** *(sharpening 3)*: a daily scheduled
  check of `delta_growing`, `new_unexplained_legacy_posts`, MEDIA-4009, MEDIA-4010, the
  app-channel legacy tail and canonical-post count. **Live since 2026-08-21**
  (`trig_01E5WtgQDsCHhphQZvDoaS9c`, 03:30 UTC daily, push-notified). This is monitoring
  only; full Phase 5 remains NOT STARTED. Known limitation: a headless run without the
  Supabase connector reports "could not run" rather than guessing.
- **G4 · Android acceptance is a fleet property** *(sharpening 4)*: the gate is **zero
  legacy-only posts from builds ≥ 1111**; the old-build tail is measured separately as
  a decay curve and is not a defect unless it grows after rollout.
- **G5 · The two one-way doors are recorded, not implied** *(sharpening 5)* — see
  Decision Log D-007/D-008: **both UNDECIDED**, with what each blocks.
- **G6 · Every new client capability ships with a server-side kill switch**
  *(sharpening 6)*, following the `cache_buster` precedent — installed builds are
  permanent, so remote disablement is the only rollback.
- **G7 · 3R-READ and 3R-WRITE are separate workstreams with separate approval**
  *(sharpening 7)*. 3R-WRITE requires backend idempotency that does not exist and is
  never assumed into read resilience.
- **G8 · Evidence format and location** *(sharpening 8)*: every gate report uses
  **Claim → Instrument → Result → Verdict → Regressions → Could-not-verify → Invariant
  lock → Abort condition**, appended to the project's `claude/` document set (the
  existing dated reports are the ledger; each phase certification freezes an evidence
  package there). Counts are never set equality; digests over sorted sets are.
- **G9 · Cost is a Phase-4 gate** *(sharpening 9)*: CDN egress per 1,000 feed views,
  storage growth/month, derivative and cache cost impact — measured, not asserted.
- **G10 · History stays correct** *(sharpening 10)*: RED-1, RED-2 and P3 were **Phase 2
  work (WS1/WS2, 2026-08-20)** — the prior draft's Phase-1 table mislabeled them; this
  revision corrects that. Physical-device evidence is defined as: screen recording or
  owner attestation **plus** the correlated production row **plus** build attribution
  (About-screen versionCode where capturable, structural attribution otherwise).
- **G11 · Privacy and authorization are hard gates.** No cache, CDN or performance
  mechanism may become an alternate authorization path. Percentages are planning
  indicators; only exit gates certify a phase. Any red baseline, unexplained failure or
  repository discrepancy stops certification until explained.

---

# PART III — PHASE 1 · ENGINE ROOM / SAFETY

**Status: OPEN — substantially progressed. No certified percentage model exists for
Phase 1 in evidence, and none is manufactured here; the itemized table is the status.**

| Item | Status | Actually implemented / tested | Production verification | Evidence | Remaining dependency | Actor | Gate |
|---|---|---|---|---|---|---|---|
| Emergency resumed-draft posting blocker | COMPLETE | Detached-rpc fix in `usePostDrafts.ts`; runtime + mutation tested | Live since the 2026-08-17 era builds | project docs of 2026-08-17; code comment "CALL IT, NEVER COPY IT" | — | CLAUDE | HARD (done) |
| Hashtag security gate | COMPLETE | RPC grants corrected; `post_hashtags` FK; regression tests | Applied as migration 20260817102540 | `BUILD_1106_PUBLISH_BLOCKER_AND_HASHTAG_GRANTS` doc | — | CLAUDE | HARD (done) |
| Android build pipeline | COMPLETE | Deterministic pinned pipeline; security+UI gates block build | Runs 106/110/111 produced signed artifacts | `android-build.yml` history | — | CLAUDE | HARD (done) |
| Duplicate migration versions | RESOLVED | Renamed with transport verification | Ledger 1:1 with repo (re-verified through 20260820181949) | ledger checks in WS closure docs | — | CLAUDE | HARD (done) |
| Unsafe dependency-install fallback | COMPLETE | `npm ci` deterministic path | CI runs | workflow files | — | CLAUDE | INFO |
| EXIF/GPS protection | PARTIAL | Canvas re-encode strips EXIF on the post path (audited); not phase-certified | Not independently re-verified this session | 2026-08-14/15 audits | Final certification pass incl. device check | CLAUDE + OWNER (device) | HARD |
| Migration-ledger historical baseline | DEFERRED | Reconciliation current→2026-08 proven; historical metadata baseline not executed | — | WS closure ledger sections | Execute under evidence rules | CLAUDE | HARD |
| 20260429071225 mirror-trigger finding | OPEN | Finding recorded; not resolved | — | Phase-1 carry-over list | Production-evidence resolution | CLAUDE | HARD |
| 20260504132638 anonymous judging grants | OPEN | Finding recorded; not resolved | — | Phase-1 carry-over list | Verify anon/authenticated write surface | CLAUDE | HARD |
| B3d-IMG-1 image delivery correction | OPEN | Design exists (`PLAN_B3d-IMG` doc) | — | project doc 2026-08-17 | Implement + device/network certification | CLAUDE + OWNER (device) | HARD |
| Strict TypeScript cleanup | PARTIAL | CI runs `tsc -p tsconfig.app.json`, currently green | CI green on `9160b75` | CI runs | Full strict sweep as scoped | CLAUDE | INFO→HARD at exit |
| Realtime / feed candidate-pool / pagination certification | OPEN | Implementations exist; certification ≠ implementation | — | architecture audits | Phase-1 certification pass (overlaps Phase 4 instruments) | CLAUDE | HARD |
| Physical-device Phase-1 journey | OPEN | — | — | — | Owner device session under G10 evidence definition | OWNER | HARD |
| ~~RED-1 / RED-2 / P3~~ | *moved* | **Recorded under Phase 2 (G10 correction)** | — | — | — | — | — |

**Phase-1 exit gate:** no unresolved RED item above; controls verified on production;
source/DB/CI/release reconciled; device evidence captured per G10; evidence package
frozen in the project.

# PART IV — PHASE 2 · MEDIA + UPLOAD ENGINE

**Status: OPEN — 97% measured (recalculated below under §1 of this revision's
directive). NOT DONE until D-002/D-003 closes.**

## 4.1 Android acceptance — VERIFIED TODAY (G1 applied)

The prior draft's "owner-side manual app test reported working" row was **falsified
first, then satisfied**, both with production evidence — exactly the G1 discipline:

- 06:18:51 and 06:43:51 UTC app-channel posts: **legacy-only** (0 refs, no idempotency
  key) → the reported test was NOT an acceptance; device was on an old build. FAIL
  recorded.
- **09:51:37 UTC — post `7eaf0ef8-ab5f-45ad-881d-1cc3f60d54a9`** (private) and
  **09:52:43 UTC — post `aa98cf72-553c-40ef-923e-d203f60bd42d`** (public), both
  platform=app, owner `cc691988-699f-4da5-9b2e-f2346c7303be`:

| Field | 09:51 post | 09:52 post |
|---|---|---|
| post_media rows | 1 (= slides) | 1 (= slides) |
| media_objects | `7aed0ffb…` | `69c62a42…` |
| owner matches post author | ✅ | ✅ |
| ord | 0, dense | 0, dense |
| state / verified | ready / ✅ | ready / ✅ |
| dims / bytes / MIME | 1922×2560 / 551,892 / webp | 2048×1365 / 155,160 / webp |
| sha256 | `a2f31104…adf1d7f4` | `3975df53…b49b3d8b00` |
| idempotency_key (unique per owner) | `b0d9bbb1` (1 post) | `bbbef949` (1 post) |
| image_urls = derived delivery URL | ✅ | ✅ |
| thumbnail = `-thumb` sibling | ✅ | ✅ |
| legacy-only | **NO** | **NO** |

**Build attribution (G10):** posts do not record versionCode; attribution is
structural and strong — the app bundles its dist with no remote URL, and the only app
artifact ever built containing `post_publish_with_media` is **build 1111 / v1.2.16**
(cut 2026-08-21 01:56 UTC). An app-channel post bearing an idempotency key is not
producible by any earlier build. An About-screen capture from the owner would upgrade
this to direct evidence and is requested, not required.

**Acceptance condition: MET.** Fleet gate (G4): the tail of old builds produced 3
legacy-only posts in the current 24h window (18:16, 06:18, 06:43) — measured as tail,
monitored daily, expected to decay as the Play rollout reaches members.

## 4.2 Phase-2 percentage — recalculated, not rounded

Model (unchanged from the WS closure series): decisions/backlog/class-F closed = 96%
with the app channel (−1) and D-002/D-003 (−3) open.

| Component | State | Points |
|---|---|---|
| Completed: write path (web, proven live + 3 real member posts today), WS1 audit, RED-1/RED-2/P3, migration + fences, class-F repoint, D-006 exclusions, delta attribution, **Android channel acceptance (today)** | COMPLETE | **97** |
| Blocked external: D-002/D-003 (Worker, R2 binding, secret, route, DNS, disable public R2, negative test) | BLOCKED / EXTERNAL + OWNER | **3** |
| Owner-dependent (not counted as %): Play rollout of 1111 to the fleet; About-screen capture; deletion of the WS2 test post | OWNER | 0 |
| Optional/decision: `media_write_path_delta` label update for D-006; classification of the 3 tail posts; migrating the 18:16 post's R2-resident photo | DEFERRED | 0 |

**Phase 2 = 97%.** It does not reach 100 until §4.3 passes. Documentation (this
revision) counts for nothing in this number.

## 4.3 D-002 / D-003 — the closing sequence (EXTERNAL until actually done)

Kept exactly as specified; no step skipped, nothing faked, nothing partially
implemented in advance:

1. Deploy the Cloudflare Worker fronting media. 2. Bind `MEDIA` → R2 bucket `50mm`.
3. Provision `MEDIA_TOKEN_KEY` both sides (verify presence, never print). 4. Worker
route/custom domain + DNS/proxy. 5. **Disable public R2 access.** 6. **The real
unauthenticated-byte negative test** against the CDN hostname AND the R2 public
endpoint. 7. Positive tests: owner → allowed; authorized friend → allowed only if the
product rule says so; stranger → denied; anonymous → denied; previously-known URL →
denied; **public media remains publicly fetchable**. 8. Cache-invalidation /
privacy-transition verification. 9. Record hashes + responses; only then CLOSED.

**Actor:** OWNER (Cloudflare dashboard access) + CLAUDE (test execution and evidence)
— the session's Cloudflare connector is read-only for Workers; deploy/bind/route/DNS
are not executable from here. Handover doc: `docs/D003_CLOUDFLARE_HANDOVER.md`.

**Phase-2 exit gate:** §4.3 negative+positive tests PASS · Android acceptance recorded
(done) · all prior invariants remain green (ownership, ordinals, hashes, readiness,
duplicates, exclusions pinned, ref_set_md5 reconciled) · no security gate RED.

# PART V — PHASE 3 · PRODUCT ENGINE + REAL DEVICE + OFFLINE RESILIENCE

**Status: NOT STARTED. Specification below is complete enough for an engineer who has
never seen this project. Nothing here is implemented by this revision.**

Phase 3 has four tracks. 3A/3B from the prior plan stand as written there (functional
integrity domains; Android lifecycle matrix). 3R is split per G7:

## 5.1 Phase 3R-READ — offline read resilience (MANDATORY)

**Objective:** previously loaded content stays useful with no network — like mature
social apps — without ever becoming an authorization bypass (G11; design assumes
D-002 CLOSED).

**Current reality it must fix (from the 2026-08-21 read-only audit, all at file:line):**
the only feed persistence is 10 posts in localStorage with a 30-minute TTL that
self-deletes on expiry read (`feedCache.ts`); it enters React Query only as
`placeholderData`, which vanishes when the offline fetch errors (`useFeedQuery.ts:451`,
`Feed.tsx:319`) — so offline cold-start blanks into "Couldn't load your feed" even
within the TTL; the image service worker is never registered in the app
(`main.tsx` treats the Capacitor origin `https://localhost` as a dev host) **and** its
URL matcher does not include `cdn.50mmretina.com` (`sw-image-cache.js:38-52`) so it
caches zero live images anywhere; R2 uploads set no `Cache-Control`
(`s3Upload.ts:147`); there is no network-state detection and no IndexedDB.
**Do not assume a service worker solves the Capacitor case** — the app may use a
directly-managed Cache Storage layer instead; the choice is a design-gate decision.

**Scope (all required):** feed data · post metadata · the profile/author state the feed
renders · image bytes (thumbnail-first) · pagination state · deterministic ordering
(depends on one-way door D-008) · cache invalidation · stale-while-revalidate · app
restart · airplane mode · zero-data · logout/login · account switch · privacy changes ·
deleted posts · changed posts · CDN failure · partial cache · corrupted cache · cache
version migration.

**Cache architecture (the specification):**

| Concern | Specification |
|---|---|
| Feed/post/profile metadata store | IndexedDB, last ~3 enriched pages per user; written on every successful fetch; read synchronously at startup for instant render |
| Image cache | Cache Storage (app-managed if SW is not viable in the WebView), host list MUST include `cdn.50mmretina.com`; thumbnails cached on display, originals only on deliberate view |
| Cache keys | namespaced `v{schema}:{user_id}:{surface}:{page-cursor}`; images keyed by full URL (immutable keys make URL = identity) |
| Cache version + migration | schema version stamp; on mismatch: migrate if trivial, else discard-and-rebuild (never crash) |
| TTL / staleness | staleness is a LABEL for display and a trigger for revalidation — never an automatic deletion (the 30-minute suicide clause is the anti-pattern) |
| Stale-while-revalidate | cached state renders immediately, always; refresh runs in background; server truth wins on success |
| Storage bound / eviction | metadata ≈ 5 MB; images 50–100 MB LRU; eviction never evicts the page currently on screen |
| Corruption | every read validated (parse + shape); corrupt record → discard + rebuild + one WARN code |
| Privacy / account binding | all user-bound stores purged on `SIGNED_OUT` and on user_id change; another account must never see prior data (test 13) |
| Invalidation | deleted/privacy-changed/edited posts reconciled out on every successful refresh; D-002-closed means cached bytes are the ONLY offline access and must be purged with the session |
| CDN headers | immutable post media gets `Cache-Control: public, max-age=31536000, immutable` (ties into door D-007); mutable avatar/cover gets short TTL — a separate, earlier, server-only change |
| Offline detection | ONE authoritative mechanism (Capacitor Network plugin), integrated with React Query to suppress request storms; retry/backoff bounded |
| Reconnect | cached UI stays interactive; background refresh; deterministic reconciliation; return to server truth |
| Kill switch (G6) | a `site_settings` flag (cache_buster pattern) that remotely disables the 3R cache and purges it on next launch |

## 5.2 Phase 3R-WRITE — offline interactions (SEPARATE APPROVAL, G7)

**Not assumed supported by the existing backend — it is not.** Likes, comments,
saves/bookmarks, follow/unfollow (each individually in/out by product decision)
require: **server-side idempotency keys for reactions and comments (new schema work)**,
client queue with stable keys and visible pending state, bounded retry, duplicate
prevention proven by production test, ordering and conflict resolution rules
(server-truth-wins; a comment on a deleted post fails permanently and honestly),
moderation interaction (queued comments pass the same moderation path on sync), and
queue observability (age, retry count, permanent-failure rate — feeds Phase 5).
Unsupported actions fail honestly offline; nothing pretends success.
**3R-WRITE begins only on its own explicit owner approval, after 3R-READ certifies.**

## 5.3 Phase 3 acceptance test matrix (20 tests; each needs expected behaviour +
recorded evidence + PASS/FAIL)

| # | Test | Expected (PASS condition) |
|---|---|---|
| 1 | Online cold start | server feed renders; cache written; no regression vs today |
| 2 | Online warm start | instant render from cache, silent background refresh |
| 3 | Airplane mode after browsing | cached posts + images remain; offline indicator; NO error-card replacement |
| 4 | Zero-data (connected, no throughput) | same as 3 + no request storm (backoff observed) |
| 5 | Force-kill offline → relaunch | cached feed renders from disk |
| 6 | Device restart offline | cached feed renders from disk |
| 7 | Partial cached feed | cached portion renders; honest "more when online" boundary |
| 8 | Cached images | previously displayed thumbnails render offline |
| 9 | Expired/stale cache | stale content SHOWN with stale label — never blanked |
| 10 | CDN unavailable (app online) | metadata renders; cached images render; placeholders elsewhere; no blank feed (design-review D2 satisfied) |
| 11 | Server unavailable | cached feed + offline/degraded indicator (D4 satisfied) |
| 12 | Logout → login same account | fresh fetch; cache rebuilt; no cross-session ghosts |
| 13 | Account switch | ZERO prior-account posts/images visible or recoverable |
| 14 | Privacy change while cached | reconciled out on next successful refresh |
| 15 | Post deletion | disappears after reconciliation |
| 16 | Post edit | updated content after reconciliation |
| 17 | Pagination offline | cached pages scrollable; clean end-of-cache |
| 18 | Reconnect | background refresh; new/changed/deleted reconciled; no flicker-blank |
| 19 | Cache corruption (injected) | discarded + rebuilt; no crash; WARN logged |
| 20 | Cache version migration | old-schema cache upgraded or cleanly discarded on new build |

3R-WRITE adds its own matrix (one pending like syncs once; duplicate retry does not
duplicate; comment on deleted post fails permanently; queue survives kill; moderation
applies) — approved separately.

**Phase-3 exit gate:** 3A journeys + 3B lifecycle matrix + 3R-READ tests 1–20 all PASS
on real devices with recorded evidence (G8/G10 format).

# PART VI — PHASE 4 · PERFORMANCE, SCALE, SECURITY & RECOVERY PROOF

**Status: NOT STARTED.** Independent measurement, not implementation. Covers:
production scalability (100k / 1M-post harness runs for feed candidate pool,
pagination, search, media access) · CDN architecture + media delivery + cache
hit/miss ratios · database query cost (buffers/page against stated budgets) · API
latency p50/p95/p99 by surface · concurrency and realtime health at simulated load ·
storage growth · **cost gates (G9): CDN egress per 1,000 feed views, storage
growth/month, derivative generation cost, cache cost impact** · upload
success/retry/recovery rates · Android crash/OOM visibility · backup/restore (a backup
is certified only by a successful restore drill) · full security regression corpus
(RPC privilege, ownership, media URL incl. D-002 re-verification, cache authorization,
privacy transitions) · data/storage invariant proof (owners, references, ordinals,
hashes, readiness, orphans, exclusions, migration state) · failure injection (DB
timeout, CDN down, R2 unreachable, auth expiry, realtime disconnect, slow network, app
kill) · regression testing of the full corpus · independent forensic audit.

**Exit gate:** every target has measured evidence against a pre-stated number; all
critical regressions pass; an independent reviewer signs the certification package.

# PART VII — PHASE 5 · PRODUCTION OPERATIONS & CONTINUOUS ASSURANCE

**Status: NOT STARTED — except the monitoring slice, LIVE since 2026-08-21 (G3).**

**Live now (the slice, monitoring only):** daily 03:30 UTC scheduled check —
`delta_growing`, `new_unexplained_legacy_posts`, MEDIA-4009/4010 (24h), app-channel
legacy tail, canonical-post count — with HEALTHY / TAIL-ONLY / ALERT verdicts and push
notification. Trigger id `trig_01E5WtgQDsCHhphQZvDoaS9c`.

**Full Phase 5 (later):** daily health checks across all surfaces · security
regression monitoring · orphan detection + media integrity sweeps (bounded automation)
· client-version adoption tracking (the fleet/tail metric, G4, permanent) ·
legacy-only monitoring · D-002 periodic re-verification (the negative test re-run on a
schedule) · cache health + offline reconciliation health (post-3R) · cost monitoring
(G9 baselines) · actionable alerts (feed/media/upload failure rates, queue growth,
auth anomalies, crash/OOM spikes, CDN/R2 failures) · audit trail · release gates
(web CI + Android gates + migration gate + rollback plan) · rollback procedures
rehearsed · incident runbooks (CDN outage, R2 outage, DB outage, auth outage, bad
release, media corruption) · periodic mutation/security re-runs · post-release device
smoke tests and web synthetic checks.

**Exit gate:** monitoring live, alerts actionable, rollback rehearsed, and a
regression is detectable without a member reporting it.

# PART VIII — DECISION LOG

| ID | Decision | State | Notes |
|---|---|---|---|
| D-004 | Dual-write legacy arrays for the installed fleet | ACTIVE | ends on 3 conditions incl. fleet migration |
| D-005 | Legacy insert = airbag, classified failures (4009/4010) | ACTIVE | pinned |
| D-006 | 27 Supabase thumbnails permanent legacy; 2 R2 covers not migrated | ACTIVE | pinned by WS3 refusal tests |
| Class-F repoint | 8 posts / 20 slides to 1920px originals | EXECUTED 2026-08-20, verified, rollback captured | migration 20260820180836 (+181949 RLS) |
| Android write path | Build 1111 / v1.2.16 carries the media path | BUILT + **ACCEPTED 2026-08-21 09:51 UTC** | fleet rollout = OWNER |
| 3R adoption | Read-side offline is mandatory Phase 3R-READ; 3R-WRITE separate | ADOPTED | this revision |
| **D-007 · Content-addressed storage** *(one-way door, G5)* | **UNDECIDED** | Options A (adopt before derivatives) / B (after) / C (keep timestamp keys). Cost of deferral grows with every upload. Blocks: derivative ladder home, exact orphan sweep, upload resume, aggressive CDN caching. An early server-only `Cache-Control` on existing immutable-in-practice objects is possible under any option and is 3R-relevant. |
| **D-008 · Deterministic ranking** *(one-way door, G5)* | **UNDECIDED** | Seeded-hash ordering replacing `random()`. Blocks: keyset pagination, feed cacheability — **3R-READ's page coherence depends on it**; 3R design cannot finalize its pagination cache until D-008 is decided. |
| Final DONE standard | All phase exit gates + independent certification; no percentage certifies anything | ACTIVE | |

# PART IX — ONE AUTHORITATIVE STATUS TABLE

| Phase | Workstream | Status | % | Actor | Evidence | Remaining blocker |
|---|---|---|---|---|---|---|
| 1 | Emergency blockers (draft posting, hashtags, build pipeline, ledger dupes, dep-install) | COMPLETE | — | CLAUDE | project docs 08-16/17 | — |
| 1 | EXIF/GPS certification | PARTIAL | — | CLAUDE+OWNER | 08-14 audits | device certification |
| 1 | Historical ledger baseline | DEFERRED | — | CLAUDE | WS ledger checks | scheduled execution |
| 1 | Mirror-trigger 20260429071225 | NOT STARTED | — | CLAUDE | carry-over list | production evidence |
| 1 | Anonymous judging grants 20260504132638 | NOT STARTED | — | CLAUDE | carry-over list | grant verification |
| 1 | B3d-IMG-1 image delivery | NOT STARTED | — | CLAUDE+OWNER | PLAN_B3d-IMG doc | build + device proof |
| 1 | Strict TS sweep | PARTIAL | — | CLAUDE | CI green | scoped sweep |
| 1 | Realtime/feed/pagination certification | NOT STARTED | — | CLAUDE | audits | instruments (Phase-4 overlap) |
| 1 | Device journey + evidence package | NOT STARTED | — | OWNER+CLAUDE | — | device session |
| 2 | Media engine, migration, fences, WS1–WS4, decisions | COMPLETE | 97 total | CLAUDE | WS closure docs 08-19/20/21 | — |
| 2 | Android channel acceptance | **COMPLETE 2026-08-21** | (in 97) | OWNER+CLAUDE | §4.1 of this plan (posts 7eaf0ef8 / aa98cf72) | About-screen capture (optional upgrade) |
| 2 | Fleet rollout of 1111 | OWNER ACTION | (tail metric) | OWNER | Play draft from run 111 | Play rollout |
| 2 | D-002/D-003 authorized delivery | BLOCKED | 3 remaining | EXTERNAL+OWNER (+CLAUDE tests) | D003 handover doc | Cloudflare access, 9-step sequence |
| 3 | 3A product journeys | NOT STARTED | 0 | CLAUDE+OWNER | spec Part V | Phase-2 close + design gate |
| 3 | 3B Android lifecycle | NOT STARTED | 0 | CLAUDE+OWNER | spec Part V | devices |
| 3 | 3R-READ offline resilience | NOT STARTED (spec COMPLETE) | 0 | CLAUDE (+D-007/D-008 decisions: OWNER) | audit 08-21 + Part V spec | approval to start; doors decided |
| 3 | 3R-WRITE offline interactions | NOT STARTED | 0 | OWNER decision first | Part V §5.2 | separate approval; backend idempotency |
| 4 | Proof & certification | NOT STARTED | 0 | CLAUDE + independent reviewer | Part VI | Phase 3 certified |
| 5 | Monitoring slice | **LIVE** | — | CLAUDE | trigger id above | connector availability in headless runs |
| 5 | Full operations layer | NOT STARTED | 0 | CLAUDE+OWNER | Part VII | Phase 4 |
| — | GitHub billing (Actions = every gate) | OWNER ACTION | — | OWNER | banner: pay by 2026-08-31 | payment |
| — | WS2 private test post cleanup | OWNER ACTION | — | OWNER | post 98b2d052 | delete when convenient |

# PART X — OWNER ACTIONS · EXTERNAL DEPENDENCIES · NEXT COMMAND

**Owner actions, in order:** 1. Roll out build 1111 (Play draft from actions run
32438058103) so the fleet tail decays. 2. Settle GitHub billing before 2026-08-31.
3. Grant/perform the Cloudflare steps of §4.3 (or give Claude write access to execute
them under supervision). 4. Decide D-007 and D-008 before approving 3R-READ design.
5. Optional: About-screen capture; delete the WS2 test post.

**External dependencies:** Cloudflare Worker/R2 configuration surface; Play review
pipeline; member update behaviour (the tail).

**The exact next command to begin the next approved workstream:**

> **"PHASE 2 — CLOSE D-002/D-003."** Preconditions: owner completes/authorizes the
> Cloudflare steps (§4.3 items 1–5). Claude then executes items 6–9 (the real
> unauthenticated-byte negative test against both endpoints, the positive matrix, the
> transition tests, and the evidence record) and, on PASS, recalculates Phase 2 —
> which reaches 100% on that evidence and no other way.

*(If the owner prefers parallel progress while Cloudflare access is arranged:
"PHASE 1 — CERTIFICATION SWEEP" is the alternative next command; it requires no
external dependency.)*

**STOP. This revision changes documentation and status only. No Phase 3 work, no
production change beyond the read-only verification queries and the approved
monitoring task, no automatic execution of the next command.**
