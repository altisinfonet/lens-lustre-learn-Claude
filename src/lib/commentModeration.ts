// Client-side comment moderation: PREVIEW ONLY (instant feedback)
// The edge function "moderate-comment" is the single source of truth for flagging.

const PROFANITY_LIST = [
  "fuck", "shit", "ass", "bitch", "damn", "dick", "cock", "pussy", "bastard",
  "whore", "slut", "cunt", "fag", "nigger", "retard", "rape",
  "motherfucker", "asshole", "bullshit", "goddamn", "piss",
  // Common obfuscations
  "f u c k", "s h i t", "b i t c h", "f*ck", "sh*t", "b*tch", "a$$",
  "fck", "fuk", "stfu", "wtf", "lmfao",
];

// Core abusive words for fuzzy matching (catches misspellings)
const FUZZY_TARGETS = [
  "fuck", "shit", "bitch", "bastard", "asshole", "nigger", "cunt",
  "whore", "slut", "retard", "dick", "cock", "pussy", "rape",
  "idiot", "stupid",
];

// Known misspelling variants that bypass word-boundary checks
const KNOWN_VARIANTS = [
  "bstrd", "busterd", "bastrd", "bastad", "bustard",
  "fuk", "fck", "phuck", "phuk", "fuxk", "fucc",
  "sht", "shiit", "shyt", "sh1t",
  "btch", "biatch", "beyatch", "b1tch",
  "azz", "a55", "azhole", "a55hole",
  "d1ck", "d!ck", "dik", "dicc",
  "cnt", "kunt",
  "rtard", "retrd",
  "niga", "nigg", "n1gger", "niggr",
  "hor", "wh0re", "h0e",
  "sIut", "s1ut",
  "idi0t", "idot", "ideot",
  "stupd", "stup1d", "stoopid",
];

const URL_PATTERN = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(com|org|net|io|co|me|info|biz|xyz|online|site|top|click|link|gq|ml|cf|ga|tk))/i;

const SPAM_PATTERNS = [
  /buy\s+now/i,
  /click\s+here/i,
  /free\s+(money|gift|card|iphone|bitcoin|crypto)/i,
  /earn\s+\$?\d+/i,
  /make\s+money/i,
  /limited\s+time\s+offer/i,
  /act\s+now/i,
  /congratulations.*won/i,
  /100%\s+free/i,
  /dm\s+me/i,
  /follow\s+me\s+@/i,
  /check\s+(my|out)\s+(bio|profile|link)/i,
  /whatsapp/i,
  /telegram/i,
];

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  flagType?: "profanity" | "url" | "spam";
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalize text: leet-speak substitution + strip non-alpha */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[^a-z]/g, "");
}

/** Check if tokenized words fuzzy-match any target abusive word */
function hasFuzzyMatch(originalText: string): boolean {
  // Tokenize on non-alpha characters to get real words
  const tokens = originalText.toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 3);

  for (const token of tokens) {
    for (const word of FUZZY_TARGETS) {
      if (word.length < 5) continue; // skip short targets — handled by exact match
      if (token === word) return true;
      const tolerance = word.length <= 5 ? 1 : 2;
      if (Math.abs(token.length - word.length) > tolerance) continue; // quick length check
      if (levenshtein(token, word) <= tolerance) return true;
    }
  }
  return false;
}

export function moderateComment(text: string): ModerationResult {
  const lower = text.toLowerCase().trim();

  if (!lower || lower.length < 1) {
    return { allowed: false, reason: "Comment cannot be empty" };
  }

  if (lower.length > 2000) {
    return { allowed: false, reason: "Comment is too long (max 2000 characters)" };
  }

  // Check profanity (exact word-boundary match)
  for (const word of PROFANITY_LIST) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lower)) {
      console.log("MODERATION RESULT", { content: text, normalized: lower, matchedWord: word, method: "keyword" });
      return { allowed: false, reason: "Comment contains inappropriate language", flagType: "profanity" };
    }
  }

  // Check known misspelling variants (only flag short inputs to avoid false positives on long text)
  const normalized = normalize(text);
  if (normalized.length <= 20) {
    for (const variant of KNOWN_VARIANTS) {
      if (normalized.includes(variant)) {
        console.log("MODERATION RESULT", { content: text, normalized, matchedWord: variant, method: "variant" });
        return { allowed: false, reason: "Comment contains inappropriate language", flagType: "profanity" };
      }
    }
  }

  // Fuzzy matching on tokenized words (not full normalized string)
  if (hasFuzzyMatch(text)) {
    console.log("MODERATION RESULT", { content: text, normalized, matchedWord: "fuzzy-match", method: "fuzzy" });
    return { allowed: false, reason: "Comment contains inappropriate language", flagType: "profanity" };
  }

  // Check URLs
  if (URL_PATTERN.test(text)) {
    return { allowed: false, reason: "URLs are not allowed in comments", flagType: "url" };
  }

  // Check spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      return { allowed: false, reason: "Comment detected as spam", flagType: "spam" };
    }
  }

  // Excessive caps (more than 70% uppercase in messages > 10 chars)
  if (lower.length > 10) {
    const upperCount = (text.match(/[A-Z]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 0 && upperCount / letterCount > 0.7) {
      return { allowed: false, reason: "Please avoid excessive use of capital letters", flagType: "spam" };
    }
  }

  // Repetitive characters (e.g. "aaaaaaa")
  if (/(.)\1{5,}/i.test(text)) {
    return { allowed: false, reason: "Comment contains repetitive characters", flagType: "spam" };
  }

  return { allowed: true };
}
