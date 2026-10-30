# SECURITY AUDIT — IN PROGRESS (interim; proven findings so far)

Independent deep security auditor (cloud). Started 2026-10-30. Owner question:
"Is the backbone — DB, RLS, security — VERY strong?" Live=main, staging=test copy.
NO FIXES. Production READ-ONLY. Attack PoCs on staging only.

STATUS: catalog PROBE 0901 pending CI merge → will run on staging + production to
confirm DB-level items (RLS policy text, grants, SECURITY DEFINER bodies, wallet
guard, realtime). Code-level findings below are proven from source now.

## Heartbeat
- 2026-10-30 ~06:0x — edge-function + storage audit complete; seo leak endpoint
  confirmed open over HTTP; s3 shared-prefix overwrite/delete logic confirmed in
  source; secrets sweep clean; RLS git-history analysis running; PROBE 0901 queued.

## Proven so far (code + live HTTP), pending DB confirmation where noted

STORAGE (area 6) — HIGH, code-proven (supabase/functions/s3-presign-upload/index.ts
isPathAllowed L56-64; s3-upload; s3-delete): any signed-in member may upload/
overwrite/delete any object under shared prefixes inline/ journal/ gallery/ covers/
— these keys contain no user id, so there is no ownership check. s3-upload adds no
content-type or size cap (bypasses the 50MB + MIME allow-list presign enforces),
so a member can overwrite a gallery image with HTML/SVG served from the CDN origin.
Private prefixes national-ids/ support-attachments/ ARE correctly uid/admin gated
(s3-signed-url). Live PoC (authenticated) blocked by signup limits; logic is
unambiguous in source.

EDGE — MEDIUM, confirmed open live: seo-route-metadata (verify_jwt=false, no auth)
returns a post's content snippet + image_url for ANY post id via service-role
select, setting only noindex for non-public posts (index.ts resolvePost L313-331).
Live: endpoint returns 200 with NO auth header. Leak needs a known post UUID.

PAYMENTS/INTEGRITY (area 9) — pending DB confirm of unique indexes + wallet guard:
- paypal-capture-order (HIGH, code): treats any 422 as "already captured" and
  credits status=APPROVED (uncaptured) orders; amount from client order.
- cast-photo-vote (HIGH while vote rewards active, code): unvote path applies owner
  penalty with no check a vote existed; wallet_transaction permits negative for
  unvote_penalty — a member can drive a victim's wallet negative. Needs DB confirm
  of the CHECK/constraint + whether reward config active.
- wallet_transaction RPC (CRITICAL *iff* prod lacks the BUG-001 positive-credit
  guard): granted to authenticated; migration body has no guard, schema dump does.
  MUST confirm on production via PROBE 0901 FN body — top priority.
- Idempotency relies on unique indexes (razorpay/paypal) present in 2026-09-04
  staging baseline; production NOT yet confirmed.

SECRETS (area 10) — STRONG: 0 real secrets in 1722 commits; all keys public-by-
design. Minor: a diag PROBE hardcodes md5(member email); apply-migration cats SQL
+ output to a public log (reviewer is the only guard); ios-build logs cert pw
length. No pull_request_target / fork secret exposure.

AUTH (area 7) — partial: email signups for test domains rejected; email-send rate
limit active; email confirmation required (mailer_autoconfirm=false); no external
OAuth, phone off. Leaked-password protection + session length = UNKNOWN (server
settings not exposed). Staff MFA counts pending PROBE.

ANON SURFACE — STRONG so far: anon HTTP read of all ~179 tables returns rows on
only 7 public-content tables (ad_creatives, ad_videos, competition_round_publish,
featured_artists, photo_of_the_day, post_comment_reactions, user_badges).

DEPENDENCIES — npm audit: 14 high in prod deps (dompurify sanitizer-bypass and
react-router open-redirect/XSS are the client-facing ones).

## Still to prove (needs PROBE 0901 on staging+production)
RLS policy correctness per table; member-editable privilege columns + guard
triggers; every anon/authenticated SECURITY DEFINER function classification;
realtime publication RLS enforcement; table grants; storage bucket flags; wallet
constraints; staff MFA.
