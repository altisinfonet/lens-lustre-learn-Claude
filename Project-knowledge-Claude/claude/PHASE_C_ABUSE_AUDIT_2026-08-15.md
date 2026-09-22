# Phase C — Rate-Limit & Abuse Audit (2026-08-15)

**Commits:** `711eff5` audit doc · `5aa8900` gate (6 mutations) · `c2fa41f` evidence · `318240f` control reconcile.
All four verified byte-identical on origin. Suite **1,588 passed | 1 skipped**. security-audit **PASS** (0 CRITICAL / 0 HIGH).

## Scope
All 68 deployed edge functions + 2 built-not-deployed, plus every Postgres rate-limit trigger.
Read-only: catalogue queries, 3 counting queries, live `list_edge_functions`, 70 sources with `_shared` resolved.

## Central finding — three tiers, one is real
- **Tier 1 — 11 Postgres triggers.** Durable, in-transaction, enforced from every isolate. Genuine.
  posts 30/h · comments 100/h (×3 tables) · reactions 20/min + 200/h + 3s same-post · votes 10/min + 50/h ·
  entries 500/h + 5 per 60s · judge scores 20/min · feed events 500/h · newsletter 10/h per domain · friends 10 000.
- **Tier 2 — 3 edge functions with a module-scope `Map`.** Per isolate, resets on cold start, never shared.
  Effective ceiling is *limit × live isolates*, which nothing bounds. Advisory, not a limit.
- **Tier 3 — nothing.** 65 of 68 deployed functions.

## Findings (ranked)
| | Finding | Blast radius today |
|---|---|---|
| **R1** | `ask-anything`: daily AI quota is a read-modify-write **lost update**, and the increment is fire-and-forget (never awaited). N concurrent requests advance the counter by 1. Anonymously reachable. | 24 rows, all anon, max 11 questions, **nobody ever hit a limit**, last use 2026-07-23 |
| **R2** | `ad-reward-credit`: daily cap + cooldown on **money** are check-then-act. The file's header claims payout is "bounded regardless of client behaviour" — false under concurrency. | **exactly zero** — `ad_frequency_v2` is unset so amount = 0; 0 `ad_reward` transactions out of 154 |
| **R3** | Four paid-AI endpoints with **no** per-caller limit: `analyze-gallery-image`, `translate-text`, `detect-ai-image`, `moderate-comment`. The 429 branches only relay the gateway's throttle — which hits *our account key*, so one abuser denies AI to all 94 members. | none exercised |
| **R4** | Exactly two anon-reachable functions with no caller check: `sitemap`, `seo-route-metadata` — read-only, public by design. Risk is volume, not disclosure. | benign |
| **R5** | `submit-deposit` passes `_idempotency_key: null` and inserts an `admin_notifications` row per call, unlimited → admin-inbox flood. | nuisance |
| **R6** | `send-transactional-email` decides "is this service-role?" by base64-decoding the JWT **without verifying the signature** — sound only because `verify_jwt = true` lives in the Supabase dashboard, outside the repo. Same class as trap #1. | safe today; one toggle from forgeable |

## Shipped
`docs/rate-limit-abuse-audit.md` — full 70-row census + recommendation.
`src/__tests__/rateLimitCoverage.test.ts` — 5 assertions. A function reaching a metered third party must consume a **database-owned** counter or be named in `COST_UPSTREAM_LEDGER` with a >20-char reason. An in-memory Map explicitly does **not** count. Plus ledger-staleness, vacuity guard, audit-doc existence, and a `config.toml` `verify_jwt` tripwire for R6.

**6 mutations:** new paid fn unlisted CAUGHT · with durable quota RPC PASSES (positive control) · with only a Map CAUGHT · `verify_jwt` flipped CAUGHT · audit doc deleted CAUGHT · scanner neutered CAUGHT (twice over).

## Self-caught, recorded in AI_EVIDENCE.md
1. My own ledger failed my own rule — four reasons read "admin JWT only" (15 chars) and were rejected. The rule was right: that names *who* can call, not what bounds the *count*.
2. The census was wrong in the alarming direction — six correctly-protected endpoints flagged as unauthenticated because their auth lives in `_shared/judgingAuth.ts` and `BREVO_WEBHOOK_TOKEN` didn't match my pattern. Regenerated with `_shared` inlined **before** writing the audit.
3. A mutation that *adds* to a regex alternation is not a scanner-break — it changed nothing and read as an escape. Second occurrence of this class. Lesson is narrower than "verify it applied": verify it is **destructive**.

## Owner decisions still open (unchanged)
Deploy `backfill-media-objects` + `media-verify-upload` · app build (all client work unshipped) · account-deletion categories · media-URL row 9 (its own GO cycle) · two stale duplicate migration files on GitHub · Razorpay sandbox creds (W1) · bug list (Phase F).

**New, and cheap:** fix R2 **before** rewarded ads are ever switched on.
