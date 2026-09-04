/**
 * F-76 · The third category for the SECURITY DEFINER guard.
 *
 * WHY THIS EXISTS. `securityDefinerGrants.test.ts` had exactly two ways for a
 * SECURITY DEFINER function to pass: revoked from anon by name, or gated
 * internally on auth.uid()/has_role. `get_top_contributors_v3` is neither and
 * is not a defect — it is the Home page Top Contributors card, and it MUST work
 * for a logged-out visitor. It is a third thing: DELIBERATELY PUBLIC.
 *
 * A guard with no way to express a legitimate case has two futures: somebody
 * disables it, or it stays red until everyone ignores it. Both end with the
 * guard not guarding — the same disease as F-72 and F-73.
 *
 * SO THE CATEGORY EXISTS, AND IT IS EXPENSIVE TO CLAIM. Three conditions, ALL
 * required, and the claim lives in the MIGRATION rather than in an allow-list
 * here. An allow-list in the test file is invisible from the migration it
 * excuses, and it rots: the function gets rewritten, the entry stays.
 *
 *   1. AN EXPLICIT MARKER naming the function and giving a real reason. Prose,
 *      not a bare tag — someone has to write down why a logged-out visitor must
 *      be able to call this, and their words sit next to the grant forever.
 *
 *   2. THE F-62-SAFE GRANT SHAPE: `REVOKE ALL ... FROM public` BEFORE
 *      `GRANT EXECUTE ... TO anon`. A bare GRANT with no preceding REVOKE still
 *      FAILS and is NOT waivable by any marker. That is the trap that kept anon
 *      reachable through PUBLIC — `REVOKE ... FROM anon` is a no-op while
 *      PUBLIC holds the grant — and a marker must never be able to excuse it.
 *
 *   3. NOT VOLATILE. A public VOLATILE SECURITY DEFINER function is the
 *      amplification class, not the read class: an anonymous caller making the
 *      database do unbounded write work. No reason excuses that, so no marker
 *      can. Note PostgreSQL's default is VOLATILE, so a function that states no
 *      volatility at all is VOLATILE and fails here — silence is not a claim.
 *
 * Missing any one of the three fails, and the verdict says WHICH.
 */

/** Minimum prose after the marker. A bare tag or a one-word shrug is not a reason. */
export const MIN_REASON_CHARS = 20;

export const MARKER_TAG = "PUBLIC-BY-DESIGN";

export interface PublicByDesignVerdict {
  /** A marker for this function is present at all. */
  claimed: boolean;
  /** All three conditions hold. */
  ok: boolean;
  /** Which conditions failed, in the order they are numbered above. */
  failures: string[];
  /** The reason prose, when a well-formed marker was found. */
  reason: string | null;
}

/** Escape a function name for use inside a RegExp. Names are [a-z0-9_] in
 *  practice; this is belt and braces so a odd name cannot alter the pattern. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Condition 1 — `-- PUBLIC-BY-DESIGN: <function> — <reason>`.
 *
 * The separator may be an em dash, an en dash, a hyphen or a colon; the reason
 * runs to the end of the line and must be real prose.
 */
function findMarker(sql: string, fnName: string): { found: boolean; reason: string | null } {
  const re = new RegExp(
    `--\\s*${MARKER_TAG}\\s*:\\s*${esc(fnName)}\\s*(?:\\(\\s*\\))?\\s*[—–\\-:]\\s*(.*)`,
    "i",
  );
  const m = sql.match(re);
  if (!m) return { found: false, reason: null };
  return { found: true, reason: m[1].trim() };
}

/** Condition 2 — the REVOKE that actually closes PUBLIC, before the GRANT. */
function grantShape(sql: string, fnName: string): { ok: boolean; detail: string } {
  const fn = esc(fnName);

  const revokeRe = new RegExp(
    `REVOKE\\s+ALL(?:\\s+PRIVILEGES)?[^;]*?ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)[^;]*?FROM[^;]*?\\bpublic\\b`,
    "i",
  );
  const grantRe = new RegExp(
    `GRANT\\s+EXECUTE[^;]*?ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)[^;]*?TO[^;]*?\\banon\\b`,
    "i",
  );

  const revoke = sql.match(revokeRe);
  const grant = sql.match(grantRe);

  if (!revoke) {
    return {
      ok: false,
      detail:
        `no \`REVOKE ALL ON FUNCTION public.${fnName}(...) FROM public\`. ` +
        `REVOKE ... FROM anon is a no-op while PUBLIC holds the grant (F-62), ` +
        `so without this the function stays anon-reachable no matter what else the file says`,
    };
  }
  if (grant && revoke.index !== undefined && grant.index !== undefined && revoke.index > grant.index) {
    return {
      ok: false,
      detail:
        `the REVOKE ... FROM public comes AFTER the GRANT ... TO anon; ` +
        `it must precede it, or it strips the grant the file just made`,
    };
  }
  return { ok: true, detail: "" };
}

/** Condition 3 — VOLATILE is the PostgreSQL default, so silence fails too. */
function volatility(header: string): { ok: boolean; detail: string } {
  if (/\bVOLATILE\b/i.test(header)) {
    return {
      ok: false,
      detail:
        "the function is declared VOLATILE. A public VOLATILE SECURITY DEFINER " +
        "function lets an anonymous caller drive unbounded write work; that is the " +
        "amplification class and no marker excuses it",
    };
  }
  if (!/\bSTABLE\b|\bIMMUTABLE\b/i.test(header)) {
    return {
      ok: false,
      detail:
        "the function declares no volatility, and PostgreSQL's default is VOLATILE. " +
        "State STABLE or IMMUTABLE explicitly — silence is not a claim",
    };
  }
  return { ok: true, detail: "" };
}

/**
 * Judge one SECURITY DEFINER function against the deliberately-public category.
 *
 * `header` is the CREATE FUNCTION header up to the body marker, which is where
 * the volatility keyword lives.
 */
export function publicByDesignVerdict(
  sql: string,
  fnName: string,
  header: string,
): PublicByDesignVerdict {
  const marker = findMarker(sql, fnName);
  const failures: string[] = [];

  if (!marker.found) {
    failures.push(
      `(1) no \`-- ${MARKER_TAG}: ${fnName} — <reason>\` marker in the migration`,
    );
  } else if ((marker.reason ?? "").length < MIN_REASON_CHARS) {
    failures.push(
      `(1) the ${MARKER_TAG} marker has no real reason after it ` +
        `(needs at least ${MIN_REASON_CHARS} characters of prose saying why a ` +
        `logged-out visitor must be able to call ${fnName})`,
    );
  }

  const shape = grantShape(sql, fnName);
  if (!shape.ok) failures.push(`(2) ${shape.detail}`);

  const vol = volatility(header);
  if (!vol.ok) failures.push(`(3) ${vol.detail}`);

  return {
    claimed: marker.found,
    ok: failures.length === 0,
    failures,
    reason: marker.reason,
  };
}
