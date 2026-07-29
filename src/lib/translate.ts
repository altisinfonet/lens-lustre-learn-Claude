/**
 * Post translation helpers ("See translation", like the big social apps).
 *
 * needsTranslation(): cheap client-side script detection — a post written in
 * a different writing system than the reader's app language gets the
 * "See translation" affordance. No network call until the reader taps it.
 *
 * translateText(): calls the translate-text edge function (signed-in only),
 * which uses the platform's existing AI gateway. Results are memoised per
 * (text, target) for the session so re-renders and repeat taps are free.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Lang } from "@/i18n/translations";

type Script = "latin" | "devanagari" | "bengali" | "gujarati" | "tamil" | "telugu";

const SCRIPT_FOR_LANG: Record<Lang, Script> = {
  en: "latin",
  hi: "devanagari",
  bn: "bengali",
  mr: "devanagari",
  gu: "gujarati",
  ta: "tamil",
  te: "telugu",
};

const RANGES: { script: Script; re: RegExp }[] = [
  { script: "devanagari", re: /[ऀ-ॿ]/g },
  { script: "bengali", re: /[ঀ-৿]/g },
  { script: "gujarati", re: /[઀-૿]/g },
  { script: "tamil", re: /[஀-௿]/g },
  { script: "telugu", re: /[ఀ-౿]/g },
  { script: "latin", re: /[A-Za-z]/g },
];

/** Dominant writing system of a text, or null if there's nothing to read. */
export function detectScript(text: string): Script | null {
  let best: Script | null = null;
  let bestCount = 0;
  let total = 0;
  for (const { script, re } of RANGES) {
    const count = (text.match(re) || []).length;
    total += count;
    if (count > bestCount) {
      bestCount = count;
      best = script;
    }
  }
  // Require a little real text — emoji-only / number-only posts don't count.
  if (total < 6) return null;
  return best;
}

/** Should this text get a "See translation" link for a reader using `lang`? */
export function needsTranslation(text: string, lang: Lang): boolean {
  const script = detectScript(text);
  if (!script) return false;
  return script !== SCRIPT_FOR_LANG[lang];
}

const cache = new Map<string, string>();

export async function translateText(text: string, target: Lang): Promise<string> {
  const key = `${target}::${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { data, error } = await supabase.functions.invoke("translate-text", {
    body: { text, target },
  });
  if (error) throw new Error(error.message || "Translation failed");
  const translated = (data as { translated?: string })?.translated;
  if (!translated) throw new Error((data as { error?: string })?.error || "Translation failed");
  cache.set(key, translated);
  return translated;
}
