-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A — THE CATEGORY TAXONOMY
--
-- Owner, 2026-08-12: "The `categories` table must remain the single source of
-- truth for category name, slug, icon, sort order, and active status."
--
-- This migration creates that table, seeds the 46 master categories, and
-- migrates the existing member interest field onto the same vocabulary.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES **NOT** DO
--
-- It does not touch `posts`. No post gains a category here, no constraint is
-- added, no trigger fires on posting. That is Phase B, deliberately separate so
-- this one can ship and sit inert while the Create screens are designed.
--
-- It does not touch hashtags (`#word` parsed out of posts.content at read time),
-- `post_tags` (tagging PEOPLE in a photograph, with coordinates), the
-- Contributor Score functions, or the Active Engagement collector.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE MASTER TABLE
--
-- `slug` is the primary key and the STABLE identifier. It is what gets stored
-- on a post and on a member's interests. Owner, 2026-08-12: "Store stable slugs
-- […] that gives you flexibility later if you change the display name or
-- translate it."
--
-- So `name` is free to change and free to be overridden by a translation; the
-- slug never moves. This is the single most important property of the design —
-- it is what stops a rename from becoming a silent data migration, which is
-- exactly what `Astrophotography` -> `Astro` is having to be today (section 3).
CREATE TABLE IF NOT EXISTS public.categories (
  slug        text        PRIMARY KEY,
  name        text        NOT NULL,
  icon_name   text        NOT NULL,
  sort_order  smallint    NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Slugs are lower-case kebab-case, always. Enforced rather than trusted,
  -- because the slug is a storage key: one stray capital and
  -- `categories && ARRAY['Portrait']` silently matches nothing.
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT categories_sort_unique UNIQUE (sort_order)
);

COMMENT ON TABLE public.categories IS
  'The 46 master photography categories. Single source of truth for slug, display name, icon, strip order and active status. "All" is NOT a row here - it is a client-side system filter that applies no predicate.';
COMMENT ON COLUMN public.categories.slug IS
  'Stable storage key. Written into posts.categories and profiles.photography_interests. NEVER rename a slug - add a new row and migrate.';
COMMENT ON COLUMN public.categories.icon_name IS
  'A lucide-react export name. The client maps this to a component through a fixed allow-list, because a React component cannot live in a row.';
COMMENT ON COLUMN public.categories.sort_order IS
  'Controls the order of the horizontal strip, so which categories fall inside the visible width is an admin decision, not a code change.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE 46 CATEGORIES
--
-- Order: the seven from the owner's design mock first, in his order, then the
-- rest grouped by kinship. sort_order is what the strip reads, so items 1-7 are
-- the ones that land inside the visible width before scrolling.
--
-- TWO ICONS ARE HONEST COMPROMISES, both because lucide-react 0.462 has no such
-- glyph (checked programmatically, not assumed):
--   * `aerial`  -> Plane        (there is no Drone icon; `aviation` gets PlaneTakeoff)
--   * `equine`  -> Medal        (there is no Horse icon; Medal reads as equestrian)
-- Both are one UPDATE away from changing, and the label always sits beside the
-- icon, so neither is load-bearing.
INSERT INTO public.categories (slug, name, icon_name, sort_order) VALUES
  ('wildlife',        'Wildlife',        'PawPrint',     1),
  ('portrait',        'Portrait',        'User',         2),
  ('street',          'Street',          'Footprints',   3),
  ('landscape',       'Landscape',       'Mountain',     4),
  ('macro',           'Macro',           'Flower2',      5),
  ('travel',          'Travel',          'Luggage',      6),
  ('aerial',          'Aerial',          'Plane',        7),
  ('nature',          'Nature',          'Trees',        8),
  ('bird',            'Bird',            'Bird',         9),
  ('astro',           'Astro',           'Stars',       10),
  ('cityscape',       'Cityscape',       'Building2',   11),
  ('architecture',    'Architecture',    'Building',    12),
  ('documentary',     'Documentary',     'Newspaper',   13),
  ('photojournalism', 'Photojournalism', 'FileText',    14),
  ('fashion',         'Fashion',         'Shirt',       15),
  ('wedding',         'Wedding',         'Heart',       16),
  ('newborn-baby',    'Newborn & Baby',  'Baby',        17),
  ('sports',          'Sports',          'Trophy',      18),
  ('automotive',      'Automotive',      'Car',         19),
  ('aviation',        'Aviation',        'PlaneTakeoff',20),
  ('food',            'Food',            'Utensils',    21),
  ('product',         'Product',         'Package',     22),
  ('still-life',      'Still Life',      'Lamp',        23),
  ('commercial',      'Commercial',      'Briefcase',   24),
  ('industrial',      'Industrial',      'Factory',     25),
  ('real-estate',     'Real Estate',     'Home',        26),
  ('fine-art',        'Fine Art',        'Palette',     27),
  ('abstract',        'Abstract',        'Shapes',      28),
  ('minimalist',      'Minimalist',      'Minus',       29),
  ('black-and-white', 'Black & White',   'Contrast',    30),
  ('long-exposure',   'Long Exposure',   'Timer',       31),
  ('night',           'Night',           'Moon',        32),
  ('underwater',      'Underwater',      'Waves',       33),
  ('experimental',    'Experimental',    'FlaskConical',34),
  ('conceptual',      'Conceptual',      'Lightbulb',   35),
  ('mobile',          'Mobile',          'Smartphone',  36),
  ('film',            'Film',            'Film',        37),
  ('infrared',        'Infrared',        'Radio',       38),
  ('scientific',      'Scientific',      'Microscope',  39),
  ('cultural',        'Cultural',        'Landmark',    40),
  ('humanitarian',    'Humanitarian',    'HandHeart',   41),
  ('lifestyle',       'Lifestyle',       'Coffee',      42),
  ('event',           'Event',           'CalendarDays',43),
  ('pet',             'Pet',             'Dog',         44),
  ('equine',          'Equine',          'Medal',       45),
  ('digital-art',     'Digital Art',     'Wand2',       46)
ON CONFLICT (slug) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
--
-- The strip has to render for a signed-out visitor — `/hashtag/:tag` and the
-- feed already work that way by design — so the read policy covers `anon`.
-- Writes are admin-only: this is the source of truth, and a member reordering
-- the strip for everybody would be a real bug.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read categories" ON public.categories;
CREATE POLICY "Anyone can read categories"
  ON public.categories FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
CREATE POLICY "Admins manage categories"
  ON public.categories FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- PostgREST needs explicit privileges even with a permissive policy.
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL    ON public.categories TO service_role;

-- ⚠ AND THE REVOKE THAT MAKES THE GRANT ABOVE MEAN SOMETHING.
--
-- Supabase ships an ALTER DEFAULT PRIVILEGES rule that grants INSERT, UPDATE and
-- DELETE on every NEW table in `public` to anon and authenticated. So the GRANT
-- above does not narrow anything — the roles already hold everything, and the
-- table is left protected by RLS alone.
--
-- This was found on production 2026-08-12, AFTER a preflight on a throwaway
-- PostgreSQL had reported "SELECT only". The throwaway database had no default
-- privileges configured, so it could not reproduce the problem. The behaviour
-- was correct either way — RLS did hold, and a non-admin UPDATE touched 0 rows —
-- but one layer was doing the work of two.
--
-- Owner, 2026-08-12: "If this table is supposed to be read-only for users, don't
-- grant them write privileges in the first place."
--
-- With this, a member's write now fails with a hard `42501 permission denied`
-- instead of succeeding with zero rows changed — which is the far safer failure,
-- because a silent zero-row write is indistinguishable from one that worked.
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. THE AUDIT TABLE — created before section 4 needs it
--
-- Section 4 drops any label it cannot map, which loses a member's stated
-- interest. That is the right call — a value outside the taxonomy is exactly
-- what this table exists to prevent — but it must not happen quietly. Anything
-- that could not be mapped is captured here so it is auditable afterwards
-- rather than merely absent.
CREATE TABLE IF NOT EXISTS public.categories_migration_dropped (
  user_id     uuid        NOT NULL,
  old_label   text        NOT NULL,
  dropped_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.categories_migration_dropped ENABLE ROW LEVEL SECURITY;
-- RLS on, zero policies: an audit trail nobody needs to read through the API.
REVOKE ALL ON public.categories_migration_dropped FROM anon, authenticated;

COMMENT ON TABLE public.categories_migration_dropped IS
  'Audit of interest labels that could not be mapped to a category slug during the 2026-08-12 taxonomy migration. Expected to be empty. If it is not, those members silently lost an interest and it can be restored by hand from here.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MIGRATE `profiles.photography_interests` ONTO THE SAME VOCABULARY
--
-- Owner, 2026-08-12: "I would migrate them now as part of Phase A, because this
-- is exactly the moment to establish the taxonomy as the single source of truth.
-- You don't want Registration: Astrophotography while Post category: Astro."
--
-- Today that column stores ENGLISH DISPLAY LABELS, because the label was the
-- key: 'Wildlife', 'Astrophotography'. After this it stores SLUGS.
--
-- Fourteen of the fifteen old labels are an exact lower-cased match. One is not,
-- and it is the whole reason this section exists:
--
--     'Astrophotography'  ->  'astro'
--
-- Anything unrecognised is DROPPED rather than guessed at, and section 5 reports
-- exactly how many were dropped. Silently inventing a slug for an unknown label
-- would put a value in the column that the taxonomy does not contain, which is
-- the one thing this migration exists to prevent.
-- Capture the unmappable ones FIRST, while the old labels still exist.
INSERT INTO public.categories_migration_dropped (user_id, old_label)
SELECT pr.id, old_label
FROM public.profiles pr, unnest(pr.photography_interests) AS old_label
WHERE pr.photography_interests IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.slug = CASE lower(btrim(old_label))
                     WHEN 'astrophotography' THEN 'astro'
                     ELSE replace(lower(btrim(old_label)), ' ', '-')
                   END
  );

UPDATE public.profiles p
SET photography_interests = sub.mapped
FROM (
  SELECT
    pr.id,
    ARRAY(
      SELECT DISTINCT c.slug
      FROM unnest(pr.photography_interests) AS old_label
      JOIN public.categories c
        ON c.slug = CASE lower(btrim(old_label))
                      WHEN 'astrophotography' THEN 'astro'
                      ELSE replace(lower(btrim(old_label)), ' ', '-')
                    END
    ) AS mapped
  FROM public.profiles pr
  WHERE pr.photography_interests IS NOT NULL
    AND array_length(pr.photography_interests, 1) > 0
) AS sub
WHERE p.id = sub.id
  AND p.photography_interests IS DISTINCT FROM sub.mapped;

COMMENT ON COLUMN public.profiles.photography_interests IS
  'Category SLUGS from public.categories (migrated from English labels 2026-08-12). Same vocabulary as posts.categories, so matching a member to posts in their interests is a single && operator.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SELF-CHECK — printed by the migration, so a silent partial migration is
--    impossible to miss. Every row here must read 0 except the counts.
SELECT 'categories_seeded'        AS check, count(*)::text AS value FROM public.categories
UNION ALL
SELECT 'categories_active',        count(*)::text FROM public.categories WHERE is_active
UNION ALL
SELECT 'members_with_interests',   count(*)::text FROM public.profiles
  WHERE photography_interests IS NOT NULL AND array_length(photography_interests,1) > 0
UNION ALL
-- MUST BE 0. A non-zero value means a member is carrying an interest value that
-- is not in the taxonomy - i.e. the mapping above missed a label.
SELECT 'interests_NOT_in_taxonomy', count(*)::text FROM (
  SELECT DISTINCT x FROM public.profiles p, unnest(p.photography_interests) x
  WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.slug = x)
) t
UNION ALL
-- MUST BE 0. Anything left here is still an old-style display label.
SELECT 'interests_still_uppercase', count(*)::text FROM (
  SELECT DISTINCT x FROM public.profiles p, unnest(p.photography_interests) x
  WHERE x <> lower(x)
) t
UNION ALL
SELECT 'distinct_interest_slugs',  count(DISTINCT x)::text
  FROM public.profiles p, unnest(p.photography_interests) x
UNION ALL
-- SHOULD BE 0. Non-zero means some members lost an interest that could not be
-- mapped; the exact labels are in categories_migration_dropped.
SELECT 'LABELS_DROPPED', count(*)::text FROM public.categories_migration_dropped
UNION ALL
SELECT 'labels_dropped_detail',
  coalesce(string_agg(DISTINCT old_label, ', '), 'none')
  FROM public.categories_migration_dropped;
