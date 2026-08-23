/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LANE CONFIG FOR EDGE FUNCTIONS
 *
 * Measured before this file existed: no edge function read any origin variable.
 * Every address an email carried was a literal pointing at production, so a
 * staging lane sending a password-reset or a re-engagement nudge sent members
 * to the production site — and the member cannot tell, because the link works.
 * An email is the one artefact that outlives the deploy that produced it.
 *
 * REQUIRED, NEVER DEFAULTED — the G5b rule, for the same reason. A production
 * default is not a safety net here; it is the bug wearing one. A lane that
 * forgets SITE_ORIGIN would silently become production rather than fail, and
 * the failure would be invisible in the only place it matters: a member's inbox.
 *
 * ⚠ SITE_ORIGIN VIA globalThis, NOT AN AMBIENT `Deno` DECLARATION.
 * These modules run on Deno, but `_shared/` is pulled into the web TypeScript
 * program by its vitest suites; declaring `Deno` globally would leak that
 * namespace into every src/ file and break tsconfig.app.json.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function env(name: string): string | undefined {
  return (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } })
    .Deno?.env?.get(name);
}

/**
 * Read one required lane variable. Unset and set-but-empty are both refusals:
 * an empty string would compose into `https:///reset-password`, a link that is
 * broken rather than merely wrong, and shipped to a member either way.
 */
function laneValue(name: string): string {
  const raw = env(name);
  if (raw === undefined || raw === null) {
    throw new Error(
      `${name} is not set. Edge functions have no build step, so this must be defined in the ` +
        `function environment for this lane. There is no production default — falling back ` +
        `would silently make every lane send members to production.`,
    );
  }
  const value = String(raw).trim();
  if (value === "") {
    throw new Error(`${name} is set but empty. An empty string is a configuration error, not a default.`);
  }
  return value;
}

/**
 * This lane's public origin, with trailing slashes stripped so callers can
 * append a rooted path without doubling the separator.
 *
 * Rejects anything that is not `https://host.tld`: a bare host would compose
 * into a relative link, and `http://` in an email is a downgrade a mail client
 * will happily follow.
 */
export function siteOrigin(): string {
  const raw = laneValue("SITE_ORIGIN").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(raw)) {
    throw new Error(
      `SITE_ORIGIN is not a https://host.tld origin (got: "${raw}"). An email link is not ` +
        `retractable once sent, so a malformed origin is refused rather than emitted.`,
    );
  }
  return raw;
}

/** This lane's origin plus a rooted path: siteUrl("/dashboard"). */
export function siteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteOrigin()}${p}`;
}

/**
 * A public email asset in THIS lane's storage bucket.
 *
 * Derived from SUPABASE_URL rather than its own variable, deliberately: every
 * edge function receives SUPABASE_URL automatically from the platform, so there
 * is no variable for a lane to forget — and forgetting is exactly how the logo
 * ends up loading from production, which is both a lane leak and a quiet
 * request-time signal to production about who is reading a staging email.
 */
export function emailAssetUrl(file: string): string {
  const base = laneValue("SUPABASE_URL").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9]{15,25}\.supabase\.co$/i.test(base)) {
    throw new Error(`SUPABASE_URL is not a https://<ref>.supabase.co URL (got: "${base}").`);
  }
  return `${base}/storage/v1/object/public/email-assets/${file.replace(/^\/+/, "")}`;
}
