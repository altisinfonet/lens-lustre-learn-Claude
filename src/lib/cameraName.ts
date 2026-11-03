/**
 * CAMERA NAME CLEANUP — pure, display only (Owner-approved fix 2026-11-03,
 * _control/out/OWNER/50mm-camera-line-FIX.html).
 *
 * EXIF gives a maker and a model, often shouting and often repeating each
 * other ("NIKON CORPORATION" + "NIKON Z 6_2"). Upload joins the two
 * (src/lib/exifExtract.ts), so live stores strings like
 * "NIKON CORPORATION NIKON Z 6_2". What a member should read is the camera:
 *
 *   NIKON CORPORATION + NIKON Z 6_2 → Nikon Z 6II
 *   Canon + Canon EOS R5            → Canon EOS R5
 *   SONY + ILCE-7M4                 → Sony α7 IV
 *   samsung + SM-S918B              → Samsung SM-S918B
 *
 * Rules: the maker is dropped from the front of the model when the model
 * already starts with it or with its brand word; the brand is printed in its
 * normal case; Nikon's "_2" / "_3" suffix is "II" / "III"; a few model codes
 * (Sony's ILCE-…) become the names on the camera. Unknown makers get a tidy
 * "Brand Model". Stored values are never rewritten — only what is shown.
 */

/** Known makers: every way EXIF spells them (upper case) → the brand word as printed. */
const MAKERS: readonly { spellings: readonly string[]; brand: string }[] = [
  { spellings: ["NIKON CORPORATION", "NIKON"], brand: "Nikon" },
  { spellings: ["CANON INC.", "CANON"], brand: "Canon" },
  { spellings: ["SONY CORPORATION", "SONY"], brand: "Sony" },
  { spellings: ["SAMSUNG ELECTRONICS", "SAMSUNG TECHWIN", "SAMSUNG"], brand: "Samsung" },
  { spellings: ["FUJIFILM CORPORATION", "FUJIFILM", "FUJI PHOTO FILM CO., LTD.", "FUJI"], brand: "Fujifilm" },
  { spellings: ["OLYMPUS IMAGING CORP.", "OLYMPUS CORPORATION", "OLYMPUS OPTICAL CO.,LTD", "OLYMPUS"], brand: "Olympus" },
  { spellings: ["OM DIGITAL SOLUTIONS", "OM SYSTEM"], brand: "OM System" },
  { spellings: ["PANASONIC"], brand: "Panasonic" },
  { spellings: ["LEICA CAMERA AG", "LEICA"], brand: "Leica" },
  { spellings: ["RICOH IMAGING COMPANY, LTD.", "RICOH"], brand: "Ricoh" },
  { spellings: ["PENTAX CORPORATION", "PENTAX"], brand: "Pentax" },
  { spellings: ["HASSELBLAD"], brand: "Hasselblad" },
  { spellings: ["SIGMA"], brand: "Sigma" },
  { spellings: ["APPLE"], brand: "Apple" },
  { spellings: ["GOOGLE"], brand: "Google" },
  { spellings: ["HUAWEI"], brand: "Huawei" },
  { spellings: ["XIAOMI"], brand: "Xiaomi" },
  { spellings: ["ONEPLUS"], brand: "OnePlus" },
  { spellings: ["OPPO"], brand: "Oppo" },
  { spellings: ["VIVO"], brand: "Vivo" },
  { spellings: ["MOTOROLA"], brand: "Motorola" },
  { spellings: ["REALME"], brand: "Realme" },
  { spellings: ["NOTHING"], brand: "Nothing" },
  { spellings: ["LG ELECTRONICS", "LGE"], brand: "LG" },
  { spellings: ["HMD GLOBAL", "NOKIA"], brand: "Nokia" },
  { spellings: ["DJI"], brand: "DJI" },
  { spellings: ["GOPRO"], brand: "GoPro" },
];

/** Model codes whose printed name differs (brand word implied). Small on purpose. */
const KNOWN_MODELS: Readonly<Record<string, { brand: string; name: string }>> = {
  "ILCE-1": { brand: "Sony", name: "α1" },
  "ILCE-9": { brand: "Sony", name: "α9" },
  "ILCE-9M2": { brand: "Sony", name: "α9 II" },
  "ILCE-9M3": { brand: "Sony", name: "α9 III" },
  "ILCE-7": { brand: "Sony", name: "α7" },
  "ILCE-7M2": { brand: "Sony", name: "α7 II" },
  "ILCE-7M3": { brand: "Sony", name: "α7 III" },
  "ILCE-7M4": { brand: "Sony", name: "α7 IV" },
  "ILCE-7C": { brand: "Sony", name: "α7C" },
  "ILCE-7CM2": { brand: "Sony", name: "α7C II" },
  "ILCE-7CR": { brand: "Sony", name: "α7CR" },
  "ILCE-7RM2": { brand: "Sony", name: "α7R II" },
  "ILCE-7RM3": { brand: "Sony", name: "α7R III" },
  "ILCE-7RM3A": { brand: "Sony", name: "α7R IIIA" },
  "ILCE-7RM4": { brand: "Sony", name: "α7R IV" },
  "ILCE-7RM4A": { brand: "Sony", name: "α7R IVA" },
  "ILCE-7RM5": { brand: "Sony", name: "α7R V" },
  "ILCE-7SM2": { brand: "Sony", name: "α7S II" },
  "ILCE-7SM3": { brand: "Sony", name: "α7S III" },
  "ILCE-6000": { brand: "Sony", name: "α6000" },
  "ILCE-6100": { brand: "Sony", name: "α6100" },
  "ILCE-6300": { brand: "Sony", name: "α6300" },
  "ILCE-6400": { brand: "Sony", name: "α6400" },
  "ILCE-6500": { brand: "Sony", name: "α6500" },
  "ILCE-6600": { brand: "Sony", name: "α6600" },
  "ILCE-6700": { brand: "Sony", name: "α6700" },
};

const squash = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** `text` starts with `word` as a whole word (case-insensitive)? Returns the rest, else null. */
function afterWord(text: string, word: string): string | null {
  if (!word) return null;
  const head = text.slice(0, word.length);
  if (head.toUpperCase() !== word.toUpperCase()) return null;
  const rest = text.slice(word.length);
  if (rest !== "" && !/^[\s,]/.test(rest)) return null;
  return rest.replace(/^[\s,]+/, "");
}

/** The longest known maker spelling at the front of `text`. */
function knownMakerAt(text: string): { brand: string; rest: string } | null {
  let best: { brand: string; rest: string; len: number } | null = null;
  for (const m of MAKERS) {
    for (const sp of m.spellings) {
      const rest = afterWord(text, sp);
      if (rest !== null && (!best || sp.length > best.len)) best = { brand: m.brand, rest, len: sp.length };
    }
  }
  return best && { brand: best.brand, rest: best.rest };
}

/** A shouting or all-lower maker word in normal case ("ACME" → "Acme"); mixed case is left alone. */
function normalCase(word: string): string {
  if (!/^[A-Za-z]{3,}$/.test(word)) return word;
  if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** The model with the brand's own conventions applied. */
function tidyModel(brand: string, model: string): { brand: string; model: string } {
  const known = KNOWN_MODELS[model.toUpperCase()];
  if (known) return { brand: known.brand, model: known.name };
  if (brand === "Nikon") model = model.replace(/_(2|3)$/, (_m, n: string) => (n === "2" ? "II" : "III"));
  return { brand, model };
}

/** Brand + model, without the brand twice. */
function join(brand: string, model: string): string | undefined {
  // The model may repeat the brand word ("NIKON Z 6_2", "Canon EOS R5").
  const again = afterWord(model, brand);
  const m = squash(again ?? model);
  const t = tidyModel(brand, m);
  return squash(`${t.brand} ${t.model}`) || undefined;
}

/** EXIF maker + model → the name a member reads. */
export function cleanCameraName(maker: string | undefined, model: string | undefined): string | undefined {
  const mk = squash(maker);
  const md = squash(model);
  if (!mk && !md) return undefined;
  if (!mk) return cameraDisplayName(md);
  const known = knownMakerAt(mk);
  if (known && known.rest === "") return join(known.brand, md);
  // Unknown maker: print it in normal case, once.
  if (!md) return cameraDisplayName(mk);
  const brand = normalCase(mk);
  const rest = afterWord(md, mk);
  return squash(`${brand} ${rest ?? md}`) || undefined;
}

/**
 * A stored camera string (maker and model already joined, or the model alone)
 * → the name a member reads. Already-clean names pass through unchanged.
 */
export function cameraDisplayName(stored: string | undefined): string | undefined {
  const s = squash(stored);
  if (!s) return undefined;
  const known = knownMakerAt(s);
  if (known) return known.rest ? join(known.brand, known.rest) : known.brand;
  const code = KNOWN_MODELS[s.toUpperCase()];
  if (code) return `${code.brand} ${code.name}`;
  // Unknown: first word is the maker; drop a doubled maker, normal case.
  const [first, ...rest] = s.split(" ");
  const tail = rest.join(" ");
  const dedup = afterWord(tail, first);
  return squash(`${normalCase(first)} ${dedup ?? tail}`);
}
