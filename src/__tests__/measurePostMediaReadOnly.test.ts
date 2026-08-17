/**
 * THE MEASUREMENT FUNCTION MUST STAY READ-ONLY, ADMIN-ONLY AND UNABLE TO FETCH
 * ANYTHING A CALLER NAMES.
 *
 * `supabase/functions/measure-post-media` was deployed to production for one
 * job: read the 207 verified post photographs over public HTTPS and report
 * width, height, MIME, size and SHA-256, so the Phase 2 migration manifest is
 * measured rather than guessed. It was approved on the explicit condition that
 * it can never write, never accept a URL, and never become a permanent media
 * API.
 *
 * Those conditions are only worth anything if something checks them. This
 * reads the shipped source and fails the suite the moment one is broken —
 * including by a future edit that looks harmless.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FN = resolve(__dirname, "../../supabase/functions/measure-post-media/index.ts");
const src = existsSync(FN) ? readFileSync(FN, "utf8") : "";

/** Comments explain why it must not write; code is what actually could. */
function codeOnly(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^[ \t]*\/\/.*$/gm, "");   // line comments
}

describe("measure-post-media stays a measurement, not a capability", () => {
  it("the function still exists where the deployment says it does", () => {
    expect(existsSync(FN), `${FN} is missing`).toBe(true);
    expect(src.length).toBeGreaterThan(1000);
  });

  it("CANNOT WRITE — no insert, update, upsert, delete or rpc anywhere in the code", () => {
    const code = codeOnly(src);
    for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(code, `forbidden write call ${forbidden} appeared`).not.toContain(forbidden);
    }
  });

  it("HOLDS NO STORAGE CREDENTIALS — never touches the S3 helper or its settings", () => {
    const code = codeOnly(src);
    for (const forbidden of ["_shared/s3.ts", "getS3Settings", "readS3Object", "s3SignedFetch", "s3_storage_settings"]) {
      expect(code, `${forbidden} would give it private-bucket reach`).not.toContain(forbidden);
    }
  });

  it("ACCEPTS NO URL FROM THE CALLER — the body is read for two integers only", () => {
    const code = codeOnly(src);
    // Every property read off the parsed body, in order.
    const bodyReads = [...code.matchAll(/body\??\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(new Set(bodyReads)).toEqual(new Set(["offset", "limit"]));
    for (const forbidden of ["body.url", "body.key", "body.path", "body.bucket", "body.host"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("FETCHES ONE HOST ONLY — pinned constant, and the host is re-checked after parsing", () => {
    const code = codeOnly(src);
    expect(code).toContain('const CDN_HOST = "cdn.50mmretina.com"');
    expect(code).toContain("host !== CDN_HOST");
    // A redirect is a target the function did not choose.
    expect(code).toContain('redirect: "error"');
    // The only fetch of an object is the candidate URL the database supplied.
    const fetches = [...code.matchAll(/\bfetch\(([^,)]+)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["c.url"]);
  });

  it("DERIVES the population with the exact pattern the Cycle 3 SQL proof used", () => {
    expect(src).toContain(
      "/^https:\\/\\/cdn\\.50mmretina\\.com\\/post-images\\/[0-9a-f-]{36}\\/posts\\/[^/?]+$/",
    );
    // Public posts only — it must not read bytes a logged-out visitor cannot.
    expect(codeOnly(src)).toContain('row.privacy !== "public"');
  });

  it("IS ADMIN-ONLY — authenticates, then checks the admin role, and returns 403 otherwise", () => {
    const code = codeOnly(src);
    expect(code).toContain("auth.getUser()");
    expect(code).toContain('.eq("role", "admin")');
    expect(code).toContain('json({ error: "Admin access required" }, 403)');
    expect(code).toContain('json({ error: "Unauthorized" }, 401)');
  });

  it("EXPIRES — an unattended deployment goes inert instead of lingering", () => {
    const code = codeOnly(src);
    expect(code).toContain('const EXPIRES_AT = Date.parse("2026-09-01T00:00:00Z")');
    expect(code).toContain("Date.now() > EXPIRES_AT");
    expect(code).toContain("410");
  });

  it("IS BOUNDED — hard per-call cap, hard population cap, hard time budget", () => {
    const code = codeOnly(src);
    expect(code).toContain("const HARD_LIMIT = 25");
    expect(code).toContain("Math.min(body.limit, HARD_LIMIT)");
    expect(code).toContain("HARD_MAX_CANDIDATES");
    expect(code).toContain("TIME_BUDGET_MS");
  });

  it("RETURNS NO IMAGE BYTES — a digest and numbers, never the body", () => {
    const code = codeOnly(src);
    for (const forbidden of ["base64", "btoa(", "arrayBuffer()));", "body: buf", "new Response(buf"]) {
      expect(code, `${forbidden} would leak object bytes to the caller`).not.toContain(forbidden);
    }
    expect(code).toContain('crypto.subtle.digest("SHA-256", buf)');
  });

  it("NEVER treats an ETag or a filename as a hash", () => {
    const code = codeOnly(src);
    expect(code).not.toMatch(/sha256:\s*etag/i);
    expect(code).not.toMatch(/sha256:\s*[^,\n]*(?:url|name|etag)/i);
    expect(code).toContain("sha256: toHex(digest)");
  });
});
