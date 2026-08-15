/**
 * The display rule for a person's name, in TypeScript.
 *
 * OWNER RULE, 2026-08-15: a name is stored and shown with every word
 * capitalised, however it was typed. `AVIJIT SHEEL` → `Avijit Sheel`.
 * `SHIV SANKAR das` → `Shiv Sankar Das`.
 *
 * ⚠ THIS IS THE SECOND COPY OF THE RULE. The first is
 * `public.format_person_name(text)`, applied by a BEFORE INSERT OR UPDATE
 * trigger on `profiles`, and THE DATABASE IS THE ONE THAT DECIDES. This copy
 * exists so a name looks right while it is being typed and so any name shown
 * from a source that has not been through the trigger renders consistently —
 * not so the client can decide the stored value.
 *
 * Two copies of a rule diverge; that is recorded as a maintenance risk
 * elsewhere in this project and it applies here too. The mitigation is
 * `personNameCasing.test.ts`, which runs BOTH implementations over one shared
 * fixture list and fails if they disagree on any entry — so a change to either
 * has to be made to both.
 *
 * The three non-obvious decisions, and the live data behind each:
 *
 *  1. NO LOWERCASED PARTICLES. Title-case libraries lowercase das/de/van/bin.
 *     This member base is Bengali: `sushanta das` → `Sushanta Das` and
 *     `SHARMISTHA DE` → `Sharmistha De`. Those are surnames.
 *  2. A WORD CONTAINING A DIGIT IS LEFT EXACTLY AS TYPED, e.g. the platform
 *     account `50mm Retina World` and a name like `3D Studio`.
 *     ⚠ CORRECTED 2026-08-15: the first version of this comment claimed
 *     `initcap()` renders "50mm" as "50Mm". It does not — Postgres counts
 *     digits as alphanumeric, so `initcap('50mm')` is `50mm`, verified on
 *     production. The guard is still load-bearing, for a DIFFERENT case:
 *     without it `3D` lowercases to `3d` and initcap leaves it there. The
 *     original justification was wrong; the code was right by accident.
 *  3. A CREDENTIALS SUFFIX IS PRESERVED VERBATIM. `SOMNATH PAL - AFIAP, AFIP,
 *     EFIP` — those are FIAP distinctions a photographer earned. Rendering
 *     them `Afiap, Afip, Efip` is a demotion, not a tidy-up. Everything from
 *     the first " - " or "," onward is untouched.
 */

/** Mirrors Postgres `initcap(lower(w))`: capitalise after every non-alphanumeric. */
function initcapWord(word: string): string {
  let out = "";
  let startOfWord = true;
  for (const ch of word.toLowerCase()) {
    const isAlnum = /[\p{L}\p{N}]/u.test(ch);
    out += startOfWord && isAlnum ? ch.toUpperCase() : ch;
    startOfWord = !isAlnum;
  }
  return out;
}

/**
 * Normalise a typed person name for storage and display.
 * Returns the input unchanged when it is null, undefined or blank, so a caller
 * can pass a possibly-missing name straight through.
 */
export function formatPersonName<T extends string | null | undefined>(raw: T): T {
  if (raw === null || raw === undefined) return raw;

  // Runs of whitespace are always a typo, never a style.
  const clean = String(raw).replace(/\s+/g, " ").trim();
  if (clean === "") return clean as T;

  // Split at the FIRST " - " or "," — a hyphen without spaces belongs to the
  // name itself (Anne-Marie) and is deliberately not a separator.
  const split = /^(.*?)(\s+-\s+.*|\s*,.*)$/.exec(clean);
  const namePart = split ? split[1].trim() : clean;
  const suffix = split ? split[2] : "";

  const words = namePart.split(" ").filter((w) => w !== "");
  const out = words.map((w) => {
    if (/[0-9]/.test(w)) return w; // "3D" must stay "3D", not become "3d"
    let t = initcapWord(w);
    // The one case initcap cannot know: Mc is a prefix, not a word.
    // "Mac" is deliberately NOT handled — Macey, Machado and Mackenzie would
    // all be broken by it.
    if (/^Mc[a-z]/.test(t)) t = "Mc" + t.charAt(2).toUpperCase() + t.slice(3);
    return t;
  });

  return (out.join(" ") + suffix) as T;
}
