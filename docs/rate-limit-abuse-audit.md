# Rate-Limit and Abuse Audit (Phase C, checklist item: per-endpoint review)

**Question:** if one person decides to be a nuisance, what stops them — and where does it cost us money?

**Answer:** the database stops them on 11 write paths, properly. Everywhere else the answer is "nothing", and on the two most expensive paths the limit that *does* exist is written as a check-then-act and can be walked past with concurrency.

Measured 2026-08-15 against production `jtdtehuqtinjxropkkcn` and the repository at `570db0e`. Every claim below names how it was established. Nothing was changed by this audit; it is read-only.

---

## The shape of the problem: three tiers, and only one is a real limit

**Tier 1 — Postgres triggers. Durable.** 11 of them, all `tgenabled = 'O'` (enabled). They run inside the transaction, on every connection, from every isolate, so the count is the truth. These are genuine.

**Tier 2 — in-memory `Map` in an edge function. Advisory only.** 3 functions. The counter lives in module scope inside one Deno isolate. Supabase Edge Runtime runs many isolates and recycles them freely, so the counter resets on every cold start and is never shared between concurrent isolates. The effective ceiling is *limit × number of live isolates*, which nobody knows and nothing bounds. `s3-signed-url` says so in its own header ("per edge instance"); the other two do not.

**Tier 3 — nothing at all.** 65 of the 68 deployed functions.

---

## Tier 1: what the database actually enforces

Read from `pg_proc` / `pg_trigger` on 2026-08-15. Thresholds are quoted from the live function bodies, not from migrations.

| Table | Trigger | Limit |
|---|---|---|
| `posts` | `trg_rate_limit_posts` | 30 / hour per user |
| `comments` | `trg_rate_limit_comments` | 100 / hour per user |
| `post_comments` | `trg_rate_limit_post_comments` | 100 / hour per user |
| `image_comments` | `trg_rate_limit_image_comments` | 100 / hour per user |
| `post_reactions` | `trg_rate_limit_post_reactions` | 20 / minute, 200 / hour, and 3 s between reactions on the *same* post |
| `competition_votes` | `trg_rate_limit_votes` | 10 / minute and 50 / hour |
| `competition_entries` | `trg_rate_limit_competition_entry` | 500 / hour |
| `competition_entries` | `trg_throttle_competition_entry_inserts` | 5 / 60 s per competition |
| `competition_entries` | `trg_enforce_photo_limit` | per-competition max photos |
| `judge_scores` | `trg_rate_limit_judge_scores` | 20 / minute |
| `feed_events` | `trg_rate_limit_feed_events` | 500 / hour |
| `newsletter_subscribers` | `trg_rate_limit_newsletter` | 10 / hour per email domain |
| `friendships` | `enforce_friend_limit` | 10 000 friends |

This is a better position than it first looks: the *social* surface — posting, commenting, reacting, voting, judging — is covered where it matters, at the row, by rules a client cannot skip.

---

## R1 — `ask-anything`: the daily AI quota is a lost update, and the write is fire-and-forget

This is the most expensive endpoint on the platform (`google/gemini-2.5-pro`, streaming) and it is reachable **anonymously** (`verify_jwt = false` live, confirmed via the management API).

It does have a quota, and the quota's *design* is good: 15/day anonymous, 25/day registered, and for anonymous callers the key is `sha256(client IP | UTC date)` derived on the server, precisely so that rotating a client-supplied `device_id` cannot reset it.

The implementation undoes it. In `supabase/functions/ask-anything/index.ts`:

- line 261 reads `currentCount` from `ai_chat_usage`;
- line 327 writes `question_count: currentCount + 1`.

Nothing sits between them — no advisory lock, no `question_count = question_count + 1` in SQL, no unique-constraint retry. Two requests that read before either writes both compute the same successor, so **N concurrent requests advance the counter by 1** and get N answers. The daily cap is not a cap; it is a cap on *serial* usage.

Worse, the write is deliberately fire-and-forget — `.then(() => {})`, never awaited. On an edge isolate the response returns and the isolate may be recycled with that promise still pending, so under exactly the load where the counter matters it is least likely to persist at all.

**Blast radius today, measured:** `ai_chat_usage` holds 24 rows, *all* anonymous (`user_id IS NULL` on all 24), highest `question_count` is 11, nobody has ever reached either limit, and the most recent row is `session_date = 2026-07-23` — three weeks ago. There are also zero duplicate `(device_id, session_date)` anon groups. So the hole is real and has never been exercised. Found before it cost anything, not after.

**Note for whoever fixes it:** the unique index is `(user_id, device_id, session_date)`. For anonymous rows `user_id` is NULL, and Postgres treats NULLs as distinct in a btree unique index, so that index constrains nothing on the anonymous path — the fix cannot lean on it as written.

---

## R2 — `ad-reward-credit`: the cap and cooldown on **money** are check-then-act

The function's own header states:

> "Even a replayed token can never exceed the daily cap / cooldown, so the maximum payout is bounded regardless of client behaviour."

That is not true under concurrency. The claim path does three things in order, with no lock and no unique constraint between them:

1. count today's `wallet_transactions` rows with `reference_type = 'ad_reward'` → compare to `rewarded_max_per_day`;
2. read the newest such row → compare to `rewarded_cooldown_minutes`;
3. call `admin_wallet_credit`.

N simultaneous claims with the same valid token all observe the pre-write state, all pass both gates, and all credit. Both stated guarantees are bypassed by parallelism alone — no token forgery required.

**Blast radius today, measured: zero, and precisely zero.** `site_settings` has **no** `ad_frequency_v2` row at all, so `cfg` is `{}`, so `rewarded_credit_amount` falls back to `0`, and both `start` and `claim` return `reward_not_configured` before doing anything. `wallet_transactions` contains **0** rows with `reference_type = 'ad_reward'` out of 154 total.

**Why it is still ranked second:** the thing standing between this and a real payout leak is one absent settings row. The moment the owner configures rewarded ads in admin settings, the code above starts paying, with its written bound false. This should be fixed *before* that setting is ever turned on, not after.

The correct shape already exists in this codebase twice: `pg_advisory_xact_lock` before the read (as in `detect_duplicate_post`), or an idempotency key with a partial unique index (as in `post_publish_with_media`). The payment functions do it properly — `paypal-capture-order` and `razorpay-verify-payment` both carry `idempotency_key` and re-check immediately before insert.

---

## R3 — Four paid-AI endpoints with no per-caller limit of any kind

| Function | Who can call it | Upstream cost | Limit |
|---|---|---|---|
| `analyze-gallery-image` | any signed-in member | AI gateway (vision) | none |
| `translate-text` | any signed-in member | AI gateway | none |
| `detect-ai-image` | any signed-in member | AI gateway (vision) | none |
| `moderate-comment` | the comment's **owner**, or an admin | AI gateway (`gemini-2.5-flash-lite`) | none |

`moderate-comment` deserves the footnote: it *is* correctly authorised — caller must own the comment or hold `admin`/`super_admin`. But a member may re-submit their own comment endlessly, and each call that survives the blocklist and rule layers reaches the AI. Authorisation is not a rate limit.

`ask-anything` and `detect-ai-image` both contain a `429` branch, which a pattern scan reads as "rate limited". They are not. Both only **relay** a 429 received *from the upstream gateway*. That distinction is the finding, not a quibble:

> the gateway throttles **our account key**, not the abusive caller. So the failure mode is not "the nuisance gets slowed down" — it is "the nuisance exhausts the key and the chatbot stops working for all 94 members."

---

## R4 — Two endpoints are open to the anonymous internet, unbounded, holding the service key

After resolving `_shared` imports (see R7), exactly two deployed functions have `verify_jwt = false` **and** no caller check of any kind:

- `sitemap` (217 lines)
- `seo-route-metadata` (449 lines)

Both are **read-only and public by design** — a sitemap that requires a login is not a sitemap — and `scripts/security-audit.mjs` already grades this shape deliberately rather than crying wolf. They are listed here for completeness, not as defects: the residual risk is not disclosure but volume, since each anonymous request runs privileged queries with no ceiling.

`dashboard-init` is also anonymous-capable (it keys its cache on `__anon__`) and does substantially more work — 626 lines, many parallel reads. It has a 60-second in-memory cache keyed on version counters, which blunts repetition but is, again, per isolate.

---

## R5 — `submit-deposit` floods the admin inbox

Each call issues `create_pending_deposit` with `_idempotency_key: null` (line 76) and then inserts a row into `admin_notifications` (line 81). Signed-in, no limit, no idempotency. A member can generate arbitrarily many pending deposits and, with them, arbitrarily many admin notifications. This is nuisance rather than loss — no money moves — but it degrades the one surface the owner uses to see real deposits.

---

## R6 — A security check that is sound only because of a setting stored outside this repository

`send-transactional-email` decides whether the caller is the service role by base64-decoding the JWT **payload** and reading `payload.role` — it never verifies the signature. That is safe today only because the Supabase gateway is configured with `verify_jwt = true` for this function, so an unsigned token never reaches the code.

To its credit the function already says exactly this in a comment, and explains why the check exists at all (the anon key is a signed JWT shipped in every browser bundle, so signature validity alone proves nothing). It is recorded here because the safety depends on a value that lives in the Supabase dashboard — the same class as trap #1, the Cloudflare zone — and 25 other functions in this project already have `verify_jwt = false`. One toggle turns a documented defence into a forgeable string comparison, and nothing in this repository would notice.

The gate shipped alongside this audit (`src/__tests__/rateLimitCoverage.test.ts`) plants the in-repo tripwire: `supabase/config.toml` must keep declaring `verify_jwt = true` for that function.

---

## R7 — Recorded against myself: pattern scanning mislabelled six endpoints

The first pass of this census flagged `submit-judge-score`, `submit-judge-comment`, `submit-judge-tag`, `submit-judge-decision`, `judge-session-resume` and `brevo-webhook` as having no caller verification. All six are correctly authenticated:

- the five judging functions call `authenticateJudge()` from `_shared/judgingAuth.ts`, which validates the JWT **and** requires `admin` or `judge` in `user_roles`;
- `brevo-webhook` authenticates on `BREVO_WEBHOOK_TOKEN` and **fails closed** when the secret is unset.

The scanner missed them because the auth lives one import away, and because the secret's name did not match the pattern list. The census was regenerated with `_shared` imports resolved before anything in this document was written. Recorded because a security census that is wrong in the *reassuring* direction is worse than none — and this one was wrong in the alarming direction first, which is only luck.

---

## Full census

68 deployed + 2 built-not-deployed. `Auth` is the strongest gate present in code (after resolving `_shared`). `Limit` is Tier 1 / Tier 2 / none.

| Function | `verify_jwt` (live) | Auth in code | Paid upstream | Limit |
|---|---|---|---|---|
| ad-reward-credit | false | JWT + HMAC token | — | none (see R2) |
| admin-export-db | true | JWT + admin | Google | none |
| admin-process-withdrawal | true | JWT + admin | — | none |
| admin-secure-settings | true | JWT + admin | — | none |
| analyze-gallery-image | true | JWT | **AI** | **none (R3)** |
| apply-scheduled-boosts | true | cron secret | — | none |
| ask-anything | **false** | JWT optional (anon allowed) | **AI** | **broken (R1)** |
| auth-email-hook | false | hook secret | — | none |
| autoscale-ad-traffic | true | cron secret | — | none |
| backfill-image-dims | true | JWT + admin | — | none |
| backfill-image-hashes | true | JWT + admin | — | none |
| backfill-media-objects | *not deployed* | JWT + admin | — | none |
| backfill-thumbnails | true | JWT + admin | — | none |
| backup-reminder | true | cron secret | — | none |
| brevo-webhook | false | webhook token, fails closed | — | none |
| cast-photo-vote | false | JWT | — | **Tier 1** (votes trigger) |
| complete-round | false | JWT + admin | — | none |
| create-payment-session | false | JWT | Stripe/Razorpay/PayPal | none (R5-adjacent) |
| dashboard-init | false | JWT optional (anon allowed) | — | 60 s cache, per isolate |
| delete-my-account | true | JWT | — | none |
| delete-user | true | JWT + admin | — | none |
| detect-ai-image | false | JWT (in code) | **AI** | **none (R3)** |
| detect-orphan-files | true | JWT + admin | — | none |
| diagnose-brevo-key | true | JWT + admin | Brevo | none |
| entry-final-votes | true | JWT | — | none |
| evaluate-round2 | true | — (returns 410 Gone) | — | n/a |
| expire-gift-credits | true | cron secret | — | none |
| fix-cache-headers | true | JWT + admin | — | none |
| ga-report | false | JWT + admin | Google | none |
| get-payment-gateways-public | false | JWT | — | none |
| get-wallet-summary | true | JWT | — | none |
| get-wallet-transactions | true | JWT | — | none |
| handle-email-suppression | false | shared secret | — | none |
| handle-email-unsubscribe | false | 256-bit capability token | — | none |
| hard-delete-competition | true | JWT + admin | — | none |
| judge-session-resume | false | JWT + judge/admin role | — | none |
| judging-invariants-nightly | true | cron secret | — | none |
| manage-notifications | true | JWT + admin | — | none |
| media-verify-upload | *not deployed* | JWT + ownership | — | Tier 2 (30/min) |
| migrate-storage | false | JWT + admin | — | none |
| moderate-comment | true | JWT + owner-or-admin | **AI** | **none (R3)** |
| paypal-capture-order | true | JWT + ownership + idempotency | PayPal | none |
| preview-transactional-email | false | `LOVABLE_API_KEY` compare | — | none |
| process-email-queue | true | — (queue worker) | Brevo | queue cooldown |
| publish-round | true | JWT + admin | — | none |
| publish-scheduled-posts | true | cron secret | — | Tier 1 re-check (30/h) |
| purge-s3-orphans | true | JWT + admin | — | none |
| rank-feed | false | JWT (in code) | — | none |
| razorpay-verify-payment | true | JWT + ownership + idempotency | Razorpay | none |
| s3-delete | false | JWT + admin | — | none |
| s3-presign-upload | false | JWT (in code) | — | Tier 2 (60 / 5 min) |
| s3-signed-url | true | JWT + bucket allow-list | — | Tier 2 (30 / 5 min) |
| s3-upload | false | JWT + admin | — | none |
| send-broadcast-push | false | JWT + admin (no secret path, deliberately) | FCM | none |
| send-gift-credit | true | JWT + admin | — | none |
| send-push | false | JWT + admin **or** internal secret | FCM | none |
| send-reengagement-emails | true | cron secret | — | none |
| send-transactional-email | true | unsigned role decode (**R6**) | Brevo | none |
| seo-crawler-verify | true | JWT + admin | — | none |
| seo-route-metadata | **false** | **none** | — | none (R4) |
| sitemap | **false** | **none** | — | none (R4) |
| submit-deposit | true | JWT | — | **none (R5)** |
| submit-judge-comment | true | JWT + judge/admin role | — | none |
| submit-judge-decision | true | JWT + judge/admin role | — | none |
| submit-judge-score | false | JWT + judge/admin role | — | **Tier 1** (20/min) |
| submit-judge-tag | true | JWT + judge/admin role | — | none |
| test-smtp | true | JWT + admin | SMTP | none |
| translate-text | true | JWT | **AI** | **none (R3)** |
| verify-email-provider | true | JWT + admin | provider API | none |
| verify-image-hash | true | JWT + admin | — | none |

---

## Recommendation

Ordered by what it costs to be wrong, not by effort.

1. **`ad-reward-credit` before rewarded ads are ever switched on.** Take `pg_advisory_xact_lock(user_id)` around the cap/cooldown read and the credit, or give the credit an idempotency key on the reward token. Until then the stated guarantee in that file's header should be corrected, because it is currently a written promise that concurrency breaks.
2. **`ask-anything`'s quota.** Replace the read-modify-write with a single atomic statement (`INSERT … ON CONFLICT DO UPDATE SET question_count = ai_chat_usage.question_count + 1 RETURNING question_count`) and **await** it *before* calling the AI, not after. Note the NULL-`user_id` caveat above — the anonymous path needs a conflict target that actually applies to it.
3. **A durable, shared per-caller limit for the four unlimited AI endpoints.** The pattern already exists in this repo: `ask-anything`'s `ai_chat_usage` table, once R1's race is closed. Reuse it rather than inventing a second mechanism.
4. **Stop describing the in-memory limiters as limits.** Either move them to the same DB-backed counter, or say "per isolate" in each header the way `s3-signed-url` already does. A limit nobody can rely on is worse than a documented absence.
5. **`submit-deposit`:** one pending deposit per user at a time, or an idempotency key. Cheap.
6. **Structural, so this cannot recur:** the gate shipped with this audit. A new function that reaches a paid upstream fails the suite unless it is either durably limited or explicitly named with a reason. This is the same shape as `newTableGrants` and `deletionCoverage`: the dangerous default becomes the one you have to type out.

**Nothing was changed by this audit.** Catalogue queries, three counting queries, and reads of 70 function sources.
