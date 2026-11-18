/**
 * PHOTOGRAPHY COMMENT SUGGESTIONS — the one list (Owner 18 Nov 2026: "comment
 * suggestion like Gorgeous, Pretty … need suggestion related with Photography
 * wording … Web and App both").
 *
 * A row of phrases above the comment box. A tap only ADDS the phrase to the box
 * (CommentComposer.appendText): nothing posts by itself, and the comment still
 * goes through the one send path with its blocklist and moderation.
 *
 * The list lives in site_settings key `comment_suggestions` so Admin → Comments
 * can change it without an app build; until an admin saves one, DEFAULT below
 * is used. Each phrase is shown in the member's app language, English when that
 * language has no text for it.
 */
import type { Lang } from "@/i18n/translations";

export const SUGGESTIONS_KEY = "comment_suggestions";
export const MAX_SUGGESTIONS = 12;
export const MAX_PHRASE_LENGTH = 40;

/** One phrase: English always, other languages optional. */
export type SuggestionPhrase = { en: string } & Partial<Record<Exclude<Lang, "en">, string>>;
export interface SuggestionsSetting {
  enabled: boolean;
  phrases: SuggestionPhrase[];
}

export const DEFAULT_SUGGESTIONS: SuggestionsSetting = {
  enabled: true,
  phrases: [
    { en: "Stunning light ✨", hi: "शानदार रोशनी ✨", bn: "দারুণ আলো ✨", mr: "अप्रतिम प्रकाश ✨", gu: "અદ્ભુત પ્રકાશ ✨", ta: "அருமையான ஒளி ✨", te: "అద్భుతమైన కాంతి ✨" },
    { en: "Great composition 👏", hi: "बेहतरीन कंपोज़िशन 👏", bn: "অসাধারণ কম্পোজিশন 👏", mr: "उत्तम रचना 👏", gu: "સરસ કમ્પોઝિશન 👏", ta: "சிறந்த அமைப்பு 👏", te: "చక్కని కంపోజిషన్ 👏" },
    { en: "Beautiful colours 🎨", hi: "सुंदर रंग 🎨", bn: "চমৎকার রং 🎨", mr: "सुंदर रंग 🎨", gu: "સુંદર રંગો 🎨", ta: "அழகான நிறங்கள் 🎨", te: "అందమైన రంగులు 🎨" },
    { en: "Perfect timing ⏱️", hi: "बिल्कुल सही पल ⏱️", bn: "একদম সঠিক মুহূর্ত ⏱️", mr: "अचूक क्षण ⏱️", gu: "એકદમ યોગ્ય પળ ⏱️", ta: "சரியான தருணம் ⏱️", te: "సరైన క్షణం ⏱️" },
    { en: "Lovely bokeh 🌸", hi: "प्यारा बोकेह 🌸", bn: "সুন্দর বোকে 🌸", mr: "छान बोके 🌸", gu: "સુંદર બોકેહ 🌸", ta: "அழகான போக்கே 🌸", te: "అందమైన బొకే 🌸" },
    { en: "Sharp details 🔍", hi: "बारीक डिटेल 🔍", bn: "নিখুঁত ডিটেল 🔍", mr: "सुस्पष्ट तपशील 🔍", gu: "સ્પષ્ટ વિગતો 🔍", ta: "கூர்மையான விவரங்கள் 🔍", te: "స్పష్టమైన వివరాలు 🔍" },
    { en: "Great perspective 📐", hi: "शानदार नज़रिया 📐", bn: "দারুণ দৃষ্টিকোণ 📐", mr: "छान दृष्टिकोन 📐", gu: "સરસ દૃષ્ટિકોણ 📐", ta: "சிறந்த கோணம் 📐", te: "చక్కని కోణం 📐" },
    { en: "Wow, what a shot! 📸", hi: "वाह, क्या शॉट है! 📸", bn: "বাহ, কী দারুণ ছবি! 📸", mr: "वाह, काय फोटो आहे! 📸", gu: "વાહ, શું શૉટ છે! 📸", ta: "ஆஹா, என்ன ஒரு ஷாட்! 📸", te: "వావ్, ఏం షాట్! 📸" },
  ],
};

const LANGS: Lang[] = ["en", "hi", "bn", "mr", "gu", "ta", "te"];

/**
 * Whatever is stored, made safe to draw: a broken or missing setting gives the
 * default list, never an empty or crashing row. Phrases are trimmed, capped in
 * length and count, and must have English.
 */
export function readSuggestions(stored: unknown): SuggestionsSetting {
  if (!stored || typeof stored !== "object") return DEFAULT_SUGGESTIONS;
  const s = stored as { enabled?: unknown; phrases?: unknown };
  if (!Array.isArray(s.phrases)) return DEFAULT_SUGGESTIONS;
  const phrases: SuggestionPhrase[] = [];
  for (const raw of s.phrases) {
    if (!raw || typeof raw !== "object") continue;
    const p: Record<string, string> = {};
    for (const l of LANGS) {
      const v = (raw as Record<string, unknown>)[l];
      if (typeof v === "string" && v.trim()) p[l] = v.trim().slice(0, MAX_PHRASE_LENGTH);
    }
    if (p.en) phrases.push(p as SuggestionPhrase);
    if (phrases.length >= MAX_SUGGESTIONS) break;
  }
  return { enabled: s.enabled !== false, phrases };
}

/** The texts the row shows, in this language (English where the phrase has none). */
export function suggestionTexts(setting: SuggestionsSetting, lang: Lang): string[] {
  if (!setting.enabled) return [];
  return setting.phrases.map((p) => (lang !== "en" && p[lang]) || p.en);
}
