/**
 * THE CERTIFICATE TYPE REGISTRY — ONE SOURCE OF TRUTH.
 *
 * ⚠ WHY THIS FILE EXISTS.
 *
 * The admin form's `<select>` carried four hard-coded options while the
 * database CHECK constraint permitted fourteen. Two consequences, both real
 * and both observed in production on 2026-08-24:
 *
 *   1. `achievement` and `custom` were offered by the UI and REFUSED by the
 *      database, so choosing either produced "Create failed" with no reason.
 *      0 of 23 production certificates carried either type because none could
 *      ever be written.
 *
 *   2. Far worse: opening EDIT on a certificate whose type was not one of the
 *      four options — say `competition_runner_up_2` — set
 *      `<select value="competition_runner_up_2">` with no matching `<option>`.
 *      A select with an unmatched value silently falls back to its FIRST
 *      option. The form then said `course_completion` while the admin was
 *      looking at a Runner-Up certificate, and saving rewrote the type or
 *      created a near-identical duplicate. Production carries three rows
 *      titled "Catch the Ball — 2nd Runner-Up Certificate" with three
 *      different types; two were created this way.
 *
 * Every type the constraint permits is therefore listed here, and the form
 * renders from this list. A type can never again be absent from the dropdown,
 * so the silent-fallback path cannot recur.
 *
 * `manual: true` marks the only kinds an admin issues by hand. The rest are
 * written by the system and appear here so EDIT can display them faithfully —
 * they are shown in a disabled group rather than offered for new issues,
 * because hand-issuing a competition award would bypass the competition.
 */

export interface CertTypeDef {
  /** The exact value stored in certificates.type — must match the CHECK constraint. */
  value: string;
  label: string;
  /** Admin may pick this when ISSUING a new certificate. */
  manual: boolean;
  group: "Manual" | "Course" | "Competition award" | "Member-requested";
  /** Who or what writes it, for the admin's benefit. */
  origin: string;
}

export const CERT_TYPES: CertTypeDef[] = [
  // ── Hand-issued ─────────────────────────────────────────────────────────
  { value: "achievement", label: "Achievement", manual: true, group: "Manual", origin: "Issued by an admin" },
  { value: "custom", label: "Custom", manual: true, group: "Manual", origin: "Issued by an admin" },

  // ── Course ──────────────────────────────────────────────────────────────
  { value: "course_completion", label: "Course Completion", manual: true, group: "Course", origin: "issue_course_completion_certificate(), or by hand" },

  // ── Competition awards — written by trg_auto_certificate_r4_award ───────
  { value: "competition_winner", label: "Winner", manual: false, group: "Competition award", origin: "Automatic when a Round-4 winner is set" },
  { value: "competition_runner_up_1", label: "1st Runner-Up", manual: false, group: "Competition award", origin: "Automatic on placement = runner_up_1" },
  { value: "competition_runner_up_2", label: "2nd Runner-Up", manual: false, group: "Competition award", origin: "Automatic on placement = runner_up_2" },
  { value: "competition_honorary_mention", label: "Honorary Mention", manual: false, group: "Competition award", origin: "Automatic on placement = honorary_mention" },
  { value: "competition_special_jury", label: "Special Jury Award", manual: false, group: "Competition award", origin: "Automatic on placement = special_jury" },
  { value: "competition_top_50", label: "Top 50", manual: false, group: "Competition award", origin: "Automatic on placement = top_50" },
  { value: "competition_top_100", label: "Top 100", manual: false, group: "Competition award", origin: "Automatic on placement = top_100" },

  // ── Member-requested from their own certificates page ───────────────────
  { value: "winner", label: "Winner (requested)", manual: false, group: "Member-requested", origin: "Requested by the member after R4 is published" },
  { value: "finalist", label: "Finalist", manual: false, group: "Member-requested", origin: "Requested by the member after R4 is published" },
  { value: "participation_r1", label: "Participation — Round 1", manual: false, group: "Member-requested", origin: "Requested by the member after R1 is published" },
  { value: "participation_r2", label: "Participation — Round 2", manual: false, group: "Member-requested", origin: "Requested by the member after R2 is published" },
  { value: "participation_r3", label: "Participation — Round 3", manual: false, group: "Member-requested", origin: "Requested by the member after R3 is published" },
  { value: "participation_r4", label: "Participation — Round 4", manual: false, group: "Member-requested", origin: "Requested by the member after R4 is published" },
];

/** Ordered group names, for rendering <optgroup>s deterministically. */
export const CERT_TYPE_GROUPS: CertTypeDef["group"][] = [
  "Manual",
  "Course",
  "Competition award",
  "Member-requested",
];

const BY_VALUE = new Map(CERT_TYPES.map((t) => [t.value, t]));

/** Human label, falling back to the raw value so an unknown type is still legible. */
export function certTypeLabel(value: string): string {
  return BY_VALUE.get(value)?.label ?? value.replace(/_/g, " ");
}

export function certTypeDef(value: string): CertTypeDef | undefined {
  return BY_VALUE.get(value);
}

export function isManualCertType(value: string): boolean {
  return BY_VALUE.get(value)?.manual === true;
}

/** Pill styling by family. Kept here so the list and the form cannot disagree. */
export function certTypeClass(value: string): string {
  const g = BY_VALUE.get(value)?.group;
  if (g === "Competition award") return "bg-primary/10 text-primary border-primary/30";
  if (g === "Course") return "bg-secondary text-secondary-foreground border-border";
  if (g === "Manual") return "bg-accent/40 text-accent-foreground border-accent";
  return "bg-muted text-muted-foreground border-border";
}
