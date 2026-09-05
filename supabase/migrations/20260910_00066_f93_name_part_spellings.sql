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
