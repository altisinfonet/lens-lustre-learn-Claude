-- ═══════════════════════════════════════════════════════════════════════════
-- F-93 SIGNUP CLOSURE — a new member gets a name-URL at INSERT, on production.
--
-- Owner authorised the client promotion; this is the database precondition.
--
-- ⚠ WHY THIS IS ONE FILE AND ONE TRANSACTION, AND WHY A ONE-FILE TRIGGER
--   PROMOTION WOULD HAVE BEEN THE WORST POSSIBLE OUTCOME.
--
-- tg_profiles_assign_custom_url wraps its call in
--     EXCEPTION WHEN others THEN RAISE WARNING ... NEW.custom_url := NULL;
-- That swallow is correct and deliberate — a broken generator must never
-- destroy a signup. But it means a trigger promoted WITHOUT its dependency
-- closure does not fail loudly. It fails SILENTLY: the signup succeeds, the row
-- lands with custom_url NULL, a warning goes to a Postgres log nobody reads,
-- and the new member renders as dead text on the live site while the trigger
-- LOOKS installed and working. A green that cannot go red, in production,
-- permanently.
--
-- Measured on production before this file was written — fourteen of the fifteen
-- objects the trigger needs were ABSENT:
--   ABSENT  reserved_custom_urls  transliteration_map  name_part_spellings
--   ABSENT  custom_url_fold_accents  custom_url_transliterate  custom_url_slug
--   ABSENT  custom_url_available  custom_url_ever_held  generate_custom_url
--   ABSENT  tg_custom_url_reject_reserved  tg_profiles_assign_custom_url
--   ABSENT  trg_custom_url_reject_reserved  trg_profiles_zz_assign_custom_url
--   PRESENT custom_url_history (table only)
--
-- One BEGIN/COMMIT: either the whole closure exists or none of it does. psql is
-- invoked here WITHOUT --single-transaction, so the explicit transaction in
-- this file is what makes that true.
--
-- ⚠ DEPENDENCY ORDER INSIDE THE TRANSACTION, and none of it is interchangeable:
--   1. the three guard tables (reserved_custom_urls with all 68 rows,
--      transliteration_map, name_part_spellings)
--   2. the six functions, leaf-first: custom_url_fold_accents,
--      custom_url_transliterate, custom_url_slug, custom_url_available,
--      custom_url_ever_held, generate_custom_url
--   3. tg_custom_url_reject_reserved and tg_profiles_assign_custom_url, then
--      their triggers
--   4. the REVOKE block. Not housekeeping, and not last by accident: it must
--      follow every CREATE, because a CREATE re-lands the grant a REVOKE took
--      away (F-66). Production's measured default for new functions in schema
--      public is {anon=X,authenticated=X,service_role=X}, and a bare CREATE
--      also lands the PUBLIC '=X/' entry, so without step 4 this file would
--      publish custom_url_available(text,uuid) and custom_url_ever_held(uuid)
--      — both SECURITY DEFINER, both taking an identity argument, neither
--      checking auth.uid() — to anon. That is F-105c's exact shape, opened on
--      the same night we closed it. See F-111 for why the tree did not already
--      carry these REVOKEs.
--
-- ⚠ THE GATE IS SIX ASSERTIONS AND EACH ONE WAS MADE TO FAIL BEFORE IT WAS
--   TRUSTED (C-34). G1 objects exist · G2 the reserved list is not empty ·
--   G3 a real signup receives an ASCII handle · G4 a reserved handle is refused
--   BY THE RESERVED GUARD · G5 the probe leaves nothing behind · G6 the closure
--   is closed, read from proacl and not from has_function_privilege (C-89).
--
-- INCLUDED ON THE AUDITOR'S RULING: trg_custom_url_reject_reserved. Same
-- dependency, no extra cost, and one layer where staging has two is a
-- difference that should not be signed off.
--
-- DELIBERATELY EXCLUDED: tg_profiles_record_custom_url_history and its trigger.
-- Production has the custom_url_history TABLE and no trigger writing to it, and
-- the 17-row backfill deliberately created no history rows. Leaving it absent
-- keeps production self-consistent; promoting it would start recording halfway
-- through a story. It gates nothing.
--
-- EVERY DEFINITION BELOW IS SLICED FROM THE STAGING MIGRATIONS THAT PRODUCED
-- THE RUNNING OBJECTS — 0006, 00065, 00066, 0007, 0009 and 0011 — not retyped
-- and not reconstructed from the catalogue.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;


-- ═══ 1a. reserved_custom_urls (68 rows) ═══

-- F-93 · unit 1 of 5 — the reserved namespace, as DATA rather than as code.
--
-- WHAT GOES WRONG WITHOUT THIS, said first.
-- The vanity route is a catch-all `/:customUrl` and every specific route is
-- matched BEFORE it. So a member whose URL equals a route's first segment is
-- UNREACHABLE — and nothing looks broken. No 404, no error, no log line. Under
-- the change window (unit 3) they would be stuck there for a year.
--
-- `page`, `post`, `entry`, `settings` and `admin` are ordinary English words,
-- and Page and Post are real surnames. A member whose full_name is the single
-- word "Page" generates `page` and disappears.
--
-- WHY A TABLE AND NOT AN ARRAY IN A FUNCTION.
-- There were already TWO hardcoded lists in this database that disagreed with
-- each other and with App.tsx: change_custom_url() carried 45 words including
-- `api`/`www`/`root` that no route uses, while missing `home`,
-- `notifications`, `scheduled-posts` and every static file. A list that must
-- be hand-edited whenever someone adds a page is a list that is wrong within a
-- month. This one is seeded from a derivation and CI re-derives it: see
-- scripts/check-reserved-urls.mjs, which reads App.tsx and public/ and fails
-- the build when a route exists with no reserved row.
--
-- The first attempt at this list was hand-built by grepping single-segment
-- routes (path="/x"). That pattern silently skipped every NESTED route —
-- path="/page/:slug" never matched — and the list came out eleven short. The
-- eleven were exactly the dangerous ones. That is why nothing here is copied.
--
-- Row counts at the time of writing: 39 route first-segments derived from
-- App.tsx, 13 statically served paths derived from public/ plus the build's
-- `assets` output directory, and 16 further words carried over from
-- change_custom_url()'s own list so that removing that hardcoded array loses
-- no coverage. 68 rows.
--
-- ⚠ The markers below are load-bearing. scripts/check-reserved-urls.mjs finds
-- the seeded values by scanning between them; delete them and the check cannot
-- tell what this migration seeds, so it would pass while proving nothing.

CREATE TABLE IF NOT EXISTS public.reserved_custom_urls (
  value      text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('route','static','legacy')),
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reserved_custom_urls IS
  'F-93. Names that must never be issued as a profile custom_url because a route or a statically served path already occupies that top-level address. Compared case-insensitively. Seeded by derivation from App.tsx and public/; CI re-derives via scripts/check-reserved-urls.mjs and fails when a route has no row here.';

ALTER TABLE public.reserved_custom_urls ENABLE ROW LEVEL SECURITY;

-- Readable by everyone: the signup form must be able to tell a member that a
-- name is unavailable BEFORE they try to claim it. There is nothing sensitive
-- here — every value is already a public URL on the site. Writes stay with the
-- migration role; no policy grants INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS reserved_custom_urls_readable ON public.reserved_custom_urls;
CREATE POLICY reserved_custom_urls_readable
  ON public.reserved_custom_urls FOR SELECT USING (true);

INSERT INTO public.reserved_custom_urls (value, kind, note) VALUES
-- BEGIN DERIVED RESERVED VALUES
  ('__crop-test', 'route', 'App.tsx route first segment'),
  ('ad', 'route', 'App.tsx route first segment'),
  ('admin', 'route', 'App.tsx route first segment'),
  ('certificate', 'route', 'App.tsx route first segment'),
  ('certificates', 'route', 'App.tsx route first segment'),
  ('competitions', 'route', 'App.tsx route first segment'),
  ('cookie-policy', 'route', 'App.tsx route first segment'),
  ('courses', 'route', 'App.tsx route first segment'),
  ('dashboard', 'route', 'App.tsx route first segment'),
  ('dev', 'route', 'App.tsx route first segment'),
  ('discover', 'route', 'App.tsx route first segment'),
  ('edit-profile', 'route', 'App.tsx route first segment'),
  ('entry', 'route', 'App.tsx route first segment'),
  ('featured-artist', 'route', 'App.tsx route first segment'),
  ('feed', 'route', 'App.tsx route first segment'),
  ('forgot-password', 'route', 'App.tsx route first segment'),
  ('friends', 'route', 'App.tsx route first segment'),
  ('hashtag', 'route', 'App.tsx route first segment'),
  ('help-support', 'route', 'App.tsx route first segment'),
  ('home', 'route', 'App.tsx route first segment'),
  ('idverification', 'route', 'App.tsx route first segment'),
  ('journal', 'route', 'App.tsx route first segment'),
  ('judge', 'route', 'App.tsx route first segment'),
  ('login', 'route', 'App.tsx route first segment'),
  ('notifications', 'route', 'App.tsx route first segment'),
  ('page', 'route', 'App.tsx route first segment'),
  ('photos', 'route', 'App.tsx route first segment'),
  ('post', 'route', 'App.tsx route first segment'),
  ('profile', 'route', 'App.tsx route first segment'),
  ('qa', 'route', 'App.tsx route first segment'),
  ('referrals', 'route', 'App.tsx route first segment'),
  ('reset-password', 'route', 'App.tsx route first segment'),
  ('scheduled-posts', 'route', 'App.tsx route first segment'),
  ('settings', 'route', 'App.tsx route first segment'),
  ('signup', 'route', 'App.tsx route first segment'),
  ('unsubscribe', 'route', 'App.tsx route first segment'),
  ('verify', 'route', 'App.tsx route first segment'),
  ('wallet', 'route', 'App.tsx route first segment'),
  ('winners', 'route', 'App.tsx route first segment'),
  ('_headers', 'static', 'served by the CDN before React loads'),
  ('apple-touch-icon.png', 'static', 'served by the CDN before React loads'),
  ('assets', 'static', 'served by the CDN before React loads'),
  ('avatars', 'static', 'served by the CDN before React loads'),
  ('favicon.png', 'static', 'served by the CDN before React loads'),
  ('images', 'static', 'served by the CDN before React loads'),
  ('llms.txt', 'static', 'served by the CDN before React loads'),
  ('manifest.json', 'static', 'served by the CDN before React loads'),
  ('og-image.png', 'static', 'served by the CDN before React loads'),
  ('placeholder.svg', 'static', 'served by the CDN before React loads'),
  ('robots.txt', 'static', 'served by the CDN before React loads'),
  ('sitemap.xml', 'static', 'served by the CDN before React loads'),
  ('sw-image-cache.js', 'static', 'served by the CDN before React loads'),
  ('api', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('www', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('root', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('system', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('support', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('help', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('contact', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('about', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('user', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('users', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('mail', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('ftp', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('cdn', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('static', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('media', 'legacy', 'carried over from change_custom_url()''s hardcoded list'),
  ('not-found', 'legacy', 'carried over from change_custom_url()''s hardcoded list')
-- END DERIVED RESERVED VALUES
ON CONFLICT (value) DO NOTHING;

-- ═══ 1b. transliteration_map + custom_url_transliterate ═══

-- F-93 · unit 2a — TRANSLITERATION. The URL is always English letters.
--
-- Owner's hard rule, 2026-09-05: "always all url will be in english. Name
-- নীল বসু but URL will be nil.basu always... hard rule. no other language."
--
-- SO STRIPPING IS FORBIDDEN AND SOUNDING-OUT IS REQUIRED. The earlier
-- behaviour reduced a Bengali name to nothing and fell back to member.<hex>;
-- that is now explicitly wrong. নীল বসু must produce nil.basu.
--
-- SCOPE, and it is deliberately not "all of Unicode". Production today holds
-- 110 plain ASCII names, 1 Cyrillic and 1 Bengali — and both non-Latin members
-- are among those with no URL, so both are in the backfill. Forward scope is
-- the five languages the app already ships translations for (bn, gu, hi, ta,
-- te) plus Cyrillic. All six are alphabetic and largely phonetic, so a
-- character-level mapping gives a defensible result. This is a mapping table,
-- not a language model.
--
-- ⚠ WHY THIS IS NOT A FLAT CHARACTER SWAP. The five Indic scripts are
-- abugidas: a consonant carries an INHERENT vowel 'a' which is replaced by a
-- following vowel sign (matra) or cancelled by a virama. A naive per-character
-- map gets নীল wrong in both directions — it either drops the vowel entirely
-- or emits it twice. The walk below tracks that pending inherent vowel:
--
--     নীল    ন = n, pending 'a'  →  ী is a matra, so 'a' is replaced by 'i'
--                                →  ল = l, pending 'a'
--                                →  word ends: final schwa deleted  ⇒  nil
--     বসু    ব = b, pending 'a'  →  স is a consonant, so 'a' is emitted
--                                →  ু is a matra ⇒ 'u'                ⇒ basu
--
-- Word-final schwa deletion applies to Bengali, Devanagari and Gujarati, where
-- it matches how the names are actually said. It is NOT applied to Tamil or
-- Telugu, whose words ordinarily keep that final vowel (రామ is rama, not ram).
--
-- ⚠ HAN, JAPANESE AND KOREAN ARE DELIBERATELY NOT MAPPED, and this is the case
-- worth naming rather than guessing. They are not per-character phonetic the
-- way these six are: Chinese needs a pinyin dictionary, and a naive character
-- map produces something that looks like a name and is nonsense to the person
-- whose name it is. There are zero such members. Anything this table does not
-- map therefore falls through to the documented fallback in
-- generate_custom_url() — member.<8 hex of id> — which is deterministic and,
-- since the 12-month change window now exists, no longer a trap: the member
-- can change it, and an admin can change it for them the same day.

CREATE TABLE IF NOT EXISTS public.transliteration_map (
  ch     text PRIMARY KEY,
  script text NOT NULL,
  latin  text NOT NULL,
  kind   text NOT NULL CHECK (kind IN ('letter','vowel','matra','consonant','virama','sign'))
);

COMMENT ON TABLE public.transliteration_map IS
  'F-93. Character-level romanisation for Cyrillic and the five Indic scripts the app ships translations for. kind drives inherent-vowel handling: consonants carry a pending "a" that a matra replaces and a virama cancels. Han/Japanese/Korean are intentionally absent — they are not per-character phonetic and a naive map would produce a plausible-looking nonsense name.';

ALTER TABLE public.transliteration_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transliteration_map_readable ON public.transliteration_map;
CREATE POLICY transliteration_map_readable ON public.transliteration_map FOR SELECT USING (true);

INSERT INTO public.transliteration_map (script, ch, latin, kind) VALUES
  ('cyrillic', 'а', 'a', 'letter'),
  ('cyrillic', 'б', 'b', 'letter'),
  ('cyrillic', 'в', 'v', 'letter'),
  ('cyrillic', 'г', 'g', 'letter'),
  ('cyrillic', 'д', 'd', 'letter'),
  ('cyrillic', 'е', 'e', 'letter'),
  ('cyrillic', 'ё', 'yo', 'letter'),
  ('cyrillic', 'ж', 'zh', 'letter'),
  ('cyrillic', 'з', 'z', 'letter'),
  ('cyrillic', 'и', 'i', 'letter'),
  ('cyrillic', 'й', 'y', 'letter'),
  ('cyrillic', 'к', 'k', 'letter'),
  ('cyrillic', 'л', 'l', 'letter'),
  ('cyrillic', 'м', 'm', 'letter'),
  ('cyrillic', 'н', 'n', 'letter'),
  ('cyrillic', 'о', 'o', 'letter'),
  ('cyrillic', 'п', 'p', 'letter'),
  ('cyrillic', 'р', 'r', 'letter'),
  ('cyrillic', 'с', 's', 'letter'),
  ('cyrillic', 'т', 't', 'letter'),
  ('cyrillic', 'у', 'u', 'letter'),
  ('cyrillic', 'ф', 'f', 'letter'),
  ('cyrillic', 'х', 'kh', 'letter'),
  ('cyrillic', 'ц', 'ts', 'letter'),
  ('cyrillic', 'ч', 'ch', 'letter'),
  ('cyrillic', 'ш', 'sh', 'letter'),
  ('cyrillic', 'щ', 'shch', 'letter'),
  ('cyrillic', 'ъ', '', 'letter'),
  ('cyrillic', 'ы', 'y', 'letter'),
  ('cyrillic', 'ь', '', 'letter'),
  ('cyrillic', 'э', 'e', 'letter'),
  ('cyrillic', 'ю', 'yu', 'letter'),
  ('cyrillic', 'я', 'ya', 'letter'),
  ('cyrillic', 'і', 'i', 'letter'),
  ('cyrillic', 'ї', 'yi', 'letter'),
  ('cyrillic', 'є', 'ye', 'letter'),
  ('cyrillic', 'ґ', 'g', 'letter'),
  ('cyrillic', 'ѓ', 'g', 'letter'),
  ('cyrillic', 'ђ', 'dj', 'letter'),
  ('cyrillic', 'ј', 'j', 'letter'),
  ('cyrillic', 'љ', 'lj', 'letter'),
  ('cyrillic', 'њ', 'nj', 'letter'),
  ('cyrillic', 'ћ', 'c', 'letter'),
  ('cyrillic', 'џ', 'dz', 'letter'),
  ('cyrillic', 'ў', 'u', 'letter'),
  ('bengali', 'অ', 'a', 'vowel'),
  ('bengali', 'আ', 'a', 'vowel'),
  ('bengali', 'ই', 'i', 'vowel'),
  ('bengali', 'ঈ', 'i', 'vowel'),
  ('bengali', 'উ', 'u', 'vowel'),
  ('bengali', 'ঊ', 'u', 'vowel'),
  ('bengali', 'ঋ', 'ri', 'vowel'),
  ('bengali', 'এ', 'e', 'vowel'),
  ('bengali', 'ঐ', 'oi', 'vowel'),
  ('bengali', 'ও', 'o', 'vowel'),
  ('bengali', 'ঔ', 'ou', 'vowel'),
  ('bengali', 'া', 'a', 'matra'),
  ('bengali', 'ি', 'i', 'matra'),
  ('bengali', 'ী', 'i', 'matra'),
  ('bengali', 'ু', 'u', 'matra'),
  ('bengali', 'ূ', 'u', 'matra'),
  ('bengali', 'ৃ', 'ri', 'matra'),
  ('bengali', 'ে', 'e', 'matra'),
  ('bengali', 'ৈ', 'oi', 'matra'),
  ('bengali', 'ো', 'o', 'matra'),
  ('bengali', 'ৌ', 'ou', 'matra'),
  ('bengali', 'ক', 'k', 'consonant'),
  ('bengali', 'খ', 'kh', 'consonant'),
  ('bengali', 'গ', 'g', 'consonant'),
  ('bengali', 'ঘ', 'gh', 'consonant'),
  ('bengali', 'ঙ', 'ng', 'consonant'),
  ('bengali', 'চ', 'ch', 'consonant'),
  ('bengali', 'ছ', 'chh', 'consonant'),
  ('bengali', 'জ', 'j', 'consonant'),
  ('bengali', 'ঝ', 'jh', 'consonant'),
  ('bengali', 'ঞ', 'n', 'consonant'),
  ('bengali', 'ট', 't', 'consonant'),
  ('bengali', 'ঠ', 'th', 'consonant'),
  ('bengali', 'ড', 'd', 'consonant'),
  ('bengali', 'ঢ', 'dh', 'consonant'),
  ('bengali', 'ণ', 'n', 'consonant'),
  ('bengali', 'ত', 't', 'consonant'),
  ('bengali', 'থ', 'th', 'consonant'),
  ('bengali', 'দ', 'd', 'consonant'),
  ('bengali', 'ধ', 'dh', 'consonant'),
  ('bengali', 'ন', 'n', 'consonant'),
  ('bengali', 'প', 'p', 'consonant'),
  ('bengali', 'ফ', 'ph', 'consonant'),
  ('bengali', 'ব', 'b', 'consonant'),
  ('bengali', 'ভ', 'bh', 'consonant'),
  ('bengali', 'ম', 'm', 'consonant'),
  ('bengali', 'য', 'j', 'consonant'),
  ('bengali', 'র', 'r', 'consonant'),
  ('bengali', 'ল', 'l', 'consonant'),
  ('bengali', 'শ', 'sh', 'consonant'),
  ('bengali', 'ষ', 'sh', 'consonant'),
  ('bengali', 'স', 's', 'consonant'),
  ('bengali', 'হ', 'h', 'consonant'),
  ('bengali', 'ড়', 'r', 'consonant'),
  ('bengali', 'ঢ়', 'rh', 'consonant'),
  ('bengali', 'য়', 'y', 'consonant'),
  ('bengali', 'ৎ', 't', 'consonant'),
  ('bengali', 'ং', 'ng', 'sign'),
  ('bengali', 'ঃ', 'h', 'sign'),
  ('bengali', 'ঁ', '', 'sign'),
  ('bengali', '্', '', 'virama'),
  ('devanagari', 'अ', 'a', 'vowel'),
  ('devanagari', 'आ', 'a', 'vowel'),
  ('devanagari', 'इ', 'i', 'vowel'),
  ('devanagari', 'ई', 'i', 'vowel'),
  ('devanagari', 'उ', 'u', 'vowel'),
  ('devanagari', 'ऊ', 'u', 'vowel'),
  ('devanagari', 'ऋ', 'ri', 'vowel'),
  ('devanagari', 'ए', 'e', 'vowel'),
  ('devanagari', 'ऐ', 'ai', 'vowel'),
  ('devanagari', 'ओ', 'o', 'vowel'),
  ('devanagari', 'औ', 'au', 'vowel'),
  ('devanagari', 'ा', 'a', 'matra'),
  ('devanagari', 'ि', 'i', 'matra'),
  ('devanagari', 'ी', 'i', 'matra'),
  ('devanagari', 'ु', 'u', 'matra'),
  ('devanagari', 'ू', 'u', 'matra'),
  ('devanagari', 'ृ', 'ri', 'matra'),
  ('devanagari', 'े', 'e', 'matra'),
  ('devanagari', 'ै', 'ai', 'matra'),
  ('devanagari', 'ो', 'o', 'matra'),
  ('devanagari', 'ौ', 'au', 'matra'),
  ('devanagari', 'क', 'k', 'consonant'),
  ('devanagari', 'ख', 'kh', 'consonant'),
  ('devanagari', 'ग', 'g', 'consonant'),
  ('devanagari', 'घ', 'gh', 'consonant'),
  ('devanagari', 'ङ', 'ng', 'consonant'),
  ('devanagari', 'च', 'ch', 'consonant'),
  ('devanagari', 'छ', 'chh', 'consonant'),
  ('devanagari', 'ज', 'j', 'consonant'),
  ('devanagari', 'झ', 'jh', 'consonant'),
  ('devanagari', 'ञ', 'n', 'consonant'),
  ('devanagari', 'ट', 't', 'consonant'),
  ('devanagari', 'ठ', 'th', 'consonant'),
  ('devanagari', 'ड', 'd', 'consonant'),
  ('devanagari', 'ढ', 'dh', 'consonant'),
  ('devanagari', 'ण', 'n', 'consonant'),
  ('devanagari', 'त', 't', 'consonant'),
  ('devanagari', 'थ', 'th', 'consonant'),
  ('devanagari', 'द', 'd', 'consonant'),
  ('devanagari', 'ध', 'dh', 'consonant'),
  ('devanagari', 'न', 'n', 'consonant'),
  ('devanagari', 'प', 'p', 'consonant'),
  ('devanagari', 'फ', 'ph', 'consonant'),
  ('devanagari', 'ब', 'b', 'consonant'),
  ('devanagari', 'भ', 'bh', 'consonant'),
  ('devanagari', 'म', 'm', 'consonant'),
  ('devanagari', 'य', 'y', 'consonant'),
  ('devanagari', 'र', 'r', 'consonant'),
  ('devanagari', 'ल', 'l', 'consonant'),
  ('devanagari', 'व', 'v', 'consonant'),
  ('devanagari', 'श', 'sh', 'consonant'),
  ('devanagari', 'ष', 'sh', 'consonant'),
  ('devanagari', 'स', 's', 'consonant'),
  ('devanagari', 'ह', 'h', 'consonant'),
  ('devanagari', 'क़', 'q', 'consonant'),
  ('devanagari', 'ख़', 'kh', 'consonant'),
  ('devanagari', 'ग़', 'g', 'consonant'),
  ('devanagari', 'ज़', 'z', 'consonant'),
  ('devanagari', 'ड़', 'r', 'consonant'),
  ('devanagari', 'ढ़', 'rh', 'consonant'),
  ('devanagari', 'फ़', 'f', 'consonant'),
  ('devanagari', 'ळ', 'l', 'consonant'),
  ('devanagari', 'ं', 'n', 'sign'),
  ('devanagari', 'ः', 'h', 'sign'),
  ('devanagari', 'ँ', 'n', 'sign'),
  ('devanagari', '्', '', 'virama'),
  ('gujarati', 'અ', 'a', 'vowel'),
  ('gujarati', 'આ', 'a', 'vowel'),
  ('gujarati', 'ઇ', 'i', 'vowel'),
  ('gujarati', 'ઈ', 'i', 'vowel'),
  ('gujarati', 'ઉ', 'u', 'vowel'),
  ('gujarati', 'ઊ', 'u', 'vowel'),
  ('gujarati', 'ઋ', 'ri', 'vowel'),
  ('gujarati', 'એ', 'e', 'vowel'),
  ('gujarati', 'ઐ', 'ai', 'vowel'),
  ('gujarati', 'ઓ', 'o', 'vowel'),
  ('gujarati', 'ઔ', 'au', 'vowel'),
  ('gujarati', 'ા', 'a', 'matra'),
  ('gujarati', 'િ', 'i', 'matra'),
  ('gujarati', 'ી', 'i', 'matra'),
  ('gujarati', 'ુ', 'u', 'matra'),
  ('gujarati', 'ૂ', 'u', 'matra'),
  ('gujarati', 'ૃ', 'ri', 'matra'),
  ('gujarati', 'ે', 'e', 'matra'),
  ('gujarati', 'ૈ', 'ai', 'matra'),
  ('gujarati', 'ો', 'o', 'matra'),
  ('gujarati', 'ૌ', 'au', 'matra'),
  ('gujarati', 'ક', 'k', 'consonant'),
  ('gujarati', 'ખ', 'kh', 'consonant'),
  ('gujarati', 'ગ', 'g', 'consonant'),
  ('gujarati', 'ઘ', 'gh', 'consonant'),
  ('gujarati', 'ઙ', 'ng', 'consonant'),
  ('gujarati', 'ચ', 'ch', 'consonant'),
  ('gujarati', 'છ', 'chh', 'consonant'),
  ('gujarati', 'જ', 'j', 'consonant'),
  ('gujarati', 'ઝ', 'jh', 'consonant'),
  ('gujarati', 'ઞ', 'n', 'consonant'),
  ('gujarati', 'ટ', 't', 'consonant'),
  ('gujarati', 'ઠ', 'th', 'consonant'),
  ('gujarati', 'ડ', 'd', 'consonant'),
  ('gujarati', 'ઢ', 'dh', 'consonant'),
  ('gujarati', 'ણ', 'n', 'consonant'),
  ('gujarati', 'ત', 't', 'consonant'),
  ('gujarati', 'થ', 'th', 'consonant'),
  ('gujarati', 'દ', 'd', 'consonant'),
  ('gujarati', 'ધ', 'dh', 'consonant'),
  ('gujarati', 'ન', 'n', 'consonant'),
  ('gujarati', 'પ', 'p', 'consonant'),
  ('gujarati', 'ફ', 'ph', 'consonant'),
  ('gujarati', 'બ', 'b', 'consonant'),
  ('gujarati', 'ભ', 'bh', 'consonant'),
  ('gujarati', 'મ', 'm', 'consonant'),
  ('gujarati', 'ય', 'y', 'consonant'),
  ('gujarati', 'ર', 'r', 'consonant'),
  ('gujarati', 'લ', 'l', 'consonant'),
  ('gujarati', 'વ', 'v', 'consonant'),
  ('gujarati', 'શ', 'sh', 'consonant'),
  ('gujarati', 'ષ', 'sh', 'consonant'),
  ('gujarati', 'સ', 's', 'consonant'),
  ('gujarati', 'હ', 'h', 'consonant'),
  ('gujarati', 'ળ', 'l', 'consonant'),
  ('gujarati', 'ં', 'n', 'sign'),
  ('gujarati', 'ઃ', 'h', 'sign'),
  ('gujarati', 'ઁ', 'n', 'sign'),
  ('gujarati', '્', '', 'virama'),
  ('tamil', 'அ', 'a', 'vowel'),
  ('tamil', 'ஆ', 'a', 'vowel'),
  ('tamil', 'இ', 'i', 'vowel'),
  ('tamil', 'ஈ', 'i', 'vowel'),
  ('tamil', 'உ', 'u', 'vowel'),
  ('tamil', 'ஊ', 'u', 'vowel'),
  ('tamil', 'எ', 'e', 'vowel'),
  ('tamil', 'ஏ', 'e', 'vowel'),
  ('tamil', 'ஐ', 'ai', 'vowel'),
  ('tamil', 'ஒ', 'o', 'vowel'),
  ('tamil', 'ஓ', 'o', 'vowel'),
  ('tamil', 'ஔ', 'au', 'vowel'),
  ('tamil', 'ா', 'a', 'matra'),
  ('tamil', 'ி', 'i', 'matra'),
  ('tamil', 'ீ', 'i', 'matra'),
  ('tamil', 'ு', 'u', 'matra'),
  ('tamil', 'ூ', 'u', 'matra'),
  ('tamil', 'ெ', 'e', 'matra'),
  ('tamil', 'ே', 'e', 'matra'),
  ('tamil', 'ை', 'ai', 'matra'),
  ('tamil', 'ொ', 'o', 'matra'),
  ('tamil', 'ோ', 'o', 'matra'),
  ('tamil', 'ௌ', 'au', 'matra'),
  ('tamil', 'க', 'k', 'consonant'),
  ('tamil', 'ங', 'ng', 'consonant'),
  ('tamil', 'ச', 'ch', 'consonant'),
  ('tamil', 'ஞ', 'n', 'consonant'),
  ('tamil', 'ட', 't', 'consonant'),
  ('tamil', 'ண', 'n', 'consonant'),
  ('tamil', 'த', 'th', 'consonant'),
  ('tamil', 'ந', 'n', 'consonant'),
  ('tamil', 'ப', 'p', 'consonant'),
  ('tamil', 'ம', 'm', 'consonant'),
  ('tamil', 'ய', 'y', 'consonant'),
  ('tamil', 'ர', 'r', 'consonant'),
  ('tamil', 'ல', 'l', 'consonant'),
  ('tamil', 'வ', 'v', 'consonant'),
  ('tamil', 'ழ', 'zh', 'consonant'),
  ('tamil', 'ள', 'l', 'consonant'),
  ('tamil', 'ற', 'r', 'consonant'),
  ('tamil', 'ன', 'n', 'consonant'),
  ('tamil', 'ஜ', 'j', 'consonant'),
  ('tamil', 'ஷ', 'sh', 'consonant'),
  ('tamil', 'ஸ', 's', 'consonant'),
  ('tamil', 'ஹ', 'h', 'consonant'),
  ('tamil', 'க்ஷ', 'ksh', 'consonant'),
  ('tamil', '்', '', 'virama'),
  ('telugu', 'అ', 'a', 'vowel'),
  ('telugu', 'ఆ', 'a', 'vowel'),
  ('telugu', 'ఇ', 'i', 'vowel'),
  ('telugu', 'ఈ', 'i', 'vowel'),
  ('telugu', 'ఉ', 'u', 'vowel'),
  ('telugu', 'ఊ', 'u', 'vowel'),
  ('telugu', 'ఋ', 'ri', 'vowel'),
  ('telugu', 'ఎ', 'e', 'vowel'),
  ('telugu', 'ఏ', 'e', 'vowel'),
  ('telugu', 'ఐ', 'ai', 'vowel'),
  ('telugu', 'ఒ', 'o', 'vowel'),
  ('telugu', 'ఓ', 'o', 'vowel'),
  ('telugu', 'ఔ', 'au', 'vowel'),
  ('telugu', 'ా', 'a', 'matra'),
  ('telugu', 'ి', 'i', 'matra'),
  ('telugu', 'ీ', 'i', 'matra'),
  ('telugu', 'ు', 'u', 'matra'),
  ('telugu', 'ూ', 'u', 'matra'),
  ('telugu', 'ృ', 'ri', 'matra'),
  ('telugu', 'ె', 'e', 'matra'),
  ('telugu', 'ే', 'e', 'matra'),
  ('telugu', 'ై', 'ai', 'matra'),
  ('telugu', 'ొ', 'o', 'matra'),
  ('telugu', 'ో', 'o', 'matra'),
  ('telugu', 'ౌ', 'au', 'matra'),
  ('telugu', 'క', 'k', 'consonant'),
  ('telugu', 'ఖ', 'kh', 'consonant'),
  ('telugu', 'గ', 'g', 'consonant'),
  ('telugu', 'ఘ', 'gh', 'consonant'),
  ('telugu', 'ఙ', 'ng', 'consonant'),
  ('telugu', 'చ', 'ch', 'consonant'),
  ('telugu', 'ఛ', 'chh', 'consonant'),
  ('telugu', 'జ', 'j', 'consonant'),
  ('telugu', 'ఝ', 'jh', 'consonant'),
  ('telugu', 'ఞ', 'n', 'consonant'),
  ('telugu', 'ట', 't', 'consonant'),
  ('telugu', 'ఠ', 'th', 'consonant'),
  ('telugu', 'డ', 'd', 'consonant'),
  ('telugu', 'ఢ', 'dh', 'consonant'),
  ('telugu', 'ణ', 'n', 'consonant'),
  ('telugu', 'త', 't', 'consonant'),
  ('telugu', 'థ', 'th', 'consonant'),
  ('telugu', 'ద', 'd', 'consonant'),
  ('telugu', 'ధ', 'dh', 'consonant'),
  ('telugu', 'న', 'n', 'consonant'),
  ('telugu', 'ప', 'p', 'consonant'),
  ('telugu', 'ఫ', 'ph', 'consonant'),
  ('telugu', 'బ', 'b', 'consonant'),
  ('telugu', 'భ', 'bh', 'consonant'),
  ('telugu', 'మ', 'm', 'consonant'),
  ('telugu', 'య', 'y', 'consonant'),
  ('telugu', 'ర', 'r', 'consonant'),
  ('telugu', 'ల', 'l', 'consonant'),
  ('telugu', 'వ', 'v', 'consonant'),
  ('telugu', 'శ', 'sh', 'consonant'),
  ('telugu', 'ష', 'sh', 'consonant'),
  ('telugu', 'స', 's', 'consonant'),
  ('telugu', 'హ', 'h', 'consonant'),
  ('telugu', 'ళ', 'l', 'consonant'),
  ('telugu', 'ఱ', 'r', 'consonant'),
  ('telugu', 'ం', 'n', 'sign'),
  ('telugu', 'ః', 'h', 'sign'),
  ('telugu', '్', '', 'virama')
ON CONFLICT (ch) DO NOTHING;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_url_transliterate(_s text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _out     text := '';
  _i       int;
  _ch      text;
  _m       record;
  _pending boolean := false;   -- a consonant's inherent 'a' not yet emitted
  _schwa   boolean := false;   -- does this string use a schwa-deleting script?
  _prev_virama boolean := false;  -- the previous character was a virama
  _in_conjunct boolean := false;  -- the current consonant closes a conjunct cluster
BEGIN
  IF _s IS NULL OR _s = '' THEN RETURN ''; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transliteration_map m
     WHERE m.script IN ('bengali','devanagari','gujarati')
       AND position(m.ch in _s) > 0
  ) INTO _schwa;

  FOR _i IN 1..length(_s) LOOP
    _ch := substr(_s, _i, 1);
    SELECT latin, kind INTO _m FROM public.transliteration_map WHERE ch = _ch;

    IF _m.kind IS NULL THEN
      -- Not a mapped character: ASCII, punctuation, or an unmapped script.
      --
      -- ⚠ SCHWA DELETION IS A WORD-BOUNDARY RULE, NOT AN END-OF-STRING RULE.
      -- Getting this wrong failed the Owner's own example: with the drop
      -- applied only after the loop, "নীল বসু" came out "nila basu" — the ল
      -- ending the first word flushed its inherent 'a' on reaching the space.
      -- A separator ends a word, so the pending vowel is DROPPED there for the
      -- schwa-deleting scripts. It is still flushed before an alphanumeric, so
      -- a mixed name like "নীলX" does not lose the vowel mid-word.
      -- ⚠ AND THE DELETION IS SUPPRESSED AFTER A CONJUNCT. Bengali drops the
      -- final inherent vowel after a simple coda (নীল -> nil) but KEEPS it
      -- after a consonant cluster (দত্ত -> datta, not "datt"). Without this the
      -- Owner's second example lost its final syllable entirely.
      IF _pending THEN
        IF _schwa AND _ch ~ '[^[:alnum:]]' AND NOT _in_conjunct THEN
          _pending := false;
        ELSE
          _out := _out || 'a'; _pending := false;
        END IF;
      END IF;
      _out := _out || _ch;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'consonant' THEN
      IF _pending THEN _out := _out || 'a'; END IF;
      _out := _out || _m.latin;
      _pending := true;
      _in_conjunct := _prev_virama;   -- a virama immediately before means this closes a cluster
      _prev_virama := false;

    ELSIF _m.kind = 'matra' THEN
      _pending := false;                      -- the sign REPLACES the inherent vowel
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'virama' THEN
      _pending := false;                      -- the inherent vowel is cancelled outright
      _prev_virama := true;

    ELSE                                      -- 'letter' (Cyrillic), 'vowel', 'sign'
      IF _pending THEN _out := _out || 'a'; _pending := false; END IF;
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;
    END IF;
  END LOOP;

  -- Word-final inherent vowel. Kept for Tamil and Telugu, dropped for the
  -- schwa-deleting scripts — this is what makes নীল "nil" and not "nila".
  IF _pending AND (NOT _schwa OR _in_conjunct) THEN _out := _out || 'a'; END IF;

  RETURN _out;
END;
$$;

COMMENT ON FUNCTION public.custom_url_transliterate(text) IS
  'F-93. Romanises Cyrillic and the five Indic scripts per the Owner''s rule that a URL is always English letters. Handles the abugida inherent vowel rather than swapping characters one for one. Unmapped scripts (Han, Japanese, Korean) pass through unchanged and are then handled by generate_custom_url''s member.<hex> fallback.';

-- ═══ 1c. name_part_spellings ═══

-- F-93 · unit 2b — CONVENTIONAL SPELLINGS. Consulted BEFORE the phonetic walk.
--
-- ⚠ READ THIS BEFORE EXTENDING OR TRUSTING THIS TABLE. It encodes CONVENTION,
-- NOT PHONETICS, and the two genuinely disagree. The phonetic walk in
-- custom_url_transliterate() is correct Bengali: দত্ত is /dɔt̪t̪o/ and romanises
-- systematically to "datta". But the people who carry that surname write it
-- "Dutta" in English, and that is what belongs in their URL. Likewise
-- চট্টোপাধ্যায় is phonetically Chattopadhyay and is written Chatterjee.
--
-- WHY A TABLE AT ALL. No character-level map can produce "dutta" from দত্ত.
-- The Bengali inherent vowel is one phoneme and would have to romanise as 'u'
-- in দত্ত and 'a' in বসু — and inside দত্ত alone it would have to be 'u' then
-- 'a'. That is not a gap in the mapping, it is a contradiction, so the walk
-- cannot be taught its way there by any rule. Convention has to be recorded.
--
-- THE HONEST LIMITATION, recorded rather than concealed:
--   * This list WILL NEVER BE COMPLETE. Bengali alone has thousands of
--     surnames and several accepted spellings each; Dutta/Datta/Dutt are all
--     in use by different families for the same name.
--   * A member whose surname is absent gets the phonetic form, which is
--     defensible but may not be the spelling they use themselves.
--   * That is survivable ONLY because the 12-month change window exists: the
--     member can correct their own URL, and an admin can correct it the same
--     day. Before that window existed this table would have been a trap.
--
-- ⚠ WHOLE NAME PARTS ONLY, NEVER SUBSTRINGS. The lookup is an equality match
-- on one whitespace-delimited part. Substring matching would corrupt unrelated
-- names that merely contain these letters, and it would be invisible when it
-- did. The safe cross-check is নীল বসু: বসু is in this table as 'basu', which
-- is ALSO what the phonetic walk produces, so if nil.basu ever breaks after a
-- change here, the matching has become greedy.

CREATE TABLE IF NOT EXISTS public.name_part_spellings (
  part   text PRIMARY KEY,
  latin  text NOT NULL CHECK (latin ~ '^[a-z0-9]+$'),
  script text NOT NULL,
  note   text NOT NULL DEFAULT ''
);

COMMENT ON TABLE public.name_part_spellings IS
  'F-93. Conventional English spellings for whole name parts, consulted before the phonetic transliteration walk. Encodes convention rather than phonetics (দত্ত -> dutta, not the phonetically correct datta). Matched on a complete whitespace-delimited part only — never a substring. Necessarily incomplete; a member whose name is absent receives the phonetic form and can change it under the 12-month window.';

ALTER TABLE public.name_part_spellings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS name_part_spellings_readable ON public.name_part_spellings;
CREATE POLICY name_part_spellings_readable ON public.name_part_spellings FOR SELECT USING (true);

INSERT INTO public.name_part_spellings (part, latin, script, note) VALUES
  ('দত্ত',           'dutta',        'bengali', 'Owner ruling 2026-09-05: shirshendu.dutta is final. Phonetic walk gives datta.'),
  ('চট্টোপাধ্যায়',  'chatterjee',   'bengali', 'Anglicised form; phonetic is chattopadhyay'),
  ('চ্যাটার্জী',     'chatterjee',   'bengali', 'already-Anglicised Bengali spelling'),
  ('বন্দ্যোপাধ্যায়','banerjee',     'bengali', 'Anglicised form; phonetic is bandyopadhyay'),
  ('ব্যানার্জী',     'banerjee',     'bengali', 'already-Anglicised Bengali spelling'),
  ('মুখোপাধ্যায়',   'mukherjee',    'bengali', 'Anglicised form; phonetic is mukhopadhyay'),
  ('মুখার্জী',       'mukherjee',    'bengali', 'already-Anglicised Bengali spelling'),
  ('গঙ্গোপাধ্যায়',  'ganguly',      'bengali', 'Anglicised form; phonetic is gangopadhyay'),
  ('ঘোষ',            'ghosh',        'bengali', ''),
  ('বসু',            'basu',         'bengali', 'CROSS-CHECK ROW: identical to the phonetic result, so nil.basu must not change'),
  ('বোস',            'bose',         'bengali', ''),
  ('সেন',            'sen',          'bengali', ''),
  ('দাস',            'das',          'bengali', ''),
  ('রায়',           'roy',          'bengali', ''),
  ('চক্রবর্তী',      'chakraborty',  'bengali', ''),
  ('ভট্টাচার্য',     'bhattacharya', 'bengali', ''),
  ('সরকার',          'sarkar',       'bengali', ''),
  ('মিত্র',          'mitra',        'bengali', ''),
  ('পাল',            'pal',          'bengali', ''),
  ('দে',             'dey',          'bengali', ''),
  ('নাগ',            'nag',          'bengali', ''),
  ('কর',             'kar',          'bengali', '')
ON CONFLICT (part) DO NOTHING;

-- ═══ 2a. fold_accents, slug, available, generate_custom_url ═══

-- F-93 · unit 2 of 5 — deriving a legal, unique, stable URL from a member's name.
--
-- THE FORMAT IS DICTATED BY THE COLUMN, NOT BY PREFERENCE:
--   profiles_custom_url_format
--     CHECK (custom_url ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$' AND custom_url !~ '\.\.')
-- so: lowercase a-z, digits, '.' and '_' ONLY; 3–30 characters; cannot begin or
-- end with a dot; no doubled dots. NOTE WHAT IS ABSENT: the hyphen. An earlier
-- spec for this work said reduce to [a-z0-9.-]; that would have produced values
-- this column rejects outright. Hyphens and apostrophes are therefore STRIPPED,
-- not substituted — "Jean-Luc Picard" becomes jeanluc.picard, not
-- jean.luc.picard — because 86 of the 97 existing production URLs are
-- single-dot first.last and a three-part value would look like a mistake to the
-- member who received it.

-- ---------------------------------------------------------------------------
-- Accent folding, done by hand and NOT with unaccent().
-- unaccent() is STABLE, not IMMUTABLE (its rules live in a mutable dictionary),
-- so a function built on it cannot itself be IMMUTABLE and cannot be indexed or
-- relied upon to give the same answer forever. A stable answer is the whole
-- point here: the same name must yield the same URL on every re-run, on both
-- lanes, for years. translate() is immutable, so this is.
CREATE OR REPLACE FUNCTION public.custom_url_fold_accents(_s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(
    lower(coalesce(_s, '')),
    'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųñńņňçćĉċčŝśšşžźżýÿŷđðþßæœ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuunnnncccccsssszzzyyyddtsao'
  );
$$;

COMMENT ON FUNCTION public.custom_url_fold_accents(text) IS
  'F-93. Folds common Latin-script diacritics to ASCII. Deliberately NOT unaccent(): that function is STABLE rather than IMMUTABLE, and this derivation must give the same answer forever. Non-Latin scripts are not transliterated — they fold to nothing, which custom_url_slug() reports as NULL so the caller can use the id-based fallback.';

-- ---------------------------------------------------------------------------
-- The stem: first.last, one dot, house style.
-- Returns NULL — never '' and never '.' — when the name carries no usable
-- character at all. NULL is the honest answer and forces the caller to decide;
-- an empty string would sail straight into a URL.
-- ⚠ STABLE, NOT IMMUTABLE — and the downgrade is deliberate. This depends on
-- public.transliteration_map and public.name_part_spellings, so its answer is a
-- function of table contents as well as its argument. Declaring it IMMUTABLE
-- would be a lie the planner believes: it could cache a result computed before
-- a mapping row existed. The determinism that matters (same name, same URL,
-- every re-run) still holds, because both tables only grow.
--
-- ⚠ SPLIT FIRST, LOOK UP SECOND, TRANSLITERATE LAST. The order is the whole
-- design. The conventional-spelling table is a WHOLE-PART equality match, so
-- the split must happen on the ORIGINAL text before any character is rewritten.
-- Transliterating first and matching afterwards would mean matching romanised
-- fragments — which is substring matching by another name, and would corrupt
-- unrelated names silently.
CREATE OR REPLACE FUNCTION public.custom_url_slug(_full_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _parts text[];
  _clean text[] := '{}';
  _p     text;
  _key   text;
  _conv  text;
  _stem  text;
BEGIN
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RETURN NULL;
  END IF;

  _parts := regexp_split_to_array(btrim(_full_name), '\s+');

  FOREACH _p IN ARRAY coalesce(_parts, '{}') LOOP
    -- Strip only SURROUNDING punctuation to form the lookup key. The part
    -- itself is not otherwise altered, so the match stays an exact whole-part
    -- comparison and can never fire on a substring.
    _key := btrim(lower(_p), ' .,;:!?"''()[]{}<>');

    SELECT latin INTO _conv FROM public.name_part_spellings WHERE part = _key;

    IF _conv IS NOT NULL THEN
      -- Convention beats phonetics. দত্ত is written "Dutta" by the people who
      -- carry it, though the walk below would correctly produce "datta".
      _p := _conv;
    ELSE
      -- Not a recorded spelling: sound it out.
      --   lower()        so uppercase Cyrillic matches the map
      --   transliterate  non-Latin script -> Latin letters
      --   fold accents   Latin diacritics -> plain ASCII
      -- Then strip whatever is left INSIDE the part — hyphens, apostrophes,
      -- and any unmapped script — so a compound surname stays one name and
      -- the value keeps its two-part first.last shape.
      _p := public.custom_url_fold_accents(
              public.custom_url_transliterate(lower(_p)));
      _p := regexp_replace(_p, '[^a-z0-9]', '', 'g');
    END IF;

    IF _p <> '' THEN _clean := _clean || _p; END IF;
  END LOOP;

  IF array_length(_clean, 1) IS NULL THEN
    -- Nothing survived: the name was only punctuation or emoji, or was written
    -- in a script deliberately not mapped (Han, Japanese, Korean — see
    -- 20260910_00065). NULL is the honest answer; generate_custom_url()
    -- supplies member.<8 hex of id>, which the member can change once a year
    -- and an admin can change immediately.
    RETURN NULL;
  ELSIF array_length(_clean, 1) = 1 THEN
    _stem := _clean[1];                             -- a single-word name: no dot to add
  ELSE
    -- First part and LAST part. Middle names are dropped rather than joined:
    -- first.middle.last is a three-part shape that exists nowhere on the site.
    _stem := _clean[1] || '.' || _clean[array_length(_clean, 1)];
  END IF;

  _stem := left(_stem, 30);
  _stem := regexp_replace(_stem, '[._]+$', '');
  _stem := regexp_replace(_stem, '^[.]+', '');

  IF length(_stem) < 3 THEN
    RETURN NULL;                                    -- "Li Wu" is fine at 5; "A" is not, and padding it would invent a name
  END IF;

  RETURN _stem;
END;
$$;

COMMENT ON FUNCTION public.custom_url_slug(text) IS
  'F-93. first.last, one dot, [a-z0-9._], 3-30 chars. Hyphens/apostrophes/spaces are stripped, middle names dropped. Returns NULL (never an empty string) when the name reduces to nothing usable or to fewer than 3 characters.';

-- ---------------------------------------------------------------------------
-- Availability. One predicate, consulted by every caller, so the answer the UI
-- shows and the answer the claim path enforces cannot drift apart.
--
-- ⚠ HISTORY IS CHECKED, INCLUDING RELEASED ROWS. A released URL is NOT free.
-- If it were handed to a different member, every link ever shared for the first
-- member would silently begin opening the second member's profile — worse than
-- a 404, because nobody sees an error and nobody reports it. Link integrity
-- outranks the convenience of recycling a nice name, so a released URL stays
-- spent forever.
CREATE OR REPLACE FUNCTION public.custom_url_available(_candidate text, _for_user uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _candidate IS NOT NULL
     AND _candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$'
     AND _candidate !~ '\.\.'
     AND NOT EXISTS (
           SELECT 1 FROM public.reserved_custom_urls r
            WHERE r.value = lower(_candidate))
     AND NOT EXISTS (
           SELECT 1 FROM public.profiles p
            WHERE lower(p.custom_url) = lower(_candidate)
              AND (_for_user IS NULL OR p.id <> _for_user))
     AND NOT EXISTS (
           SELECT 1 FROM public.custom_url_history h
            WHERE lower(h.custom_url) = lower(_candidate)
              AND (_for_user IS NULL OR h.user_id <> _for_user));
$$;

COMMENT ON FUNCTION public.custom_url_available(text, uuid) IS
  'F-93. The single source of truth for whether a custom_url may be issued: column format, reserved namespace, profiles, and custom_url_history INCLUDING released rows. Released URLs are never recycled — reissuing one would silently redirect every link previously shared for its former holder.';

-- ---------------------------------------------------------------------------
-- The generator.
CREATE OR REPLACE FUNCTION public.generate_custom_url(_full_name text, _user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _stem      text;
  _candidate text;
  _suffix    text;
  _n         int := 2;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'generate_custom_url requires a user id: it is needed both for the fallback value and to let a member keep a URL they already hold';
  END IF;

  _stem := public.custom_url_slug(_full_name);

  -- THE EMPTY CASE, answered explicitly. A name that is only punctuation, only
  -- emoji, or a script this folds away yields NULL above. '' must never become
  -- a URL, and neither must a bare '.' or '-'. Such a member gets an
  -- id-derived value instead: deterministic, stable across re-runs, legal under
  -- the column CHECK, and still subject to every check below.
  IF _stem IS NULL THEN
    _stem := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  END IF;

  IF public.custom_url_available(_stem, _user_id) THEN
    RETURN _stem;
  END IF;

  -- Collision: append digits, per the Owner's instruction. The stem is trimmed
  -- so stem+digits still fits 30 characters, and any trailing dot exposed by
  -- that trim is removed — 'ana.b' truncated to 'ana.' + '2' would otherwise
  -- produce 'ana.2', which is legal, whereas a trim landing on '..' is not.
  WHILE _n < 1000 LOOP
    _suffix    := _n::text;
    _candidate := regexp_replace(left(_stem, 30 - length(_suffix)), '[._]+$', '') || _suffix;
    IF public.custom_url_available(_candidate, _user_id) THEN
      RETURN _candidate;
    END IF;
    _n := _n + 1;
  END LOOP;

  -- 998 collisions on one stem means something is wrong with the input, not
  -- with this member. Fall back to the id rather than looping forever.
  _candidate := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  IF public.custom_url_available(_candidate, _user_id) THEN
    RETURN _candidate;
  END IF;

  RAISE EXCEPTION 'generate_custom_url could not find a free URL for % (stem %)', _user_id, _stem;
END;
$$;

COMMENT ON FUNCTION public.generate_custom_url(text, uuid) IS
  'F-93. Deterministic first.last from full_name, digits appended on collision, member.<8 hex of id> when the name reduces to nothing. Every candidate passes custom_url_available(), so reserved names and released history entries are never issued.';


-- ═══ 2b. custom_url_ever_held (from 0011) ═══

CREATE OR REPLACE FUNCTION public.custom_url_ever_held(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.custom_url_history WHERE user_id = _user_id);
$$;

COMMENT ON FUNCTION public.custom_url_ever_held(uuid) IS
  'F-96. Keys the 12-month window on history rather than on the current value, so emptying custom_url no longer resets the regime.';

-- ═══ 3a. tg_custom_url_reject_reserved ═══

CREATE OR REPLACE FUNCTION public.tg_custom_url_reject_reserved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.custom_url IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.reserved_custom_urls r
                  WHERE r.value = lower(NEW.custom_url))
  THEN
    RAISE EXCEPTION
      'custom_url "%" is reserved: the site already serves that top-level path, so a member holding it would be unreachable behind it with nothing appearing broken.',
      NEW.custom_url
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ═══ 3b. tg_profiles_assign_custom_url ═══

CREATE OR REPLACE FUNCTION public.tg_profiles_assign_custom_url()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.custom_url IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- MISSING NAME IS ITS OWN BRANCH, not a subset of the empty-string case.
  -- Some OAuth providers send no name at all: handle_new_user() resolves
  -- raw_user_meta_data->>'full_name' then ->>'name' and stores NULL when
  -- neither is present. NULL and '' are different states and are logged
  -- differently, but both take the id-derived fallback rather than aborting.
  BEGIN
    IF NEW.full_name IS NULL THEN
      NEW.custom_url := public.generate_custom_url(NULL, NEW.id);
    ELSE
      NEW.custom_url := public.generate_custom_url(NEW.full_name, NEW.id);
    END IF;
  EXCEPTION WHEN others THEN
    -- Deliberately swallowed. RAISE WARNING, never RAISE EXCEPTION: the
    -- warning reaches the Postgres log for diagnosis while the signup
    -- completes. The row is left with custom_url NULL and the backfill,
    -- which runs outside any signup transaction, will assign one.
    RAISE WARNING 'F-93: could not generate a custom_url for profile % (%): % — letting the signup through with NULL, the backfill will assign one',
      NEW.id, SQLSTATE, SQLERRM;
    NEW.custom_url := NULL;
  END;

  -- custom_url_changed_at is deliberately LEFT NULL. This is an assignment,
  -- not a change; stamping it here would silently spend the member's one
  -- change per 12 months on a name they never chose.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_assign_custom_url() IS
  'F-93. Gives every new profile a custom_url derived from its name, so the gap that left 14 production members unreachable by name cannot reopen through any signup path. Leaves custom_url_changed_at NULL: an assignment is not a change.';

-- ═══ 3c. the two triggers ═══

DROP TRIGGER IF EXISTS trg_custom_url_reject_reserved ON public.profiles;
CREATE TRIGGER trg_custom_url_reject_reserved
  BEFORE INSERT OR UPDATE OF custom_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_custom_url_reject_reserved();


DROP TRIGGER IF EXISTS trg_profiles_zz_assign_custom_url ON public.profiles;
CREATE TRIGGER trg_profiles_zz_assign_custom_url
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_assign_custom_url();


-- ═══ 3c. CLOSE THE CLOSURE. THIS IS NOT HOUSEKEEPING. ═══
--
-- ⚠ WITHOUT THIS BLOCK THIS MIGRATION WOULD OPEN ON PRODUCTION THE EXACT HOLE
--   F-105c WAS FILED TO CLOSE. Measured on production (pg_default_acl, schema
--   public, grantor postgres, objtype 'f'):
--       {anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   Every one of these functions is created FRESH on production — 14 of the 15
--   closure objects were measured ABSENT there — so each CREATE picks that
--   default up, and a bare CREATE also lands the built-in PUBLIC '=X/' entry.
--   Two of them are SECURITY DEFINER taking an IDENTITY ARGUMENT and checking
--   no auth.uid(): custom_url_available(text, uuid) and
--   custom_url_ever_held(uuid). Shipped open, an anonymous caller could ask
--   "has user X ever held a handle?" of any uuid. That is F-105c's shape
--   exactly, and this file would have introduced it on the same night we
--   closed it.
--
-- ⚠ WHY THE TREE DID NOT ALREADY CARRY THESE. Staging holds all eight closed
--   ({postgres=X/postgres,service_role=X/postgres}), but NO migration in the
--   repository revokes them — staging was closed out of band. So the tree did
--   not reproduce staging, and promoting it verbatim would have diverged the
--   lanes in the open direction. Filed as F-111.
--
-- ⚠ REVOKE FROM PUBLIC IS NOT OPTIONAL AND IS NOT REDUNDANT (F-62). Revoking
--   only anon and authenticated is a no-op wherever PUBLIC holds the grant.
--   PUBLIC is listed first for that reason.
--
-- ⚠ SAFE TO CLOSE: no caller exists. The client's handle screens call
--   check_custom_urls_taken, resolve_custom_url, change_custom_url and
--   clear_custom_url (src/pages/EditProfile.tsx, src/pages/CustomUrlProfile.tsx)
--   — none of the eight below. They are reached through the TRIGGERS, which run
--   as the definer and are unaffected by these grants.

REVOKE ALL ON FUNCTION public.custom_url_fold_accents(text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.custom_url_transliterate(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.custom_url_slug(text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.custom_url_available(text, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.custom_url_ever_held(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_custom_url(text, uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_custom_url_reject_reserved()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_profiles_assign_custom_url()           FROM PUBLIC, anon, authenticated;

-- ═══ 4. THE GATE — IT PROVES THE BEHAVIOUR, NOT THE INVENTORY ═══
--
-- ⚠ AN OBJECT-EXISTENCE CHECK CANNOT CATCH THE FAILURE THIS FILE EXISTS TO
--   PREVENT. tg_profiles_assign_custom_url swallows its own exception and
--   leaves custom_url NULL, so every object can be PRESENT and a new member can
--   still land without a handle. The only assertion that discriminates is to
--   put a row through the real path and read the handle back.
--
-- ⚠ HOW THE PROBE IS UNDONE, AND WHY IT IS NOT "ROLLBACK TO SAVEPOINT".
--   PL/pgSQL has no SAVEPOINT statement — the first draft of this gate used one
--   and Postgres rejected it with 42601 at the ROLLBACK line. That would have
--   aborted the entire migration ON PRODUCTION, at the gate, after the approval
--   was spent. It was caught by running the gate rather than reading it.
--   A BEGIN ... EXCEPTION block IS an implicit savepoint: raising inside it
--   discards everything the block wrote, while PL/pgSQL VARIABLES set inside
--   survive. So the probe writes, captures its findings into variables, raises
--   a private sentinel to undo the writes, and the assertions are made
--   afterwards on the surviving variables.
DO $gate$
DECLARE
  _pid   constant uuid := 'f93c105e-0000-4000-8000-000000000021';
  _name  constant text := 'শীর্ষেন্দু দত্ত';   -- exercises transliterate + name_part_spellings
  _got         text;
  _rows        int;
  _missing     text;
  _reserved_ok boolean := false;
  _res_state   text;
  _res_err     text;
  _probe_ran   boolean := false;
  _auto_rows   int;
  _pid2  constant uuid := 'f93c105e-0000-4000-8000-000000000022';
BEGIN
  -- G1 · every object in the closure exists.
  SELECT string_agg(o, ', ') INTO _missing FROM (
    SELECT o FROM unnest(ARRAY['custom_url_fold_accents','custom_url_transliterate',
      'custom_url_slug','custom_url_available','custom_url_ever_held','generate_custom_url',
      'tg_custom_url_reject_reserved','tg_profiles_assign_custom_url']) o
     WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=o)
    UNION ALL
    SELECT o FROM unnest(ARRAY['reserved_custom_urls','transliteration_map','name_part_spellings']) o
     WHERE to_regclass('public.'||o) IS NULL
    UNION ALL
    SELECT o FROM unnest(ARRAY['trg_custom_url_reject_reserved','trg_profiles_zz_assign_custom_url']) o
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=o AND NOT tgisinternal)
  ) m;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'G1 FAILED — closure incomplete, missing: %', _missing;
  END IF;

  -- G2 · the reserved list actually carries its rows. An empty guard table is a
  --      guard that permits everything.
  SELECT count(*) INTO _rows FROM public.reserved_custom_urls;
  IF _rows < 68 THEN
    RAISE EXCEPTION 'G2 FAILED — reserved_custom_urls holds % rows, expected at least 68. An empty reserved list hands admin/wallet/feed to real members.', _rows;
  END IF;

  -- G3/G4 · THE ONES THAT MATTER. A real signup receives a handle, and a
  --         reserved word is refused. Everything written here is undone.
  BEGIN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      _pid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'f93-closure-probe@50mm-probe.invalid', 'not-a-real-login', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _name), now(), now()
    );

    -- handle_new_user normally creates the profile; if this lane does not wire
    -- that, create it explicitly so the BEFORE INSERT chain still runs.
    INSERT INTO public.profiles (id, full_name) VALUES (_pid, _name)
      ON CONFLICT (id) DO NOTHING;

    SELECT count(*) INTO _auto_rows FROM public.profiles WHERE id = _pid;
    SELECT custom_url INTO _got FROM public.profiles WHERE id = _pid;

    -- ⚠ G4 TESTS AN INSERT, NOT AN UPDATE, AND THE REASON IS A DEFECT THIS
    --   GATE ALREADY HAD. The first version tried
    --       UPDATE public.profiles SET custom_url = 'admin'
    --   and "passed" — but it passed for the WRONG REASON.
    --   block_custom_url_update refuses ANY direct UPDATE of custom_url unless
    --   app.allow_custom_url_update is set, so the exception being caught was
    --   that blocker, not the reserved-word guard. Proven by dropping
    --   trg_custom_url_reject_reserved in a rolled-back block: the UPDATE was
    --   still refused, so G4 stayed green with the guard GONE. C-87 — an
    --   instrument that cannot see the failure it is aimed at.
    --   trg_custom_url_reject_reserved is BEFORE INSERT OR UPDATE;
    --   block_custom_url_update is UPDATE only. So an INSERT carrying a
    --   reserved handle reaches the reserved guard and nothing else.
    BEGIN
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES (
        _pid2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'f93-closure-probe2@50mm-probe.invalid', 'not-a-real-login', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', 'Reserved Probe'), now(), now()
      );
      INSERT INTO public.profiles (id, full_name, custom_url)
        VALUES (_pid2, 'Reserved Probe', 'admin');
      _res_state := 'none';
      _res_err   := '(no error - the reserved handle was ACCEPTED)';
    EXCEPTION WHEN others THEN
      _res_state := SQLSTATE;
      _res_err   := SQLERRM;
    END;
    -- ⚠ AND G4 IS PINNED TO THE GUARD'S OWN SIGNATURE, NOT TO "some error".
    --   Measured on staging: handle_new_user ALREADY creates the profiles row
    --   from the auth.users insert (auto_profile_rows = 1, handle
    --   'reserved.probe'), so the INSERT above is a SECOND row on the same id.
    --   It is refused with SQLSTATE 23514 and the reserved guard's message
    --   only because trg_custom_url_reject_reserved is a BEFORE trigger and
    --   fires ahead of the primary-key check. Take the guard away and the same
    --   INSERT still fails - 23505, unique violation - and a bare
    --   `WHEN others => _reserved_ok := true` would report GREEN with the
    --   guard GONE. So the assertion below requires the check violation AND
    --   the word 'reserved' in the message: nothing but the guard can produce
    --   that pair.
    _reserved_ok := (_res_state = '23514' AND _res_err ILIKE '%reserved%');

    _probe_ran := true;
    RAISE EXCEPTION 'F93_PROBE_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'F93_PROBE_ROLLBACK' THEN
      RAISE EXCEPTION 'G3 FAILED — the probe itself errored before it could judge anything: % (%). Nothing is committed.', SQLERRM, SQLSTATE;
    END IF;
  END;

  IF NOT _probe_ran THEN
    RAISE EXCEPTION 'G3 FAILED — the probe did not complete. Nothing is committed.';
  END IF;

  IF _got IS NULL THEN
    RAISE EXCEPTION
      'G3 FAILED — a new signup received NO handle. This is the silent failure this migration exists to prevent: the trigger is installed, the row was created, and custom_url came back NULL. Every future member would render as dead text. Nothing is committed.';
  END IF;

  IF _got !~ '^[a-z0-9._]+$' THEN
    RAISE EXCEPTION 'G3 FAILED — handle % is not ASCII-safe; the Owner''s hard rule is that every URL is in English.', _got;
  END IF;

  IF NOT _reserved_ok THEN
    RAISE EXCEPTION
      'G4 FAILED — the reserved handle "admin" was not refused BY THE RESERVED GUARD. Expected SQLSTATE 23514 with "reserved" in the message; got SQLSTATE % and: %. Either the guard is absent and something else refused the row, or the namespace is open.',
      coalesce(_res_state,'<none>'), coalesce(_res_err,'<none>');
  END IF;

  -- G5 · the probe left nothing behind.
  SELECT count(*) INTO _rows FROM public.profiles WHERE id = _pid;
  IF _rows <> 0 THEN
    RAISE EXCEPTION 'G5 FAILED — the probe profile survived (% row).', _rows;
  END IF;
  SELECT count(*) INTO _rows FROM auth.users WHERE id IN (_pid, _pid2);
  IF _rows <> 0 THEN
    RAISE EXCEPTION 'G5 FAILED — % probe auth user(s) survived.', _rows;
  END IF;
  SELECT count(*) INTO _rows FROM public.profiles WHERE id = _pid2;
  IF _rows <> 0 THEN
    RAISE EXCEPTION 'G5 FAILED — the reserved-probe profile survived (% row).', _rows;
  END IF;

  -- G6 · the closure is CLOSED. Read from proacl, the instrument — not from
  --      has_function_privilege, which is a summary and cannot show WHO holds
  --      the grant (C-89). A NULL proacl means the built-in PUBLIC EXECUTE is
  --      still in force, so NULL is a failure, not an absence of findings.
  SELECT string_agg(format('%s(%s) => %s', p.proname,
                           pg_get_function_identity_arguments(p.oid),
                           coalesce(p.proacl::text, 'NULL = PUBLIC EXECUTE')), '; ')
    INTO _missing
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('custom_url_fold_accents','custom_url_transliterate',
                       'custom_url_slug','custom_url_available','custom_url_ever_held',
                       'generate_custom_url','tg_custom_url_reject_reserved',
                       'tg_profiles_assign_custom_url')
     AND (p.proacl IS NULL
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0                                  -- PUBLIC
                         OR a.grantee = to_regrole('anon')::oid
                         OR a.grantee = to_regrole('authenticated')::oid));
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION
      'G6 FAILED — the closure landed OPEN. These are reachable by PUBLIC, anon or authenticated: %. custom_url_available and custom_url_ever_held are SECURITY DEFINER taking an identity argument, so open means anyone may interrogate any uuid. Nothing is committed.',
      _missing;
  END IF;

  RAISE NOTICE 'G1 ok — all 13 closure objects present';
  RAISE NOTICE 'G2 ok — reserved_custom_urls carries its rows';
  RAISE NOTICE 'G3 ok — a real signup named % received handle % (% profile row(s) created by the signup path itself)', _name, _got, _auto_rows;
  RAISE NOTICE 'G4 ok — the reserved handle "admin" was refused by the guard (SQLSTATE %)', _res_state;
  RAISE NOTICE 'G5 ok — the probe left nothing behind';
  RAISE NOTICE 'G6 ok — all 8 closure functions closed to PUBLIC, anon and authenticated';
  RAISE NOTICE '--- F-93 SIGNUP CLOSURE GATE PASSED ---';
END
$gate$;

COMMIT;
