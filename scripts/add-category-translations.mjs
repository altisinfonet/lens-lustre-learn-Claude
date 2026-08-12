/**
 * ONE-SHOT generator: inserts the 46 `cat.<slug>` keys into the seven language
 * dictionaries.
 *
 * Done as a script rather than by hand because it is 322 insertions across two
 * large files, and a hand edit at that scale is how this repo previously ended
 * up with 74 mojibake strings (`TEXT_ENCODING_CORRUPTION.md`). Everything is
 * written as UTF-8 in one pass and verified by `sourceEncoding.test.ts`
 * afterwards.
 *
 * Run: node scripts/add-category-translations.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

/** slug → { en, hi, bn, mr, gu, ta, te } */
const CATS = {
  wildlife:        ["Wildlife", "वन्यजीव", "বন্যপ্রাণী", "वन्यजीव", "વન્યજીવ", "வனவிலங்கு", "వన్యప్రాణి"],
  portrait:        ["Portrait", "पोर्ट्रेट", "পোর্ট্রেট", "पोर्ट्रेट", "પોર્ટ્રેટ", "உருவப்படம்", "పోర్ట్రెయిట్"],
  street:          ["Street", "स्ट्रीट", "রাস্তা", "स्ट्रीट", "સ્ટ્રીટ", "தெரு", "వీధి"],
  landscape:       ["Landscape", "लैंडस्केप", "ল্যান্ডস্কেপ", "लँडस्केप", "લેન્ડસ્કેપ", "நிலக்காட்சி", "ల్యాండ్‌స్కేప్"],
  macro:           ["Macro", "मैक्रो", "ম্যাক্রো", "मॅक्रो", "મેક્રો", "மேக்ரோ", "మాక్రో"],
  travel:          ["Travel", "यात्रा", "ভ্রমণ", "प्रवास", "પ્રવાસ", "பயணம்", "ప్రయాణం"],
  aerial:          ["Aerial", "हवाई", "আকাশ থেকে", "हवाई", "હવાઈ", "வான்வழி", "వైమానిక"],
  nature:          ["Nature", "प्रकृति", "প্রকৃতি", "निसर्ग", "પ્રકૃતિ", "இயற்கை", "ప్రకృతి"],
  bird:            ["Bird", "पक्षी", "পাখি", "पक्षी", "પક્ષી", "பறவை", "పక్షి"],
  astro:           ["Astro", "खगोल", "জ্যোতির্", "खगोल", "ખગોળ", "வானியல்", "ఖగోళ"],
  cityscape:       ["Cityscape", "शहरी दृश्य", "নগরদৃশ্য", "शहरी दृश्य", "શહેરી દૃશ્ય", "நகரக் காட்சி", "నగర దృశ్యం"],
  architecture:    ["Architecture", "वास्तुकला", "স্থাপত্য", "वास्तुकला", "સ્થાપત્ય", "கட்டிடக்கலை", "వాస్తుశిల్పం"],
  documentary:     ["Documentary", "वृत्तचित्र", "তথ্যচিত্র", "माहितीपट", "દસ્તાવેજી", "ஆவணப்படம்", "డాక్యుమెంటరీ"],
  photojournalism: ["Photojournalism", "फोटो पत्रकारिता", "ফটো সাংবাদিকতা", "छायाचित्र पत्रकारिता", "ફોટો પત્રકારત્વ", "புகைப்பட இதழியல்", "ఫోటో జర్నలిజం"],
  fashion:         ["Fashion", "फैशन", "ফ্যাশন", "फॅशन", "ફેશન", "ஃபேஷன்", "ఫ్యాషన్"],
  wedding:         ["Wedding", "विवाह", "বিবাহ", "विवाह", "લગ્ન", "திருமணம்", "వివాహం"],
  "newborn-baby":  ["Newborn & Baby", "नवजात व शिशु", "নবজাতক ও শিশু", "नवजात व बाळ", "નવજાત અને બાળક", "பிறந்த குழந்தை", "నవజాత శిశువు"],
  sports:          ["Sports", "खेल", "খেলাধুলা", "क्रीडा", "રમતગમત", "விளையாட்டு", "క్రీడలు"],
  automotive:      ["Automotive", "ऑटोमोटिव", "অটোমোটিভ", "ऑटोमोटिव्ह", "ઓટોમોટિવ", "வாகனம்", "ఆటోమోటివ్"],
  aviation:        ["Aviation", "विमानन", "বিমান চলাচল", "विमानन", "ઉડ્ડયન", "விமானப் போக்குவரத்து", "విమానయానం"],
  food:            ["Food", "भोजन", "খাবার", "अन्न", "ખોરાક", "உணவு", "ఆహారం"],
  product:         ["Product", "उत्पाद", "পণ্য", "उत्पादन", "ઉત્પાદન", "தயாரிப்பு", "ఉత్పత్తి"],
  "still-life":    ["Still Life", "स्थिर जीवन", "স্থিরচিত্র", "स्थिरचित्र", "સ્થિર જીવન", "நிலைப் பொருள்", "నిశ్చల చిత్రం"],
  commercial:      ["Commercial", "वाणिज्यिक", "বাণিজ্যিক", "व्यावसायिक", "વાણિજ્યિક", "வணிக", "వాణిజ్య"],
  industrial:      ["Industrial", "औद्योगिक", "শিল্প", "औद्योगिक", "ઔદ્યોગિક", "தொழிற்துறை", "పారిశ్రామిక"],
  "real-estate":   ["Real Estate", "रियल एस्टेट", "রিয়েল এস্টেট", "रिअल इस्टेट", "રિયલ એસ્ટેટ", "ரியல் எஸ்டேட்", "రియల్ ఎస్టేట్"],
  "fine-art":      ["Fine Art", "ललित कला", "চারুকলা", "ललित कला", "લલિત કલા", "நுண்கலை", "లలిత కళ"],
  abstract:        ["Abstract", "अमूर्त", "বিমূর্ত", "अमूर्त", "અમૂર્ત", "சுருக்கம்", "నైరూప్య"],
  minimalist:      ["Minimalist", "मिनिमलिस्ट", "মিনিমালিস্ট", "मिनिमलिस्ट", "મિનિમલિસ્ટ", "மினிமலிஸ்ட்", "మినిమలిస్ట్"],
  "black-and-white": ["Black & White", "श्वेत-श्याम", "সাদা-কালো", "कृष्णधवल", "શ્વેત-શ્યામ", "கருப்பு-வெள்ளை", "నలుపు-తెలుపు"],
  "long-exposure": ["Long Exposure", "लॉन्ग एक्सपोज़र", "লং এক্সপোজার", "लाँग एक्सपोजर", "લોંગ એક્સપોઝર", "நீண்ட வெளிப்பாடு", "లాంగ్ ఎక్స్‌పోజర్"],
  night:           ["Night", "रात्रि", "রাত্রি", "रात्र", "રાત્રિ", "இரவு", "రాత్రి"],
  underwater:      ["Underwater", "पानी के नीचे", "জলের নিচে", "पाण्याखालील", "પાણી નીચે", "நீருக்கடி", "నీటి అడుగున"],
  experimental:    ["Experimental", "प्रयोगात्मक", "পরীক্ষামূলক", "प्रयोगात्मक", "પ્રાયોગિક", "பரிசோதனை", "ప్రయోగాత్మక"],
  conceptual:      ["Conceptual", "वैचारिक", "ধারণাগত", "संकल्पनात्मक", "વૈચારિક", "கருத்தியல்", "భావనాత్మక"],
  mobile:          ["Mobile", "मोबाइल", "মোবাইল", "मोबाइल", "મોબાઇલ", "மொபைல்", "మొబైల్"],
  film:            ["Film", "फिल्म", "ফিল্ম", "फिल्म", "ફિલ્મ", "பிலிம்", "ఫిల్మ్"],
  infrared:        ["Infrared", "इन्फ्रारेड", "ইনফ্রারেড", "इन्फ्रारेड", "ઇન્ફ્રારેડ", "அகச்சிவப்பு", "ఇన్‌ఫ్రారెడ్"],
  scientific:      ["Scientific", "वैज्ञानिक", "বৈজ্ঞানিক", "वैज्ञानिक", "વૈજ્ઞાનિક", "அறிவியல்", "శాస్త్రీయ"],
  cultural:        ["Cultural", "सांस्कृतिक", "সাংস্কৃতিক", "सांस्कृतिक", "સાંસ્કૃતિક", "பண்பாட்டு", "సాంస్కృతిక"],
  humanitarian:    ["Humanitarian", "मानवीय", "মানবিক", "मानवतावादी", "માનવીય", "மனிதாபிமான", "మానవతా"],
  lifestyle:       ["Lifestyle", "जीवनशैली", "জীবনধারা", "जीवनशैली", "જીવનશૈલી", "வாழ்க்கை முறை", "జీవనశైలి"],
  event:           ["Event", "आयोजन", "অনুষ্ঠান", "कार्यक्रम", "કાર્યક્રમ", "நிகழ்வு", "కార్యక్రమం"],
  pet:             ["Pet", "पालतू", "পোষা প্রাণী", "पाळीव प्राणी", "પાળતુ પ્રાણી", "செல்லப்பிராணி", "పెంపుడు జంతువు"],
  equine:          ["Equine", "अश्व", "অশ্ব", "अश्व", "અશ્વ", "குதிரை", "అశ్వ"],
  "digital-art":   ["Digital Art", "डिजिटल कला", "ডিজিটাল শিল্প", "डिजिटल कला", "ડિજિટલ કલા", "டிஜிட்டல் கலை", "డిజిటల్ కళ"],
};

const LANG_INDEX = { en: 0, hi: 1, bn: 2, mr: 3, gu: 4, ta: 5, te: 6 };

const block = (lang) => {
  const i = LANG_INDEX[lang];
  const lines = Object.entries(CATS).map(
    ([slug, vals]) => `  "cat.${slug}": ${JSON.stringify(vals[i])},`,
  );
  return [
    "",
    "  /* ── Photography categories (46). Slugs come from public.categories;",
    "     these are only the display names. Adding a category in the database",
    "     without a key here falls back to categories.name, which is English. ── */",
    ...lines,
  ].join("\n");
};

// ── en lives in translations.ts ──────────────────────────────────────────────
{
  const p = "src/i18n/translations.ts";
  const src = readFileSync(p, "utf8");
  const lines = src.split("\n");
  let start = lines.findIndex((l) => l.startsWith("const en: Dict = {"));
  if (start < 0) throw new Error("en dict not found");
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "};") { end = i; break; }
  }
  if (end < 0) throw new Error("end of en dict not found");
  if (src.includes('"cat.wildlife"')) { console.log("en: already present, skipped"); }
  else {
    lines.splice(end, 0, block("en"));
    writeFileSync(p, lines.join("\n"), "utf8");
    console.log("en: 46 keys inserted at line", end);
  }
}

// ── the other six live in translations.rest.ts ───────────────────────────────
{
  const p = "src/i18n/translations.rest.ts";
  let src = readFileSync(p, "utf8");
  for (const lang of ["hi", "bn", "mr", "gu", "ta", "te"]) {
    const lines = src.split("\n");
    const start = lines.findIndex((l) => l.startsWith(`const ${lang}: Dict = {`));
    if (start < 0) throw new Error(`${lang} dict not found`);
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === "};") { end = i; break; }
    }
    if (end < 0) throw new Error(`end of ${lang} dict not found`);
    // Idempotent: only insert if this dict has no cat.* key yet.
    const body = lines.slice(start, end).join("\n");
    if (body.includes('"cat.wildlife"')) { console.log(`${lang}: already present, skipped`); continue; }
    lines.splice(end, 0, block(lang));
    src = lines.join("\n");
    console.log(`${lang}: 46 keys inserted at line`, end);
  }
  writeFileSync(p, src, "utf8");
}
