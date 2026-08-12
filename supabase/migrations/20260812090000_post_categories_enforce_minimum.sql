-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE B2 — ACTIVATE THE MANDATORY 1–5 CATEGORY MINIMUM
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ ⛔ DO NOT APPLY THIS UNTIL EVERY GATE BELOW IS VERIFIED.                   ║
-- ║                                                                           ║
-- ║ This file does exactly ONE thing: it restores the POST-CAT-002 block that ║
-- ║ B1 deliberately left out. Nothing else changes — same normaliser, same    ║
-- ║ slug validation, same post_kind pin, same POST-CAT-003. The function is   ║
-- ║ re-created in full because PL/pgSQL has no way to patch a body, so a      ║
-- ║ line-by-line diff against B1's version should show the added block and    ║
-- ║ NOTHING ELSE. If it shows anything else, something rode along — stop.     ║
-- ║                                                                           ║
-- ║ THE RELEASE GATES, per the owner 2026-08-12:                              ║
-- ║                                                                           ║
-- ║  1. Stage C is deployed and verified on the WEB. The composer sends 1–5   ║
-- ║     categories in the same INSERT and refuses to publish without one.     ║
-- ║                                                                           ║
-- ║  2. A new Android build carrying Stage C is PUBLISHED — same              ║
-- ║     applicationId, same signing key, higher versionCode — and members     ║
-- ║     have had time to take it.                                             ║
-- ║                                                                           ║
-- ║  3. ADOPTION IS MEASURED, NOT ASSUMED. A minimum-version gate cannot      ║
-- ║     help here: a gate only fires if it is already inside the INSTALLED    ║
-- ║     build, and today's builds have none. So the gate shipped in Stage C   ║
-- ║     protects the NEXT transition, not this one. For this one, measure:    ║
-- ║                                                                           ║
-- ║       SELECT platform, app_build, count(DISTINCT user_id) AS members      ║
-- ║       FROM public.client_errors                                           ║
-- ║       WHERE created_at > now() - interval '14 days'                       ║
-- ║       GROUP BY 1,2 ORDER BY members DESC;                                 ║
-- ║                                                                           ║
-- ║     `app_build` there is the bundled WEB deploy stamp, which is exactly   ║
-- ║     the right signal — it says whether that install carries the picker.   ║
-- ║     Caveat: client_errors only records when someone hits an error, so it  ║
-- ║     is a strong signal, not a census. On 2026-08-12 there were 30 app     ║
-- ║     members in total (push_tokens), so direct contact is also practical.  ║
-- ║                                                                           ║
-- ║  4. THE SCHEDULED QUEUE IS CLEAR. Re-run §0 below immediately before      ║
-- ║     applying. A pending row with zero categories WILL fail at publish     ║
-- ║     time once this is live. It fails cleanly and keeps the row — it is    ║
-- ║     not discarded and nothing is auto-assigned — but the member is not    ║
-- ║     told, so this must be handled deliberately, not discovered.           ║
-- ║     On 2026-08-12 the queue held one row, already published: zero at risk.║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- WHAT THIS MIGRATION DOES NOT DO, ON PURPOSE:
--   • It does NOT backfill categories onto any existing post.
--   • It does NOT reject posts created between B1 and B2. POST-CAT-002 is
--     INSERT-only, so those rows stay editable and simply remain visible under
--     "All" — the same treatment as the 204 posts that predate the feature.
--   • It does NOT touch the Feed RPC, the taxonomy, hashtags, or post_tags.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PRE-FLIGHT. Run this ALONE first and read it. Do not apply §1 until the
--    first row reads 0.
SELECT 'pending_scheduled_with_ZERO_categories' AS check,
       count(*)::text AS value                                                  -- must be 0
  FROM public.scheduled_posts
 WHERE status IN ('pending', 'publishing')
   AND cardinality(COALESCE(categories, '{}')) = 0
UNION ALL
SELECT 'pending_scheduled_total', count(*)::text
  FROM public.scheduled_posts WHERE status IN ('pending', 'publishing')
UNION ALL
SELECT 'B1_is_applied_first', count(*)::text FROM information_schema.columns
 WHERE table_schema='public' AND table_name='posts' AND column_name='categories' -- must be 1
UNION ALL
SELECT 'minimum_not_already_active', count(*)::text FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='enforce_post_categories'
   AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-002%';    -- must be 0


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE FUNCTION, WITH THE MINIMUM RESTORED.
--
-- Identical to B1's version except for the block marked ★. Compare them.
CREATE OR REPLACE FUNCTION public.enforce_post_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  _bad text;
  _n   integer;
  _client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  -- ── post_kind is not the client's to decide ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF _client THEN NEW.post_kind := 'member'; END IF;
  ELSE
    IF _client THEN NEW.post_kind := OLD.post_kind; END IF;
  END IF;

  -- ── normalise before validating ───────────────────────────────────────────
  NEW.categories := ARRAY(
    SELECT t.slug FROM (
      SELECT DISTINCT ON (lower(btrim(u.c)))
             lower(btrim(u.c)) AS slug, u.ord
      FROM unnest(COALESCE(NEW.categories, '{}')) WITH ORDINALITY AS u(c, ord)
      WHERE btrim(u.c) <> ''
      ORDER BY lower(btrim(u.c)), u.ord
    ) t
    ORDER BY t.ord
  );
  _n := cardinality(NEW.categories);

  -- ── every slug must exist in the taxonomy AND be active ───────────────────
  SELECT string_agg(c, ', ') INTO _bad
  FROM unnest(NEW.categories) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories cat WHERE cat.slug = c AND cat.is_active
  );
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CAT-001: unknown or inactive category slug(s): %', _bad
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- ★ THE ONLY DIFFERENCE FROM B1. Everything above and below is unchanged.
    --
    -- INSERT only, and only for member posts. A system post created by
    -- create_system_post() legitimately carries none, and an UPDATE is handled
    -- by POST-CAT-003 below — applying the minimum to every UPDATE would make
    -- every uncategorised post uneditable, which is precisely why this rule
    -- lives in a trigger and not in a CHECK constraint.
    IF NEW.post_kind = 'member' AND _n < 1 THEN
      RAISE EXCEPTION 'POST-CAT-002: a member post requires between 1 and 5 categories'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.post_kind = 'member'
       AND cardinality(COALESCE(OLD.categories, '{}')) > 0
       AND _n < 1 THEN
      RAISE EXCEPTION 'POST-CAT-003: a categorised post cannot have all its categories removed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- The trigger itself is NOT recreated. It already points at this function name
-- and its firing position (last of the five BEFORE triggers, alphabetically) is
-- unchanged. Dropping and recreating it would be a needless window in which the
-- table has no category validation at all.


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SELF-CHECK.
SELECT 'minimum_now_ACTIVE' AS check, count(*)::text AS value FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='enforce_post_categories'
   AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-002%'     -- 1
UNION ALL
SELECT 'strip_guard_still_active', count(*)::text FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='enforce_post_categories'
   AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-003%'     -- 1
UNION ALL
SELECT 'trigger_still_bound', count(*)::text FROM pg_trigger
 WHERE tgrelid='public.posts'::regclass AND tgname='trg_validate_post_categories' -- 1
UNION ALL
SELECT 'NO_existing_post_was_altered', count(*)::text FROM public.posts
 WHERE post_kind NOT IN ('member','system');                                    -- 0
