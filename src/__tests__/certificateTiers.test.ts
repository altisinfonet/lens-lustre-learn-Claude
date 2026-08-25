import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CERT_TYPES } from "@/components/admin/certificateTypes";

/**
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 *
 * `TIER_CONFIG` in generateCertificatePdf.ts drives every word on the printed
 * certificate: the "OF …" line, the line above the title and the line below
 * it. It held **8** entries while the CHECK constraint permitted **16**, and
 * `resolveTier` ended with `?? TIER_CONFIG.course_completion`.
 *
 * So `custom`, `achievement` and all six `competition_*` placements printed
 *
 *     OF COMPLETION
 *     for successfully completing the course
 *
 * on certificates that had nothing to do with a course. Reported by the owner
 * on 2026-08-25 the moment `custom` became issuable: a Custom certificate came
 * out reading Completion of Course.
 *
 * This is the same defect as a <select> falling back to its first <option> —
 * a default that quietly asserts something specific and wrong.
 */

const ROOT = join(__dirname, "..", "..");
const RENDERER = readFileSync(join(ROOT, "src/lib/generateCertificatePdf.ts"), "utf8");

/**
 * Executable source only. The old fallback is quoted verbatim in the comment
 * that explains why it was removed, so a scan of the whole file matches its
 * own gravestone and passes whatever the code does. Mutation M3 on the
 * certificate RPC test escaped exactly this way.
 */
const CODE = RENDERER
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

function constraintTypes(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  const f = readdirSync(dir).find((n) => n.includes("certificate_types_and_admin_search"));
  if (!f) throw new Error("the certificate_types_and_admin_search migration is missing");
  const sql = readFileSync(join(dir, f), "utf8");
  const start = sql.indexOf("add constraint certificates_type_check");
  const constraint = sql.slice(start, sql.indexOf(";", start));
  return [...constraint.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]).sort();
}

/** The keys of the TIER_CONFIG object literal, read from source. */
function tierKeys(): string[] {
  const start = RENDERER.indexOf("const TIER_CONFIG: Record<string, TierConfig> = {");
  expect(start, "TIER_CONFIG is not where this test expects it").toBeGreaterThan(-1);
  const body = RENDERER.slice(start, RENDERER.indexOf("\n};", start));
  return [...body.matchAll(/^ {2}([a-z0-9_]+): \{$/gm)].map((m) => m[1]).sort();
}

describe("every permitted certificate type has its own wording", () => {
  it("TIER_CONFIG covers exactly the types the constraint permits", () => {
    const inSql = constraintTypes();
    expect(inSql.length, "the constraint parse found nothing — this test is vacuous").toBe(16);
    expect(tierKeys()).toEqual(inSql);
  });

  it("agrees with the admin dropdown registry as well", () => {
    expect(tierKeys()).toEqual(CERT_TYPES.map((t) => t.value).sort());
  });

  it("no longer substitutes course wording for an unknown type", () => {
    // The old line was `return TIER_CONFIG[type] ?? TIER_CONFIG.course_completion;`
    expect(CODE).not.toMatch(/\?\?\s*TIER_CONFIG\.course_completion/);
    expect(CODE).toMatch(/\?\?\s*NEUTRAL_TIER/);
    expect(CODE).toMatch(/const NEUTRAL_TIER: TierConfig/);
  });

  it("keeps course wording only for the course type and its legacy alias", () => {
    const resolve = CODE.slice(CODE.indexOf("function resolveTier"));
    const head = resolve.slice(0, resolve.indexOf("\n}"));
    const courseRefs = (head.match(/TIER_CONFIG\.course_completion/g) || []).length;
    expect(courseRefs, "only the `course` alias may map to course wording").toBe(1);
    expect(head).toMatch(/if \(type === "course"\) return TIER_CONFIG\.course_completion;/);
  });

  it("gives the two hand-issued types wording that is not about a course", () => {
    const block = (k: string) => {
      const i = RENDERER.indexOf(`\n  ${k}: {`);
      return RENDERER.slice(i, RENDERER.indexOf("},", i));
    };
    for (const k of ["achievement", "custom"]) {
      expect(block(k), `${k} must not mention a course`).not.toMatch(/course/i);
      expect(block(k)).not.toMatch(/OF COMPLETION/);
    }
  });

  it("gives each competition placement its own line, not a shared one", () => {
    const placements = [
      "competition_runner_up_1", "competition_runner_up_2",
      "competition_honorary_mention", "competition_special_jury",
      "competition_top_50", "competition_top_100",
    ];
    const lines = placements.map((k) => {
      const i = RENDERER.indexOf(`\n  ${k}: {`);
      const block = RENDERER.slice(i, RENDERER.indexOf("},", i));
      return (block.match(/completionText: "([^"]+)"/) || [])[1];
    });
    for (const l of lines) expect(l, "a placement has no wording").toBeTruthy();
    expect(new Set(lines).size, "two placements share a line").toBe(placements.length);
    for (const l of lines) expect(l).not.toMatch(/completing the course/);
  });
});

describe("the admin's description reaches the certificate", () => {
  it("is accepted by the renderer", () => {
    expect(CODE).toMatch(/description\?: string \| null;/);
    expect(CODE).toMatch(/^  description,$/m);
  });

  it("is printed in the closing slot, wrapped, ahead of the canned line", () => {
    expect(CODE).toMatch(/const closing = \(description \|\| ""\)\.trim\(\) \|\| tier\.dedicationText;/);
    expect(CODE).toMatch(/splitTextToSize\(closing, 200\)/);
  });

  it("is passed by every caller that renders a stored certificate", () => {
    const admin = readFileSync(join(ROOT, "src/components/admin/AdminCertificates.tsx"), "utf8");
    const member = readFileSync(join(ROOT, "src/pages/Certificates.tsx"), "utf8");
    expect(admin, "admin download drops the description").toMatch(/description: c\.description/);
    expect(member, "member download drops the description").toMatch(/description: cert\.description/);
  });
});

describe("the admin can see what they are about to print", () => {
  const admin = readFileSync(join(ROOT, "src/components/admin/AdminCertificates.tsx"), "utf8");

  it("offers a spell-checked textarea, not a bare single-line input", () => {
    // A typo here is a typo on a certificate that cannot be edited once saved.
    expect(admin).toMatch(/<textarea[\s\S]{0,600}spellCheck/);
    expect(admin).not.toMatch(/<input value=\{form\.description\}/);
  });

  it("says what happens when it is left blank", () => {
    expect(admin).toMatch(/uses the standard wording for/);
  });
});

describe("the admin sees the certificate before issuing it", () => {
  const admin = readFileSync(join(ROOT, "src/components/admin/AdminCertificates.tsx"), "utf8");
  const adminCode = admin
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  /**
   * A certificate cannot be edited once the recipient has downloaded it, and
   * until 2026-08-25 the only way to see the wording was to issue one to a real
   * member and look. The admin was composing a document blind.
   */
  it("draws a live preview from the same renderer as the PDF", () => {
    expect(adminCode).toMatch(/renderCertificateToPng/);
    expect(adminCode).toMatch(/Live certificate preview/);
  });

  it("redraws on every field that changes the certificate", () => {
    const deps = adminCode.match(/\[showForm, form\.title, form\.description, form\.type, resolvedUserName, editingId\]/);
    expect(deps, "a field that changes the certificate is missing from the deps").toBeTruthy();
  });

  it("debounces instead of rendering per keystroke", () => {
    // A render is ~20ms warm and ~70ms cold; keying it to every character
    // queues renders faster than they finish and the picture trails the typing.
    expect(adminCode).toMatch(/const timer = setTimeout\(async \(\) => \{/);
    expect(adminCode, "the debounce interval changed").toMatch(/\n {4}\}, 180\);/);
    // Cleaned up on every dep change, or the timers stack up while typing.
    expect(adminCode).toMatch(/return \(\) => clearTimeout\(timer\);/);
  });

  it("discards a slow render whose input has already changed", () => {
    expect(adminCode).toMatch(/previewSeq/);
    expect(adminCode).toMatch(/if \(seq !== previewSeq\.current\) return;/);
  });

  it("previews an edited certificate with ITS date and id, not today's", () => {
    // Showing the admin something the member will never receive is the same
    // defect the member-facing view had.
    expect(adminCode).toMatch(/certs\.find\(\(c\) => c\.id === editingId\)/);
    expect(adminCode).toMatch(/existing\?\.issued_at/);
    expect(adminCode).toMatch(/existing\?\.certificate_id/);
  });
});

describe("rendering repeatedly does not hammer the network", () => {
  const code = RENDERER
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  const admin = readFileSync(join(ROOT, "src/components/admin/AdminCertificates.tsx"), "utf8");

  it("caches asset lookups, decoded images and conversions", () => {
    expect(code).toMatch(/const assetUrlCache = new Map/);
    expect(code).toMatch(/const imageCache = new Map/);
    expect(code).toMatch(/const assetPngCache = new Map/);
  });

  it("resolves the logo once per render, not once per place it is drawn", () => {
    // Watermark and footer both draw it. Two resolutions meant two calls to
    // getSiteLogoUrl(), which documents itself as deliberately uncached.
    expect(code).toMatch(/const logoUrlOnce = async/);
    expect((code.match(/await logoUrlOnce\(\)/g) || []).length).toBe(2);
    expect(code).not.toMatch(/if \(!wmLogoUrl\) wmLogoUrl = await getSiteLogoUrl\(\)/);
  });

  it("drops the cache when an asset is replaced, so the preview is never stale", () => {
    expect(code).toMatch(/export function clearCertificateAssetCache/);
    // Both the upload and the removal paths must invalidate.
    expect((admin.match(/clearCertificateAssetCache\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
