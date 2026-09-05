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
