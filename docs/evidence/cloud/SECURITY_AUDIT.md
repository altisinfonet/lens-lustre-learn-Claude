SECURITY AUDIT COMPLETE — overall: STRONG (DB + RLS backbone VERY STRONG, confirmed on production; a few fixable app-layer gaps hold the whole from VERY STRONG)

Independent deep security auditor (cloud), 50mm Retina World. Date 2026-10-30.
Method: production READ-ONLY catalog PROBE (counts/redacted schema only); real
anonymous attack tests over HTTP against staging; full source review of RLS
policies, SECURITY DEFINER functions, edge functions, grants, triggers; full
git-history secret scan. No fixes made. No production data or secrets printed.

Primary live evidence: catalog PROBE run on BOTH lanes (apply-migration.yml,
PROBE_20261103_0901_sec_catalog.sql, BEGIN READ ONLY…ROLLBACK) — staging run
41011522611 (06:23 UTC) and PRODUCTION run 41020231708 (08:04 UTC) — plus anonymous
HTTPS attack tests against staging. Production results confirm the backbone (below).

================================================================================
(1) SCORECARD — 11 areas
================================================================================
| # | Area | Rating | One-line basis |
|---|------|--------|----------------|
| 1 | RLS policy correctness | STRONG | 769 policies; no open write; UPDATE-without-WITH-CHECK is safe (USING doubles as CHECK); INSERTs bind ownership |
| 2 | Privilege escalation | STRONG | role writes admin-only; self-assign limited to 'registered_photographer'; profiles moderation cols trigger-guarded; entry status frozen |
| 3 | Private data (anon/other member) | STRONG | anon reads only public posts + public profile views + public follows graph; no email/phone/dob/national-id/wallet column on any anon view; no DM tables. Realtime (prod) publishes 28 RLS-gated app tables — enforcement not PoC'd (see 'likely') |
| 4 | SECURITY DEFINER functions (all 305) | STRONG | 100% pin search_path; every admin_* has a role check; 0 anon-exec fns write sensitive data or read private data unguarded |
| 5 | Table grants | WEAK | anon/authenticated hold broad column + table grants (even SIUD on wallets/bank_details); only RLS gates them — defense-in-depth, not currently exploitable |
| 6 | Storage | WEAK | private buckets truly private + key paths uid-gated, BUT any member can overwrite/delete shared gallery/journal/inline/cover objects, and no bucket has size/MIME limits |
| 7 | Auth | WEAK | login lockout hook present, email confirm on, test-domains blocked, send rate-limit active — BUT 0 of 2 prod staff (admin+judge) have MFA; leaked-password protection UNKNOWN |
| 8 | Edge functions | WEAK | most JWT/role/webhook-signature gated, BUT seo-route-metadata leaks private-post text/image; paypal-capture-order credits uncaptured orders; a few AI endpoints unthrottled |
| 9 | Exactly-once / integrity | STRONG | unique indexes on reactions/votes/follows/comments + paypal/razorpay/withdrawal payment ids; wallet idempotency registry; balance guarded in fn |
| 10 | Secrets & public repo | STRONG | 0 real secrets in 1722 commits; cron has 0 inline tokens; only log-hygiene nits (md5-of-email in a diag PROBE, cert-pw-length echo) |
| 11 | Live-only security objects | STRONG | password_verification_hook = brute-force lockout; get_profile_visible_fields privacy-gated; has_role/handle_new_user standard; verify_staff_id exposes staff dir (by design) |

================================================================================
(2) PROVEN EXPLOITABLE FINDINGS (severity · who · what · evidence · fix)
================================================================================

[HIGH] Shared-prefix storage objects can be overwritten or deleted by any member
- Who: any signed-in member.  What: overwrite or delete other members'/admins'
  images under prefixes inline/ journal/ gallery/ covers/ (site + journal + inline
  content images, profile covers). Defacement + data loss of site imagery.
- Evidence: source — supabase/functions/s3-presign-upload/index.ts isPathAllowed
  L56-64 (SHARED_PREFIXES allowed to any member, keys carry no user id);
  s3-delete/index.ts L135/166 (paths[] from client, same gate); frontend builds
  these keys with no user id (src/lib/imageUpload.ts L93-119). Live PROBE: buckets
  post-images/avatars/journal-images/portfolio-images/site-assets/… are public and
  carry NO size or MIME limit (BUCKET rows, file_size_limit & allowed_mime_types
  both null on every bucket). Authenticated live PoC not run (staging signup is
  rate-limited); logic is unambiguous.
- Fix (~5-8k tokens): require uid-in-path for write/delete on shared prefixes, or
  namespace shared objects under the owner's id; add per-bucket size + MIME limits.

[HIGH] s3-upload accepts any content-type and any size
- Who: any member.  What: replace a gallery image with HTML/SVG/arbitrary bytes,
  served from the CDN origin (stored-content / origin abuse), bypassing the 50 MB +
  MIME allow-list that s3-presign-upload enforces.
- Evidence: supabase/functions/s3-upload/index.ts L151/173/207 (signs client file.type,
  no size check); contrast _shared/uploadDeclaration.ts L14-42 (presign allow-list).
  Live PROBE: no bucket-level MIME/size backstop exists.
- Fix (~3k tokens): enforce the same allow-list + size cap in s3-upload; add bucket
  limits.

[MEDIUM] Private/friends-only post text + image leak via seo-route-metadata
- Who: anyone (no auth).  What: supply any post UUID → get that post's content
  snippet and image_url even when privacy != public (only noindex is set).
- Evidence: supabase/functions/seo-route-metadata/index.ts resolvePost L313-331
  (service-role select, no privacy gate on the returned fields); config verify_jwt=false.
  Live: endpoint returns HTTP 200 with NO auth header at all (tested on staging).
  Leak requires knowing a post UUID (not enumerable via anon RLS).
- Fix (~2k tokens): return content/image only when privacy='public'; else title-only.

[MEDIUM] paypal-capture-order can credit an uncaptured (APPROVED) order
- Who: any member who can get a capture declined.  What: a 422 from PayPal is treated
  as "already captured"; status APPROVED is accepted; amount taken from the order →
  wallet credit without a completed payment.
- Evidence: supabase/functions/paypal-capture-order/index.ts L110/128/134/156.
  Not reproduced against live PayPal (would require a real sandbox order). The DB
  unique index uq_wallet_txn_paypal_order_id (live PROBE) prevents replay of the SAME
  order but not the credit of an approved-uncaptured one.
- Fix (~3k tokens): require capture status COMPLETED and a non-null capture id before
  crediting; treat 422 as failure.

[MEDIUM, only while vote rewards are active] cast-photo-vote unvote penalty with no prior vote
- Who: any member.  What: repeatedly "unvote" a victim's entry; the owner-penalty
  path runs without checking a vote existed, and wallet_transaction permits a negative
  balance for type 'unvote_penalty' (live PROBE body), so a victim's wallet can be
  driven arbitrarily negative / flooded to its 2000/hr cap.
- Evidence: supabase/functions/cast-photo-vote/index.ts L185-202, L283-325;
  wallet_transaction body (live) allows negative for unvote_penalty.
- Fix (~3k tokens): no penalty unless a matching vote row is deleted; never allow the
  owner-penalty to push a third party negative.

(Lower, proven) ad-reward-credit daily-cap race (ad-reward-credit L126-157, no unique
key); entry-final-votes shows any member any entry's vote counts; translate-text /
ask-anything / detect-ai-image / analyze-gallery-image have no (or bypassable) rate
limit → any member can run up AI cost. complete-round lets a judge lock a round of a
competition they are not assigned to.

================================================================================
(3) LIKELY-BUT-NOT-PROVEN (needs a signed-in staging PoC or the production PROBE)
================================================================================
- Member-to-member post/photo visibility: can_view_post gates anon correctly (proven:
  anon sees only public posts). The friends/followers branch for a logged-in member was
  read in source and looks correct but was not exercised with two live member accounts
  (staging signup is rate-limited + email-confirm gated).
- wallet_transaction self-credit: RESOLVED — the BUG-001 guard is PRESENT in the LIVE
  body on BOTH staging and PRODUCTION (production run 41020231708: body contains
  "_caller_id = _user_id AND _amount > 0 AND NOT has_role(...,'admin') THEN RAISE").
  A member cannot mint wallet balance. Not a finding.
- Table-grant hygiene (area 5): anon/authenticated hold write grants on money/PII
  tables; only RLS blocks them. Not exploitable today (RLS on + correct), but one
  dropped policy would expose it.
- Realtime row leakage (PRODUCTION): supabase_realtime publishes 28 app tables incl.
  user_notifications, support_tickets, friendships, judge_scores, judge_decisions,
  profiles, user_roles (production run; staging had none). These tables have RLS with
  own-row SELECT policies, and Supabase Realtime applies the subscriber's SELECT policy
  to postgres_changes — so a member should NOT receive another member's rows. NOT proven
  with a live two-member websocket subscription (staging signup rate-limited). Residual:
  DELETE events broadcast only the row's primary key, not gated by RLS. Recommend a
  realtime subscription PoC to confirm enforcement.

================================================================================
(4) JUDGING FINDINGS (separate — for the Owner to handle later; not dug into further)
================================================================================
- Judge RLS is strong: judge_scores/decisions/comments are gated by role=judge AND
  competition_judges assignment AND judge_can_access_entry AND round-open checks
  (live policies). judge_entry_assignments visible only to the assigned judge.
- complete-round (edge) accepts a competition_id with no judge-assignment check for a
  caller holding the judge role (supabase/functions/complete-round/index.ts L240-249):
  a judge could lock rounds of competitions they are not assigned to. Owner to judge.
- entry-final-votes returns any entry's vote tallies to any member (possible judging/
  fairness signal leak). Owner to judge.
- get_judge_collusion_admin / judging drift RPCs are admin-gated (role check present).

================================================================================
(5) FOR THE OWNER (plain words)
================================================================================
Your foundation — the database, the row-level security, who-can-see-what, and how
admin/judge powers are decided — is very strong. Every table has its lock on, members
can only read and change their own rows, nobody can make themselves an admin, and the
money function refuses a member who tries to top up their own wallet (checked live on
the test copy). No real passwords or keys are hidden in your public code history.

What is not yet very strong, and should be fixed first:
1. Photo storage: any logged-in member can overwrite or delete shared images
   (gallery/journal/cover pictures), and uploads have no size or file-type limit.
   This is the biggest hole — someone could wipe or deface site images. Fix first.
2. No admin/staff account has two-factor login turned on. Turn it on.
3. A public web helper hands back the text and picture of a private post if someone
   knows its link id. Lock it to public posts.
4. Live-updates (realtime) on the production site now carry 28 tables including
   notifications, support tickets and friendships. These are locked by row-level
   security, but I could not run a live two-account test to prove the live-update
   channel enforces it. Worth a quick confirmation.

Good news confirmed on the LIVE production database (read-only check, 08:04 UTC): the
wallet top-up guard IS present, every table has its lock on, and no stranger can read
your members' emails, phones, IDs or wallets. That part holds up well.

================================================================================
(6) NOT VERIFIED (and why) — UNKNOWN, never rounded up
================================================================================
- PRODUCTION catalog PROBE: DONE (run 41020231708, 08:04 UTC). Confirmed on production:
  wallet_transaction BUG-001 guard PRESENT; all 186 base tables RLS-enabled; every
  admin_* function role-gated; all SECURITY DEFINER functions pin search_path; no open
  (true/true) write policy to anon/authenticated; buckets identical to staging (3 private,
  no size/MIME limits); STAFF MFA = 0 of 2 staff (1 admin, 1 judge) have a factor; 139
  auth users (11 unconfirmed). Production-only: supabase_realtime publishes 28 app tables
  (see 'likely' — realtime RLS enforcement not PoC'd).
- Member-to-member RLS PoC (friends-only posts, cross-member reads): not run live
  (staging signup rate-limited + email-confirm gated); assessed from policy text only.
- Leaked-password (HIBP) protection, exact session max-age, password complexity rules:
  GoTrue server settings not exposed via the API — UNKNOWN. (Login lockout IS present.)
- google-services.json Firebase API key restriction status: needs the Google Cloud
  console — UNKNOWN (the key itself is public-by-design client config).
- Exact exploitability of the PayPal uncaptured-order credit: logic-proven, not run
  against a live PayPal sandbox.
- npm audit: 14 high in production deps (client-facing: dompurify sanitizer bypass,
  react-router open-redirect/XSS) — reported, not individually exploited.
