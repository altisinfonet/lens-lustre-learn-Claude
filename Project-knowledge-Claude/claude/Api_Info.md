# Api_Info.md — 50mm Retina World: complete API surface

> Generated 2026-08-25 from the **live production database** (`jtdtehuqtinjxropkkcn`) and from
> `main` at commit `b671e1fb0c5bcf145d442076c229eca888afd674`, tree `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1`.
> Nothing here is copied from memory or from an older document. Every signature, grant,
> `verify_jwt` value and call site was read from the source at generation time.
>
> **Integrity:** the production RPC table below was transcribed once and then verified by asking
> the database to hash the same 109 rows. Both sides returned `0ad6bb13f4ff0e75e7e761093abf6d33`.
> If you regenerate this file, redo that check — a silently truncated table is worse than none.

---

## 0. At a glance

| Surface | Count |
|---|---|
| Database RPCs the application calls | **105** |
| RPC call sites in `src/` | **122** |
| Overloads of those RPCs on production | **109** |
| Edge functions in the repository | **73** |
| Edge functions deployed on production | **71** |
| Edge functions the app invokes directly | **40** |
| Edge functions bundling `_shared/secureHeaders.ts` | **27** |

Two transports reach the backend, and they authenticate differently:

| | Database RPC | Edge function |
|---|---|---|
| Called by | `supabase.rpc("name", { ...args })` | `supabase.functions.invoke("name", { body })` |
| URL | `POST /rest/v1/rpc/<name>` | `POST /functions/v1/<name>` |
| Resolved by | **argument NAMES in the JSON body** | slug in the path |
| Auth gate | Postgres `EXECUTE` grant, then the function's own `has_role()` check, then RLS | gateway `verify_jwt`, then the function's own check |
| Deploys with the app? | **No** — migrations are applied separately | **No** — edge functions never auto-deploy from GitHub |

> ⚠ Because an RPC is resolved by **argument names**, a function with the right name and
> different parameter names is a runtime 404 that passes any name-only check. This is why
> `scripts/verify-schema-dependencies.mjs` compares argument names, not names.

---

## 1. Request headers

### 1.1 What the client sends

```http
POST /rest/v1/rpc/<function_name>            HTTP/1.1
Host: jtdtehuqtinjxropkkcn.supabase.co
apikey: <publishable key>                    # public-safe, ships in the bundle
Authorization: Bearer <user JWT>             # the signed-in member's access token
Content-Type: application/json
x-client-info: supabase-js/<version>

{ "_arg_one": "…", "_arg_two": 12 }
```

For an edge function the path becomes `/functions/v1/<slug>` and the body is free-form JSON.
The `Authorization` header is attached by the client library, **not** automatically by the
browser — which bounds the impact of §1.3 below.

### 1.2 What the server returns

`supabase/functions/_shared/secureHeaders.ts` is the single place headers are defined, and
**27 of 73 functions import it.** On `main` today it returns:

```
Access-Control-Allow-Origin       <computed, see 1.3>
Access-Control-Allow-Headers      authorization, x-client-info, apikey, content-type,
                                  x-supabase-client-platform,
                                  x-supabase-client-platform-version,
                                  x-supabase-client-runtime,
                                  x-supabase-client-runtime-version
Access-Control-Allow-Methods      POST, OPTIONS
Content-Type                      application/json
X-Content-Type-Options            nosniff
X-Frame-Options                   DENY
X-XSS-Protection                  1; mode=block
Referrer-Policy                   strict-origin-when-cross-origin
Cache-Control                     no-store, no-cache, must-revalidate
Strict-Transport-Security         max-age=31536000; includeSubDomains
X-Permitted-Cross-Domain-Policies none
```

`Access-Control-Allow-Credentials` is **not** sent. That matters — see below.

### 1.3 ⚠ OPEN DEFECT — the origin check on production is a prefix match

`main`'s version decides the allowed origin with:

```ts
if (ALLOWED_ORIGINS.some((o) => requestOrigin.startsWith(o))) origin = requestOrigin;
else if (requestOrigin.endsWith(".lovable.app")) origin = requestOrigin;
else origin = "*";
```

`startsWith` accepts any origin that merely *begins with* an allowed one. **Measured live
against production on 2026-08-25**, two functions, real preflights:

```
Origin: https://www.50mmretina.com            -> ACAO: https://www.50mmretina.com
Origin: https://50mmretina.com.evil.example   -> ACAO: https://50mmretina.com.evil.example   <-- echoed
Origin: https://evil.example                  -> ACAO: *
```

**Honest severity: LOW-to-MODERATE, not critical.** `Access-Control-Allow-Credentials` is
absent and the member's JWT travels in an `Authorization` header the application sets itself,
so an attacker page cannot make a victim's browser attach the victim's token. What it does
allow is an attacker origin reading responses from **unauthenticated** endpoints as though
same-origin. It is still a control that does not do what it claims.

**The fix already exists on `staging` and has never been promoted.** That version replaces the
prefix match with exact comparison, drops the `*` fallback for a disallowed origin (the header
is simply absent), adds `Vary: Origin`, and adds the two Capacitor origins the Android app
needs (`https://localhost`, `capacitor://localhost`).

```
main    supabase/functions/_shared/secureHeaders.ts  blob 0fcaef13e38748d73bf49b1704613011cd398b72
staging supabase/functions/_shared/secureHeaders.ts  blob 6d805c66eb2813a1c565867bb8e1f59ebc279402
```

Promoting the file is **not** enough: edge functions do not auto-deploy. All 27 functions that
bundle it must be redeployed afterwards.

---

## 2. Edge functions

### 2.1 ⚠ Six functions are deployed PUBLIC but not declared in `config.toml`

`config.toml` defaults `verify_jwt` to **true**. These six are live on production with
`verify_jwt = false` — the gateway does **not** require a token — yet the repository does not
say so. A redeploy driven from the repo would flip them to token-required and break them:

- `ad-reward-credit` — deployed `verify_jwt=false`, version 6, absent from `config.toml`
- `brevo-webhook` — deployed `verify_jwt=false`, version 13, absent from `config.toml`
- `complete-round` — deployed `verify_jwt=false`, version 27, absent from `config.toml`
- `ga-report` — deployed `verify_jwt=false`, version 8, absent from `config.toml`
- `send-broadcast-push` — deployed `verify_jwt=false`, version 6, absent from `config.toml`
- `send-push` — deployed `verify_jwt=false`, version 11, absent from `config.toml`

Each of these must either be added to `config.toml` with an explicit `verify_jwt = false` and a
comment saying why, or be changed to require a token. Leaving the repository silent about a
live public endpoint is how the setting gets flipped by accident.

### 2.2 In the repository but never deployed

- `backfill-media-objects` — source exists on `main`, **no deployment on production**
- `media-verify-upload` — source exists on `main`, **no deployment on production**

### 2.3 Full edge-function table

`JWT` = gateway `verify_jwt` as **actually deployed**. `cfg` = what `config.toml` declares
(`—` means undeclared, which defaults to true). `hdrs` = imports `_shared/secureHeaders.ts`.

| Function | JWT (live) | cfg | ver | hdrs | Called from |
|---|---|---|---|---|---|
| `ad-reward-credit` ⚠ | public | — | 6 | no | `components/ads/RewardedAd.tsx:49`<br>`components/ads/RewardedAd.tsx:84` |
| `admin-export-db` | token | — | 24 | yes | `components/admin/DatabaseBackup.tsx:28` |
| `admin-process-withdrawal` | token | — | 22 | yes | `components/admin/AdminWalletTab.tsx:139` |
| `admin-secure-settings` | token | — | 23 | yes | `components/admin/AdminSettings.tsx:27`<br>`components/admin/AdminWalletTab.tsx:179`<br>`components/admin/AdminWalletTab.tsx:201`<br>+4 more |
| `analyze-gallery-image` | token | true | 24 | no | `components/admin/AdminBanners.tsx:198`<br>`components/admin/AdminBanners.tsx:345`<br>`components/admin/AdminGallery.tsx:227`<br>+3 more |
| `apply-scheduled-boosts` | token | — | 23 | yes | _server-side / cron / webhook only_ |
| `ask-anything` | public | false | 29 | no | _server-side / cron / webhook only_ |
| `auth-email-hook` | public | false | 23 | no | _server-side / cron / webhook only_ |
| `autoscale-ad-traffic` | token | — | 23 | yes | _server-side / cron / webhook only_ |
| `backfill-image-dims` | token | — | 5 | no | `components/admin/AdminHealth.tsx:263` |
| `backfill-image-hashes` | token | — | 23 | no | _server-side / cron / webhook only_ |
| `backfill-media-objects` | **not deployed** | — | — | no | _server-side / cron / webhook only_ |
| `backfill-thumbnails` | token | — | 25 | no | `components/admin/AdminHealth.tsx:70` |
| `backup-reminder` | token | — | 22 | yes | _server-side / cron / webhook only_ |
| `brevo-webhook` ⚠ | public | — | 13 | no | _server-side / cron / webhook only_ |
| `cast-photo-vote` | public | false | 22 | yes | `hooks/competition/useCompetitionVoting.ts:102` |
| `complete-round` ⚠ | public | — | 27 | yes | `components/judge/CompleteRoundDialog.tsx:141`<br>`pages/JudgePanel.tsx:744`<br>`pages/JudgePanel.tsx:919` |
| `create-payment-session` | public | false | 22 | yes | `pages/Wallet.tsx:211` |
| `dashboard-init` | public | false | 24 | yes | `lib/dashboardInit.ts:188` |
| `delete-my-account` | token | — | 11 | no | `components/settings/DeleteAccountSection.tsx:35` |
| `delete-user` | token | — | 27 | no | `components/admin/AdminUsers.tsx:448` |
| `detect-ai-image` | public | false | 24 | no | _server-side / cron / webhook only_ |
| `detect-orphan-files` | token | — | 28 | no | `components/admin/AdminHealth.tsx:227` |
| `diagnose-brevo-key` | token | — | 22 | no | _server-side / cron / webhook only_ |
| `entry-final-votes` | token | — | 23 | yes | _server-side / cron / webhook only_ |
| `evaluate-round2` | token | — | 22 | yes | _server-side / cron / webhook only_ |
| `expire-gift-credits` | token | — | 23 | yes | _server-side / cron / webhook only_ |
| `fix-cache-headers` | token | — | 23 | no | `components/admin/AdminHealth.tsx:85` |
| `ga-report` ⚠ | public | — | 8 | no | `components/admin/AdminAnalyticsReports.tsx:74` |
| `get-payment-gateways-public` | public | false | 22 | yes | `hooks/wallet/useWalletPageData.ts:25` |
| `get-wallet-summary` | token | — | 22 | yes | `hooks/wallet/useWalletSummary.ts:25` |
| `get-wallet-transactions` | token | — | 22 | yes | `hooks/wallet/useWalletTransactions.ts:26` |
| `handle-email-suppression` | public | false | 22 | no | _server-side / cron / webhook only_ |
| `handle-email-unsubscribe` | public | false | 22 | no | `pages/Unsubscribe.tsx:30` |
| `hard-delete-competition` | token | — | 23 | no | `modules/admin/CompetitionsModule.tsx:389` |
| `judge-session-resume` | public | false | 22 | no | `lib/judgingApi.ts:117` |
| `judging-invariants-nightly` | token | — | 22 | no | _server-side / cron / webhook only_ |
| `manage-notifications` | token | — | 23 | yes | `components/NotificationBell.tsx:234`<br>`components/NotificationBell.tsx:242`<br>`components/NotificationBell.tsx:295`<br>+2 more |
| `measure-post-media` | token | true | 6 | no | _server-side / cron / webhook only_ |
| `media-register-upload` | public | false | 6 | no | `lib/media/postMediaWrite.ts:284` |
| `media-verify-upload` | **not deployed** | — | — | no | _server-side / cron / webhook only_ |
| `migrate-post-media` | token | — | 6 | no | _server-side / cron / webhook only_ |
| `migrate-storage` | public | false | 22 | no | `components/admin/StorageMigrationPanel.tsx:101`<br>`components/admin/StorageMigrationPanel.tsx:42`<br>`components/admin/StorageMigrationPanel.tsx:67`<br>+1 more |
| `moderate-comment` | token | — | 25 | yes | `components/ImageEngagement.tsx:200`<br>`hooks/feed/useAddComment.ts:178` |
| `paypal-capture-order` | token | — | 22 | yes | `pages/Wallet.tsx:127` |
| `preview-transactional-email` | public | false | 24 | no | _server-side / cron / webhook only_ |
| `process-email-queue` | token | true | 27 | no | _server-side / cron / webhook only_ |
| `publish-round` | token | — | 23 | no | `components/admin/RoundPublishPanel.tsx:76` |
| `publish-scheduled-posts` | token | — | 27 | no | _server-side / cron / webhook only_ |
| `purge-s3-orphans` | token | — | 24 | no | `components/admin/AdminHealth.tsx:249` |
| `rank-feed` | public | false | 25 | yes | _server-side / cron / webhook only_ |
| `razorpay-verify-payment` | token | — | 22 | yes | `pages/Wallet.tsx:249` |
| `s3-delete` | public | false | 22 | yes | `lib/storageUpload.ts:75` |
| `s3-presign-upload` | public | false | 22 | yes | `lib/s3Upload.ts:53` |
| `s3-signed-url` | token | — | 23 | yes | `lib/storageUpload.ts:196` |
| `s3-upload` | public | false | 22 | yes | _server-side / cron / webhook only_ |
| `send-broadcast-push` ⚠ | public | — | 6 | no | `components/admin/AdminPushBroadcast.tsx:60` |
| `send-gift-credit` | token | — | 23 | yes | `components/AdminGiftCredit.tsx:176`<br>`components/AdminGiftCredit.tsx:232` |
| `send-push` ⚠ | public | — | 11 | no | _server-side / cron / webhook only_ |
| `send-reengagement-emails` | token | — | 25 | no | _server-side / cron / webhook only_ |
| `send-transactional-email` | token | true | 26 | no | _server-side / cron / webhook only_ |
| `seo-crawler-verify` | token | — | 22 | no | `components/admin/AdminSEO.tsx:157` |
| `seo-route-metadata` | public | false | 23 | no | _server-side / cron / webhook only_ |
| `sitemap` | public | false | 25 | no | _server-side / cron / webhook only_ |
| `submit-deposit` | token | — | 22 | yes | `hooks/wallet/useWalletDeposits.ts:22` |
| `submit-judge-comment` | token | — | 23 | no | _server-side / cron / webhook only_ |
| `submit-judge-decision` | token | — | 23 | no | _server-side / cron / webhook only_ |
| `submit-judge-score` | public | false | 25 | no | _server-side / cron / webhook only_ |
| `submit-judge-tag` | token | — | 25 | no | _server-side / cron / webhook only_ |
| `test-smtp` | token | — | 22 | no | `components/admin/settings/EmailSettingsSection.tsx:70` |
| `translate-text` | token | — | 6 | no | `lib/translate.ts:67` |
| `verify-email-provider` | token | — | 22 | no | `components/admin/settings/EmailSettingsSection.tsx:99` |
| `verify-image-hash` | token | — | 22 | no | _server-side / cron / webhook only_ |

---

## 3. Database RPCs

### 3.1 ⚠ Grant posture worth reviewing

**40 of 105** referenced RPCs grant `EXECUTE` to `PUBLIC`, and
**26** admin-or-maintenance RPCs grant `EXECUTE` to `anon`:

- `admin_flag_entry_for_review`
- `admin_search_users`
- `admin_set_photo_rejected`
- `backfill_judging_notifications`
- `backfill_tag_decision_drift_admin`
- `fix_certificate_readiness_admin`
- `fix_gift_drift_admin`
- `fix_referral_drift_admin`
- `get_certificate_drift_admin`
- `get_certificate_readiness_drift_admin`
- `get_entry_status_drift_admin`
- `get_entry_status_drift_summary_admin`
- `get_gift_drift_admin`
- `get_judge_collusion_admin`
- `get_judging_drift_admin`
- `get_notification_drift_admin`
- `get_notification_health_stats_admin`
- `get_placement_drift_admin`
- `get_profile_admin`
- `get_progression_drift_admin`
- `get_referral_drift_admin`
- `get_round_judging_gate_admin`
- `get_test_agent_health_admin`
- `get_unjudged_parity_admin`
- `list_tag_decision_drift_admin`
- `search_profiles_admin`

This is **not** a demonstrated data leak. Every one of these performs its own
`has_role(auth.uid(), 'admin')` check and raises `Not authorized` otherwise, and RLS sits
behind that. But the `EXECUTE` grant is wider than the function's intent, so the internal
check is the *only* thing standing between an anonymous caller and the function body. Two
controls are better than one. Narrowing these to `authenticated` is a contained hardening
task — and it needs the both-sides test the project already requires: prove an admin still
works, and prove anon is refused.

For contrast, the RPCs added in 2026-08-25 were granted correctly from the start —
`revoke all … from public`, `revoke all … from anon`, `grant execute … to authenticated`.

### 3.2 Full RPC table

`Security` — `DEFINER` runs as the function owner, bypassing the caller's RLS; the function's
own authorization check is then the real gate. `Grants` lists who holds `EXECUTE`.

| RPC | Production signature | Security | search_path | EXECUTE | Called from |
|---|---|---|---|---|---|
| `acquire_judge_lock` | `(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/judging/useJudgingLock.ts:73` |
| `admin_flag_entry_for_review` ⚠ | `(_entry_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/judge/CinemaFullView.tsx:1747` |
| `admin_list_certificates` | `(_query text DEFAULT ''::text, _type text DEFAULT NULL::text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminCertificates.tsx:143` |
| `admin_reject_wallet_transaction` | `(_admin_id uuid, _txn_id uuid, _reason text DEFAULT NULL::text)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminTransactions.tsx:514` |
| `admin_search_certificate_recipients` | `(_query text, _limit integer DEFAULT 20)` | DEFINER | `search_path=public, auth` | authenticated, postgres, service_role | `src/components/admin/AdminCertificates.tsx:256` |
| `admin_search_users` ⚠ | `(search_query text DEFAULT ''::text, search_by text DEFAULT 'name'::text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/AdminGiftCredit.tsx:59` |
| `admin_search_users_v2` | `(_query text DEFAULT ''::text, _by text DEFAULT 'name'::text, _role text DEFAULT NULL::text, _badge text DEFAULT NULL::text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminUsers.tsx:264` |
| `admin_set_photo_rejected` ⚠ | `(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text DEFAULT NULL::text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/modules/admin/EntriesModule.tsx:27` |
| `admin_wallet_credit` | `(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _reference_type text DEFAULT NULL::text, _metadata jsonb DEFAULT NULL::jsonb)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminWalletTab.tsx:121`<br>`src/components/AdminGiftCredit.tsx:212` |
| `app_has_role` | `(_user_id uuid, _role text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/social/useFriendFollow.ts:91` |
| `approve_deposit` | `(_admin_id uuid, _txn_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminTransactions.tsx:486` |
| `are_friends` ⚠ | `(_user_a uuid, _user_b uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/profile/useProfileData.ts:69` |
| `backfill_judging_notifications` | `(_window_days integer DEFAULT 90, _dry_run boolean DEFAULT true)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/NotificationsHealthAudit.tsx:57` |
| `backfill_tag_decision_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/JudgingInvariantsAudit.tsx:151` |
| `change_custom_url` ⚠ | `(_new_url text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/EditProfile.tsx:516` |
| `check_custom_urls_taken` ⚠ | `(_urls text[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/EditProfile.tsx:202` |
| `claim_username` ⚠ | `(candidate text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/OnboardingModal.tsx:338` |
| `clear_custom_url` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/EditProfile.tsx:529` |
| `create_system_post` | `(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[] DEFAULT NULL::uuid[])` | DEFINER | `search_path=public, pg_temp` | authenticated, postgres, service_role | `src/lib/profilePostHelper.ts:37`<br>`src/pages/MyPhotos.tsx:405` |
| `email_exists` | `(_email text)` | DEFINER | `search_path=""` | anon, authenticated, postgres, service_role | `src/pages/ForgotPassword.tsx:39` |
| `enroll_in_course` | `(_user_id uuid, _course_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/pages/CourseDetail.tsx:61` |
| `filter_moderated_user_ids` | `(_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/HashtagFeed.tsx:73` |
| `fix_certificate_readiness_admin` ⚠ | `(_entry_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/AwardsIntegrityAudit.tsx:72` |
| `fix_gift_drift_admin` ⚠ | `(_announcement_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/WalletReconciliationAudit.tsx:72` |
| `fix_referral_drift_admin` ⚠ | `(_referral_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/WalletReconciliationAudit.tsx:90` |
| `get_ad_engagement` | `(_creative_ids uuid[])` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/lib/ads/adEngagement.ts:84` |
| `get_app_event_counts_admin` | `(_hours integer DEFAULT 24)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminAppEvents.tsx:126` |
| `get_app_events_admin` | `(_hours integer DEFAULT 24, _code text DEFAULT NULL::text, _severity text DEFAULT NULL::text, _limit integer DEFAULT 200)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminAppEvents.tsx:127` |
| `get_broadcast_feed` _(overload 1/3)_ | `(_exclude_ids uuid[], _limit integer)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/feed/useFeedQuery.ts:91` |
| `get_broadcast_feed` _(overload 2/3)_ | `(_exclude_ids uuid[], _limit integer, _newest_first integer)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role |  |
| `get_broadcast_feed` _(overload 3/3)_ | `(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role |  |
| `get_certificate_drift_admin` ⚠ | `(p_competition_id uuid DEFAULT NULL::uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/CertificateDriftAudit.tsx:58` |
| `get_certificate_readiness_drift_admin` ⚠ | `(_competition_id uuid DEFAULT NULL::uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/AwardsIntegrityAudit.tsx:56` |
| `get_client_error_stats_admin` | `(_hours integer DEFAULT 24)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/ClientFailuresAudit.tsx:62` |
| `get_competition_duplicate_clusters` ⚠ | `(_competition_id uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/judging/useJudgeIntegrityData.ts:65` |
| `get_competition_raw_commitments` ⚠ | `(_competition_id uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/judging/useJudgeIntegrityData.ts:34` |
| `get_contributor_scores` ⚠ | `(_user_ids uuid[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/contributorScore.ts:39` |
| `get_course_lessons_for_editor` | `(_course_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/pages/CourseEditor.tsx:311` |
| `get_entries_private_meta` | `(_entry_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/competition/EditEntryDialog.tsx:81`<br>`src/hooks/competition/useUserEntries.ts:76`<br>+1 more |
| `get_entry_status_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/EntryStatusDriftAudit.tsx:48` |
| `get_entry_status_drift_summary_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/EntryStatusDriftAudit.tsx:49` |
| `get_feed_stories_bar` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/feed/FeedStoriesBar.tsx:75` |
| `get_gated_entry_status` ⚠ | `(p_entry_ids uuid[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/judging/useGatedEntryStatus.ts:58` |
| `get_gift_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/WalletReconciliationAudit.tsx:51` |
| `get_judge_collusion_admin` ⚠ | `(p_competition_id uuid DEFAULT NULL::uuid, p_min_overlap integer DEFAULT 10, p_min_correlation numeric DEFAULT 0.9)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/CollusionAudit.tsx:46` |
| `get_judging_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/JudgingForensicDriftAudit.tsx:57` |
| `get_judging_tag_assignment_counts` | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/admin/AdminTagSemanticsAudit.tsx:95` |
| `get_lesson_content` | `(_lesson_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/LessonView.tsx:39` |
| `get_my_certificate_entries` | `()` _no arguments_ | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/pages/Certificates.tsx:131` |
| `get_my_notifications_grouped` ⚠ | `(_limit integer DEFAULT 30, _before timestamp with time zone DEFAULT NULL::timestamp with time zone)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/notifications/useNotificationHistory.ts:30` |
| `get_my_story_view_counts` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/feed/FeedStoriesBar.tsx:82`<br>`src/components/profile/ProfileStories.tsx:335` |
| `get_my_unread_notifications_grouped` ⚠ | `(_limit integer DEFAULT 20, _exclude_types text[] DEFAULT '{}'::text[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/notifications/useNotificationsQuery.ts:193` |
| `get_notification_drift_admin` ⚠ | `(_window_days integer DEFAULT 90)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/NotificationsHealthAudit.tsx:39` |
| `get_notification_health_stats_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/NotificationsHealthAudit.tsx:40` |
| `get_per_photo_consensus` ⚠ | `(p_entry_ids uuid[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/judging/usePhotoDecisions.ts:59` |
| `get_per_photo_placement` | `(p_entry_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/judging/usePhotoPlacements.ts:51` |
| `get_photo_r4_awards` | `(p_entry_ids uuid[])` | DEFINER | `search_path=public` | postgres, service_role | `src/hooks/judging/usePhotoR4Award.ts:48` |
| `get_placement_drift_admin` ⚠ | `(_competition_id uuid DEFAULT NULL::uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/AwardsIntegrityAudit.tsx:55` |
| `get_post_view_counts` ⚠ | `(_post_ids uuid[])` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/feed/useFeedQuery.ts:210` |
| `get_profile_admin` ⚠ | `(_id uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/AdminFeaturedArtist.tsx:505`<br>`src/components/admin/ProfileTypeaheadPicker.tsx:35` |
| `get_profile_visible_fields` | `(_target uuid)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/profile/useProfileData.ts:79` |
| `get_progression_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/JudgingDriftAudit.tsx:44` |
| `get_public_final_votes` | `(_entry_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/lib/finalVoteTotals.ts:28` |
| `get_public_role_user_ids` | `(_role text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/lib/adminBrand.ts:35`<br>`src/pages/Discover.tsx:68` |
| `get_public_roles_for_users` | `(_user_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/profile/useProfileData.ts:67`<br>`src/lib/profileMapCache.ts:324` |
| `get_public_round_scores` ⚠ | `(p_competition_id uuid, p_round_number integer)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/competition/PublicJudgeScoresReveal.tsx:99` |
| `get_referral_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/WalletReconciliationAudit.tsx:52` |
| `get_round_eligible_photos` ⚠ | `(_competition_id uuid, _round_number integer)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/judging/useJudgeClassicData.ts:212` |
| `get_round_judging_gate_admin` ⚠ | `(_competition_id uuid, _round_number integer)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/JudgeUIvsDBGateAudit.tsx:133` |
| `get_round_summary` | `(p_competition_id uuid, p_round_number integer)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/judge/CompleteRoundDialog.tsx:79` |
| `get_test_agent_health_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/admin/AdminTestAgent.tsx:84` |
| `get_top_contributors_v2` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/useTopContributors.ts:61` |
| `get_unjudged_parity_admin` ⚠ | `(p_judge_id uuid, p_competition_id uuid, p_round_number integer)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/UnjudgedParityAudit.tsx:50` |
| `global_search` | `(term text, section text DEFAULT 'all'::text, username_only boolean DEFAULT false)` | DEFINER | `search_path=public, extensions` | anon, authenticated, postgres, service_role | `src/components/GlobalSearch.tsx:176` |
| `global_search_hashtags` | `(term text)` | DEFINER | `search_path=public, extensions` | anon, authenticated, postgres, service_role | `src/components/GlobalSearch.tsx:184` |
| `has_role` _(overload 1/2)_ ⚠ | `(_user_id uuid, _role app_role)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/hooks/social/useFriendshipMutations.ts:36` |
| `has_role` _(overload 2/2)_ ⚠ | `(_user_id uuid, _role text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role |  |
| `heartbeat_judge_lock` | `(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer DEFAULT 5)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/judging/useJudgingLock.ts:109` |
| `increment_managed_page_view` | `(_page_id text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/ManagedPageView.tsx:34` |
| `is_s3_storage_enabled` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/s3Upload.ts:22` |
| `issue_course_completion_certificate` | `(_course_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/pages/CourseDetail.tsx:85` |
| `judging_invariants_check` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/JudgingInvariantsAudit.tsx:113` |
| `list_tag_decision_drift_admin` ⚠ | `()` _no arguments_ | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/admin/JudgingInvariantsAudit.tsx:97` |
| `log_app_event` ⚠ | `(_code text, _event text, _severity text, _message text, _fn text DEFAULT NULL::text, _file text DEFAULT NULL::text, _reason text DEFAULT NULL::text, _expected text DEFAULT NULL::text, _actual text DEFAULT NULL::text, _next_step text DEFAULT NULL::text, _duration_ms integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _detail jsonb DEFAULT NULL::jsonb, _platform text DEFAULT NULL::text, _app_build text DEFAULT NULL::text, _url text DEFAULT NULL::text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/logger.ts:275` |
| `log_client_error` ⚠ | `(_kind text, _message text, _detail jsonb DEFAULT NULL::jsonb, _platform text DEFAULT NULL::text, _app_build text DEFAULT NULL::text, _url text DEFAULT NULL::text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/reportClientError.ts:167` |
| `media_begin_upload` | `(_sha256 bytea, _width integer, _height integer, _bytes bigint, _mime text)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/lib/media/postMediaWrite.ts:252` |
| `mutual_friend_ids` ⚠ | `(_user_a uuid, _user_b uuid, _limit integer DEFAULT 5)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/discover/DiscoverCard.tsx:38`<br>`src/components/MutualFriends.tsx:30`<br>+1 more |
| `mutual_friends_count` ⚠ | `(_user_a uuid, _user_b uuid)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/MutualFriends.tsx:29`<br>`src/hooks/social/useFriendFollow.ts:98`<br>+1 more |
| `post_media_for` | `(_post_ids uuid[])` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/lib/media/postMediaRead.ts:146` |
| `post_publish_with_media` | `(_media_ids uuid[], _content text DEFAULT ''::text, _privacy text DEFAULT 'public'::text, _categories text[] DEFAULT '{}'::text[], _indexing_disabled boolean DEFAULT false, _idempotency_key text DEFAULT NULL::text, _thumbnail_urls text[] DEFAULT NULL::text[])` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/lib/media/postMediaWrite.ts:404` |
| `process_referral_reward` _(overload 1/2)_ | `(_referred_user_id uuid, _activity_type text)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/components/admin/AdminReferrals.tsx:124`<br>`src/pages/CompetitionSubmit.tsx:328` |
| `process_referral_reward` _(overload 2/2)_ | `(_referred_user_id uuid, _activity_type text, _txn_amount numeric DEFAULT 0)` | DEFINER | `search_path=public` | authenticated, postgres, service_role |  |
| `publish_post_draft` | `(_draft_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/feed/usePostDrafts.ts:281` |
| `record_activity_minute` | `(_segment text, _interacted boolean DEFAULT false)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/lib/engagement/activityPing.ts:125` |
| `register_push_token` ⚠ | `(_token text, _platform text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/native/push.ts:83`<br>`src/lib/native/push.ts:93` |
| `release_judge_lock` | `(_entry_id uuid, _photo_index integer, _judge_id uuid)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/judging/useJudgingLock.ts:59`<br>`src/hooks/judging/useJudgingLock.ts:165` |
| `request_withdrawal` | `(_amount numeric, _bank_details jsonb)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/wallet/useWalletWithdrawals.ts:46` |
| `resolve_custom_url` ⚠ | `(_url text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/CustomUrlProfile.tsx:20`<br>`src/pages/EditProfile.tsx:225` |
| `search_certificates` ⚠ | `(_name text, _course_title text, _issued_date date)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/VerifyCertificate.tsx:101` |
| `search_profiles_admin` ⚠ | `(q text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/components/admin/ProfileTypeaheadPicker.tsx:50` |
| `submit_competition_entry` | `(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/hooks/competition/useCompetitionEntryMutations.ts:35` |
| `suggest_hashtags` | `(prefix text, max_results integer DEFAULT 5)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/feed/useCaptionHashtags.ts:105` |
| `suggest_username` ⚠ | `(display_name text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/OnboardingModal.tsx:211` |
| `unregister_push_token` ⚠ | `(_token text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/lib/native/push.ts:134` |
| `username_available` ⚠ | `(candidate text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/components/OnboardingModal.tsx:228` |
| `verify_certificate` ⚠ | `(_cert_id text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/VerifyCertificate.tsx:79` |
| `verify_certificate_by_token` ⚠ | `(_token text)` | DEFINER | `search_path=public` | PUBLIC, anon, authenticated, postgres, service_role | `src/pages/CertificateVerifyByToken.tsx:44` |
| `verify_staff_id` | `(_id_number text)` | DEFINER | `search_path=public` | anon, authenticated, postgres, service_role | `src/pages/IDVerification.tsx:59` |
| `wallet_transaction` | `(_user_id uuid, _type text, _amount numeric, _description text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _reference_type text DEFAULT NULL::text, _metadata jsonb DEFAULT NULL::jsonb)` | DEFINER | `search_path=public` | authenticated, postgres, service_role | `src/hooks/wallet/useWallet.ts:66`<br>`src/hooks/wallet/useWallet.ts:79` |

---

## 4. What is NOT in this document

Stated so nobody mistakes absence for coverage:

- **Return shapes.** Every RPC's `RETURNS TABLE(...)` was not captured; only inputs were.
- **Request/response bodies of edge functions.** Their contracts live in each `index.ts`.
- **RLS policies.** 686 policies on production. A `DEFINER` function bypasses them entirely,
  which is exactly why §3.1 matters.
- **Rate limits and triggers.** Several RPCs are rate-limited by triggers not listed here.
- **The staging lane's values.** Everything above is production. Staging
  (`ztzutckwdhetphwghuzj`) matched production across all 105 referenced RPCs when last
  measured on 2026-08-25 — identical digest `361bf226a3946479a930e74a65c6b9dc` — but the
  edge-function deployments were not compared.

## 5. Open items this document surfaced

| # | Item | Severity |
|---|---|---|
| 1 | CORS origin check is a prefix match on production; fix exists on `staging`, unpromoted; 27 functions need redeploy after | Moderate |
| 2 | Six functions deployed public but undeclared in `config.toml` | Moderate — a repo-driven redeploy breaks them |
| 3 | Admin/maintenance RPCs granted `EXECUTE` to `anon` | Low — defence-in-depth, not a demonstrated leak |
| 4 | `backfill-media-objects, media-verify-upload` in repo, never deployed | Low — dead source or forgotten deploy |
| 5 | `email_exists` runs with `search_path=""` (empty), unlike every other function | Low — verify it is deliberate |
