/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OBJECT STORE IS THE ONE LANE BOUNDARY WITH NO UNDO.
 *
 * A bundle wired to the wrong backend is a bad deploy, reversible by another
 * deploy. Member photographs written into the wrong bucket — or deleted from
 * the right one by a staging cleanup job — are gone.
 *
 * The bucket name lives in the database (`site_settings.s3_storage_settings`),
 * not in this repository and not in any environment variable, which is exactly
 * why it needs asserting: a staging project restored from a production dump
 * inherits production's bucket AND production's public_url, while every other
 * lane signal correctly says staging.
 *
 * These tests import supabase/functions/_shared/s3.ts directly. That file has
 * no imports of its own and reads SUPABASE_URL through `globalThis` rather than
 * an ambient `Deno` declaration, so pulling it into the web TypeScript program
 * here costs nothing and leaks no Deno namespace into src/.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertStorageLane,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_BUCKET,
  PRODUCTION_CDN_HOST,
} from "../../supabase/functions/_shared/s3";

const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const STAGING_REF = "ztzutckwdhetphwghuzj";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

describe("assertStorageLane — each lane keeps its own objects", () => {
  it("production ref with the production bucket passes", () => {
    expect(() =>
      assertStorageLane(
        { bucket_name: PRODUCTION_BUCKET, public_url: `https://${PRODUCTION_CDN_HOST}` },
        PROD_URL,
      ),
    ).not.toThrow();
  });

  it("a staging ref with its own bucket passes", () => {
    expect(() =>
      assertStorageLane(
        { bucket_name: "50mm-staging", public_url: "https://cdn-staging.50mmretina.com" },
        STAGING_URL,
      ),
    ).not.toThrow();
  });

  it("a staging ref holding the PRODUCTION bucket throws", () => {
    // The restored-dump shape. Every other signal says staging; the writes land
    // on live member photographs.
    expect(() => assertStorageLane({ bucket_name: PRODUCTION_BUCKET }, STAGING_URL)).toThrow(
      /NOT production but is configured with the production bucket/,
    );
  });

  it("a staging ref whose public_url names the production CDN throws", () => {
    expect(() =>
      assertStorageLane(
        { bucket_name: "50mm-staging", public_url: `https://${PRODUCTION_CDN_HOST}` },
        STAGING_URL,
      ),
    ).toThrow(/names the production CDN/);
  });

  it("the production ref pointed at a non-production bucket throws", () => {
    // The inverse direction, and the reason the rule is symmetric: production
    // writing into another lane's bucket is a loss too, just a quieter one.
    expect(() => assertStorageLane({ bucket_name: "50mm-staging" }, PROD_URL)).toThrow(
      /PRODUCTION project .* is configured with bucket/,
    );
  });

  // ⚠ THE PREFIX TRAP, PINNED. "50mm" is a prefix of "50mm-staging", so an
  // `includes`/`startsWith` refactor would classify the staging bucket as
  // production and refuse every legitimate staging write. Equality is the whole
  // rule; this case is what kills the refactor rather than merely annoying it.
  it("a staging bucket that merely STARTS WITH the production name is fine", () => {
    expect(() => assertStorageLane({ bucket_name: `${PRODUCTION_BUCKET}-staging` }, STAGING_URL)).not.toThrow();
  });

  it("refuses whenever the lane cannot be determined, rather than guessing one", () => {
    // Guessing production blocks a real deploy; guessing staging waves a
    // deletion job through onto live objects. Both are wrong, so neither is the
    // default.
    for (const bad of [undefined, "", "not-a-url", "https://evil.example", "http://x.supabase.co"]) {
      expect(() => assertStorageLane({ bucket_name: PRODUCTION_BUCKET }, bad)).toThrow(
        /storage lane cannot be determined/,
      );
    }
  });

  it("an empty bucket name throws", () => {
    expect(() => assertStorageLane({ bucket_name: "" }, PROD_URL)).toThrow(/bucket_name is empty/);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BYPASS DETECTOR
 *
 * assertStorageLane only protects callers that go through getS3Settings. Six
 * functions carry their own SigV4 and read the settings row themselves, so they
 * are unprotected — and a seventh appearing unnoticed is how the protection
 * quietly stops meaning anything.
 *
 * ⚠ MATCHED ON THE QUERY SHAPE, NOT ON A MENTION OF THE STRING.
 * `measure-post-media` contains "s3_storage_settings" only inside a comment
 * stating that it deliberately never reads that row. A mention-based list would
 * have enshrined that comment as a bypass and made the pin permanently wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
const SETTINGS_QUERY = /\.eq\(\s*["']key["']\s*,\s*["']s3_storage_settings["']\s*\)/;

function functionSources(): Array<[string, string]> {
  return readdirSync(FUNCTIONS_DIR)
    .filter((n) => n !== "_shared")
    .map((n) => [n, join(FUNCTIONS_DIR, n, "index.ts")] as [string, string])
    .filter(([, p]) => existsSync(p))
    .map(([n, p]) => [n, readFileSync(p, "utf8")] as [string, string]);
}

describe("storage bypass detector", () => {
  it("exactly six functions read the settings row without getS3Settings", () => {
    const EXPECTED = [
      "hard-delete-competition",
      "migrate-storage",
      "s3-delete",
      "s3-presign-upload",
      "s3-signed-url",
      "s3-upload",
    ];
    // ⚠ THE DEFINITION IS STRUCTURAL: "reads the settings row itself".
    // An earlier version also filtered on whether the file mentioned
    // getS3Settings, to mean "and is therefore unprotected". Adding the G9
    // assertion put the word "getS3Settings" into a COMMENT in all six, the
    // filter matched it, and the list silently emptied — a pin that counts
    // nothing while still reporting green. Same failure as a mention-based
    // match on measure-post-media, one level up. Prose is not a predicate.
    const found = functionSources()
      .filter(([, src]) => SETTINGS_QUERY.test(src))
      .map(([name]) => name)
      .sort();
    // A seventh appearing fails here. One leaving the list must leave because it
    // now calls assertStorageLane (directly or via getS3Settings) — not because
    // it stopped reading the row while still signing its own requests.
    expect(found).toEqual(EXPECTED);
    // ⚠ THE LIST STAYS AT SIX. These six still read the settings row directly
    // and still sign their own requests — that has not changed and is not the
    // thing being fixed. What changed is that each now calls assertStorageLane
    // before signing. Narrowing the list to "unasserted readers" would empty it
    // and make a SEVENTH reader invisible again, which is the whole point of a
    // pin: it counts readers, not remaining defects.
    for (const name of found) {
      const src = readFileSync(join(FUNCTIONS_DIR, name, "index.ts"), "utf8");
      expect(src, `${name} reads the settings row but never asserts its lane`).toMatch(
        /assertStorageLane\s*\(/,
      );
      expect(src, `${name} does not import assertStorageLane from the shared module`).toMatch(
        /import\s*\{[^}]*assertStorageLane[^}]*\}\s*from\s*["'][^"']*_shared\/s3\.ts["']/,
      );
    }
  });

  it("the four mention-only functions still only mention the key", () => {
    // Second pin, so a NEW key reference is visible even when it is not a
    // bypass. These four name the key in an export list, a redaction list, a
    // settings fetch, and a comment respectively — none of them signs an S3
    // request.
    const MENTION_ONLY = ["admin-export-db", "admin-secure-settings", "dashboard-init", "measure-post-media"];
    const found = functionSources()
      .filter(([, src]) => src.includes("s3_storage_settings") && !SETTINGS_QUERY.test(src))
      .map(([name]) => name)
      .sort();
    expect(found).toEqual(MENTION_ONLY);
    for (const name of MENTION_ONLY) {
      const src = readFileSync(join(FUNCTIONS_DIR, name, "index.ts"), "utf8");
      expect(src).not.toMatch(/AWS4-HMAC-SHA256/);
    }
  });
});
