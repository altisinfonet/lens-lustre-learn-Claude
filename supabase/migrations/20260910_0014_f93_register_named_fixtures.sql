-- F-93 — REGISTER THE TWO NAMED FIXTURES ON STAGING.
--
-- ═══ STAGING HOLDS 515 = 513 MEMBERS + 2 NAMED FIXTURES ═══
-- Nobody should ever read 515 as membership. The two are:
--
--   Rowan Ashgrove    rowan.ashgrove     id md5('f93-gap-proof-before-units')
--     Created BEFORE units 4/4b/5 were applied. Its custom_url was NULL and
--     stayed NULL after unit 4, which proves unit 4 is BEFORE INSERT only and
--     does not reach backwards. Unit 5 then repaired it. It is the C-34
--     evidence for "unit 5 repairs the rows created while the tap was open".
--
--   Marlowe Ashgrove  marlowe.ashgrove   id md5('f93-gap-proof-after-units')
--     Created AFTER unit 4. Received its custom_url at INSERT with one history
--     row. It is the C-34 evidence for "unit 4 closes the tap for new rows".
--
-- They are KEPT, not deleted. Deleting the only rows that demonstrate a defect
-- and its fix would leave the evidence file asserting a proof whose subject no
-- longer exists.
--
-- ═══ AUDITOR'S FINDING, RECORDED AS THE AUDITOR'S ═══
-- When the two fixture inserts were approved, the AFTER INSERT triggers on
-- public.profiles were not thought through. FIVE fired. Measured:
--
--   follows              1 each — each fixture now follows the official account,
--                        so its follower count is inflated by two
--   newsletter_subscribers 1 each, is_active=true, source='registration', for
--                        f93-gap-before@ and f93-gap-after@50mm-staging-fixture.invalid
--   custom_url_history   1 each
--   user_roles           1 each
--
-- So staging's newsletter list contained two INVENTED ADDRESSES that a send
-- would attempt to deliver to. That is the Auditor's damage, recorded here
-- rather than left in private notes, because a future reader finding two
-- .invalid addresses on a mailing list deserves to know how they got there.
--
-- ═══ WHAT IS CLEANED AND WHAT IS KEPT ═══
-- The newsletter rows are DEACTIVATED below. A send to a .invalid address
-- hard-bounces, and hard bounces damage sender reputation for every real
-- member — that is a live cost, not a cosmetic one. The rows are kept but
-- inactive so the record of what happened survives.
--
-- The follows are KEPT. Removing them is cosmetic; +2 on a staging fixture
-- account's follower count misleads nobody once it is written down here, and
-- deleting them would destroy part of the same trigger-cascade evidence.

UPDATE public.newsletter_subscribers
   SET is_active = false
 WHERE email IN ('f93-gap-before@50mm-staging-fixture.invalid',
                 'f93-gap-after@50mm-staging-fixture.invalid');

COMMENT ON TABLE public.newsletter_subscribers IS
  'Newsletter list. NOTE: two rows with @50mm-staging-fixture.invalid addresses exist on STAGING ONLY, created as a side effect of the F-93 C-34 fixtures via auto_subscribe_newsletter. They are is_active=false so no send attempts them. See migration 20260910_0014.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ THE PRODUCTION WARNING, AND THE DESIGN THAT ANSWERS IT.
--
-- The Auditor's warning: whatever runs on production must not do this. If a
-- production preflight created any fixture row it would fire the same five
-- triggers on the REAL newsletter list and the REAL follower counts.
--
-- THE ANSWER, and it is structural rather than careful:
--
--   THE PRODUCTION BACKFILL CREATES NOTHING. All five triggers that fired here
--   are AFTER INSERT ON public.profiles. The backfill only ever runs
--       UPDATE public.profiles SET custom_url = ... WHERE custom_url IS NULL
--   on rows that ALREADY EXIST. An UPDATE cannot fire an AFTER INSERT trigger.
--   So the cascade is not avoided by remembering to avoid it — it is
--   unreachable by construction.
--
--   THE PREFLIGHT IS READ-ONLY. It is a SELECT that reports, for each of the
--   members with no handle, the URL they would receive, plus
--   digit_from_identical_names and digit_from_collapsed_slugs separately. It
--   inserts nothing, updates nothing, and can be run as many times as anyone
--   wants without touching a row.
--
--   NO FIXTURE ACCOUNTS ON PRODUCTION, EVER. The hard cases are proven on
--   staging, which is what staging is for. Production has 113 real members and
--   no invented ones.
--
-- If a future change to the backfill needs to INSERT a profile on production,
-- that is a different operation with a different risk profile and it needs its
-- own authorisation — it is not covered by any approval given for this work.
