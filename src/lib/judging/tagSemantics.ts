/**
 * Phase A — Tag Semantics Map (READ-ONLY, NO SIDE EFFECTS)
 * ----------------------------------------------------------
 * Single source of truth that classifies every admin-defined judging tag into
 * a functional FAMILY. Downstream phases (B = DB, C = trigger fn, D = participant
 * UI, E = admin queue, F = rejection wiring) will consume this map.
 *
 * This file performs ZERO writes, ZERO network calls, ZERO DB mutations.
 * It only inspects the tag's `label` (and `visible_in_round`) and returns a
 * classification object. Safe to import anywhere.
 *
 * Rules of classification (locked, do not infer):
 *   - PROGRESSION_PASS  → tag advances the photo to the NEXT round
 *                         (e.g. "Accepted", "Qualified for 2nd Round",
 *                          "Qualified for Round 3", "Qualified for Final Round")
 *   - PROGRESSION_FAIL  → tag explicitly rejects the photo from the NEXT round
 *                         while keeping its CURRENT-round qualification intact
 *                         (e.g. "Not Selected for 3rd Round" — photo passed R2
 *                         but is OUT for R3)
 *   - REJECTION         → tag terminates the photo entirely from the competition
 *                         (e.g. "Rejected" in R1)
 *   - VERIFICATION      → tag puts the photo on HOLD pending participant
 *                         submitting the original RAW/source file
 *                         (e.g. "Verification Required - Round N")
 *   - AWARD             → tag confers a Round-4 award/honor
 *                         (e.g. "Winner", "1st Runner-Up", "Honorable Mention",
 *                          "Top 10 Global Photographer", "Special Jury Award",
 *                          "Best Moment Award")
 *   - UNKNOWN           → label does not match any known pattern. Treated as
 *                         a NO-OP by downstream phases until an admin renames
 *                         or an engineer extends this map.
 */

export type TagFamily =
  | "progression_pass"
  | "progression_fail"
  | "rejection"
  | "verification"
  | "needs_review"
  | "award"
  | "unknown";

export interface TagSemantic {
  family: TagFamily;
  /** For progression_pass: which round the photo advances TO. null otherwise. */
  advancesToRound: number | null;
  /** For progression_fail: which round the photo is OUT of. null otherwise. */
  blocksFromRound: number | null;
  /** For verification: which round the verification request originates from. */
  verificationRound: number | null;
  /** Plain-English explanation, used by the admin diagnostic page. */
  explanation: string;
}

interface TagInput {
  label: string;
  visible_in_round?: number[] | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Tiny helper: does the normalized label match this exact phrase? */
const eq = (n: string, phrase: string) => n === norm(phrase);
/** Tiny helper: does the normalized label include this phrase? */
const has = (n: string, phrase: string) => n.includes(norm(phrase));

export function classifyTag(tag: TagInput): TagSemantic {
  const n = norm(tag.label || "");
  const round =
    Array.isArray(tag.visible_in_round) && tag.visible_in_round.length > 0
      ? tag.visible_in_round[0]
      : null;

  // ---- VERIFICATION (Spec v3: workflow deleted, fold any legacy "Verification Required" tags into Needs Review) ----
  if (has(n, "verification required") || eq(n, "needs review")) {
    return {
      family: "needs_review",
      advancesToRound: null,
      blocksFromRound: null,
      verificationRound: null,
      explanation: `Photo deferred for review in Round ${round ?? "?"}. Round cannot be completed while any photo is in this state. Participant will be emailed to reply with the original RAW file when the round is published.`,
    };
  }

  // ---- NEEDS REVIEW (Spec v3 §1.2 / §2.4 / §3.3 / §4.2) ----
  if (eq(n, "needs review")) {
    return {
      family: "needs_review",
      advancesToRound: null,
      blocksFromRound: null,
      verificationRound: null,
      explanation: `Photo deferred for review in Round ${round ?? "?"}. Round cannot be completed while any photo is in this state.`,
    };
  }

  // ---- PROGRESSION FAIL (explicit "Not Selected for ...") ----
  if (has(n, "not selected for")) {
    // "Not Selected for 3rd Round" → blocked from round 3
    // "Not Selected for Final Round" → blocked from round 4
    let blocked: number | null = null;
    if (has(n, "2nd round")) blocked = 2;
    else if (has(n, "3rd round")) blocked = 3;
    else if (has(n, "4th round") || has(n, "final round")) blocked = 4;
    return {
      family: "progression_fail",
      advancesToRound: null,
      blocksFromRound: blocked,
      verificationRound: null,
      explanation: `Photo PASSED its current round (R${round ?? "?"}) but is OUT for Round ${blocked ?? "?"}. Keeps current-round qualification.`,
    };
  }

  // Ruleset v4 (2026-04-29): the 'Stay' bucket is REMOVED. "Stayed at RN"
  // tags are soft-deleted in DB; if any legacy row still surfaces it falls
  // through to "unknown" and downstream phases treat it as a no-op.

  // Spec v3 renamed "Rejected" → "Reject"; accept both for forward compatibility.
  if (eq(n, "rejected") || eq(n, "reject")) {
    return {
      family: "rejection",
      advancesToRound: null,
      blocksFromRound: null,
      verificationRound: null,
      explanation: `Photo is REJECTED from the competition entirely (Round ${round ?? "?"}).`,
    };
  }

  // ---- PROGRESSION PASS ----
  // Spec v3 wording (and legacy):
  //   "Accept"  / "Accepted"               (R1 → R2)
  //   "Shortlist for R2" / "Qualified for 2nd Round" / "Qualified for R2" (R1 → R2)
  //   "Qualified for R3" / "Qualified for 3rd Round" / "Qualified for Round 3" (R2 → R3)
  //   "Shortlisted for Final" / "Qualified for Final Round" / "Qualified for Final" (R3 → R4)
  if (eq(n, "accepted") || eq(n, "accept")) {
    return {
      family: "progression_pass",
      advancesToRound: 2,
      blocksFromRound: null,
      verificationRound: null,
      explanation: "Photo accepted in Round 1, advances to Round 2.",
    };
  }
  // Spec v3: "Shortlist for R2" → R1 promotes to R2;
  // "Shortlist/Shortlisted for Final Round" → R3 promotes to R4.
  if (has(n, "shortlist for r2") || has(n, "shortlist for final") || has(n, "shortlisted for final")) {
    const advances = has(n, "shortlist for final") || has(n, "shortlisted for final") ? 4 : 2;
    return {
      family: "progression_pass",
      advancesToRound: advances,
      blocksFromRound: null,
      verificationRound: null,
      explanation: `Photo qualifies and advances to Round ${advances}.`,
    };
  }
  if (has(n, "qualified for")) {
    let advances: number | null = null;
    // Order matters: more specific first.
    if (has(n, "final")) advances = 4;
    else if (has(n, "2nd round") || has(n, "round 2") || has(n, " r2")) advances = 2;
    else if (has(n, "3rd round") || has(n, "round 3") || has(n, " r3")) advances = 3;
    else if (has(n, "round 4") || has(n, "4th round") || has(n, " r4")) advances = 4;
    if (advances !== null) {
      return {
        family: "progression_pass",
        advancesToRound: advances,
        blocksFromRound: null,
        verificationRound: null,
        explanation: `Photo qualifies and advances to Round ${advances}.`,
      };
    }
  }

  // ---- AWARDS (Round 4 honors) ----
  // Spec v3 §4.3 palette + auto-tier output (Qualified for Final).
  // Both new and legacy wording listed for forward compatibility.
  const awardPhrases = [
    "winner",
    "1st runner-up", "1st runner up",
    "2nd runner-up", "2nd runner up",
    "honorary mention", "honorable mention",
    "special jury", "special jury award",
    "best moment award",
    "top 10 global photographer",
    "top 50", "top 50 finalist",
    "top 100", "top 100 global photographer",
    "qualified for final",
  ];
  if (awardPhrases.some((p) => eq(n, p))) {
    return {
      family: "award",
      advancesToRound: null,
      blocksFromRound: null,
      verificationRound: null,
      explanation: `Round 4 award/honor: "${tag.label}". No progression effect; recognized in certificates & results.`,
    };
  }

  // ---- UNKNOWN (treated as no-op until classified) ----
  return {
    family: "unknown",
    advancesToRound: null,
    blocksFromRound: null,
    verificationRound: null,
    explanation: `No classification rule matched. Downstream phases will IGNORE this tag (no-op) until added to the map.`,
  };
}

/** Convenience: classify a list of tags. Pure. */
export function classifyTags<T extends TagInput>(tags: T[]) {
  return tags.map((t) => ({ tag: t, semantic: classifyTag(t) }));
}
