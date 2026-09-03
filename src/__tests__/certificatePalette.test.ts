import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 *
 * The certificate's palette is six numeric triples and two hex strings spread
 * across ~700 lines of drawing code. Nothing tied a colour to the thing it
 * paints, so "make the name blue" was a hand-edit of one `setTextColor` among
 * fourteen, and getting the wrong one produced a certificate that still looked
 * plausible — a blue "AUTHORIZED SIGNATORY" label reads as a design choice,
 * not as a bug, and nobody would catch it in review.
 *
 * On 2026-08-25 the owner moved two tiers at once:
 *
 *     name / title / date .................. #282828  ->  #007BB1
 *     "This is to certify that" /
 *     "has successfully completed" ......... #645F58  ->  #282828
 *
 * Both directions matter. Asserting only that the name is blue would pass on a
 * build where the connector lines never left #645F58.
 *
 * A second pass the same day moved the closing / description line as well:
 *
 *     closing / description ................ #96918A  ->  #282828
 *
 * That one shares a colour with the genuine small print (DATE, AUTHORIZED
 * SIGNATURE, certificate id, verify URL, "Scan to verify"), so it is asserted
 * separately from them — otherwise a future sweep of "make TEXT_SUBTLE darker"
 * would darken the footer too and nothing here would notice.
 *
 * The QR block is checked too, for a different reason: it hardcodes its own
 * hex copies of GOLD and BG_COLOR instead of deriving them, so a future change
 * to GOLD alone would leave a QR code in the previous gold, clashing with the
 * border it sits next to.
 */

const ROOT = join(__dirname, "..", "..");
const RENDERER = readFileSync(join(ROOT, "src/lib/generateCertificatePdf.ts"), "utf8");

/**
 * ⚠ EXECUTABLE SOURCE ONLY — the same discipline as certificateTiers.test.ts.
 *
 * The comment above the palette records the OLD values verbatim (`[100, 95, 88]`,
 * `#645F58`, `#282828`) so the next reader knows what changed. A scan of the raw
 * file would therefore match its own gravestone and pass no matter what the code
 * does. Strip comments first, always.
 */
const CODE = RENDERER
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

/** `d.setTextColor(...X);` followed by `anchor` — proves WHICH element got X. */
const colourOf = (anchor: string): string | null => {
  const m = CODE.match(
    new RegExp(
      `setTextColor\\(\\.\\.\\.([A-Z_]+)\\);\\s*(?:const [^\\n]*\\n\\s*)*${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  return m ? m[1] : null;
};

describe("certificate palette — the constants themselves", () => {
  it("TEXT_ACCENT is the owner's #007BB1", () => {
    expect(CODE).toMatch(/const TEXT_ACCENT: \[number, number, number\] = \[0, 123, 177\];/);
  });

  it("TEXT_DARK is still #282828", () => {
    expect(CODE).toMatch(/const TEXT_DARK: \[number, number, number\] = \[40, 40, 40\];/);
  });

  it("TEXT_MUTED is gone from executable source, not merely unused", () => {
    expect(CODE).not.toContain("TEXT_MUTED");
  });

  it("the colours the owner did NOT ask to change are untouched", () => {
    expect(CODE).toMatch(/const GOLD: \[number, number, number\] = \[184, 150, 80\];/);
    expect(CODE).toMatch(/const GOLD_LIGHT: \[number, number, number\] = \[210, 185, 120\];/);
    expect(CODE).toMatch(/const TEXT_SUBTLE: \[number, number, number\] = \[150, 145, 138\];/);
    expect(CODE).toMatch(/const BG_COLOR: \[number, number, number\] = \[255, 253, 248\];/);
  });
});

describe("certificate palette — which element gets which colour", () => {
  it("the recipient's name is TEXT_ACCENT", () => {
    expect(colourOf("d.text(recipientName,")).toBe("TEXT_ACCENT");
  });

  it("the course/competition title is TEXT_ACCENT", () => {
    expect(colourOf("const maxTitleWidth")).toBe("TEXT_ACCENT");
  });

  it("the issue date is TEXT_ACCENT", () => {
    expect(colourOf("d.text(issueDate,")).toBe("TEXT_ACCENT");
  });

  it('"This is to certify that" is TEXT_DARK, not the retired muted grey', () => {
    expect(colourOf("const presentText")).toBe("TEXT_DARK");
  });

  it('"has successfully completed" is TEXT_DARK, not the retired muted grey', () => {
    expect(colourOf("const completionText")).toBe("TEXT_DARK");
  });

  it("the closing / description line is TEXT_DARK", () => {
    expect(colourOf("const closing =")).toBe("TEXT_DARK");
  });

  it("the small print stays TEXT_SUBTLE — the change did not bleed into it", () => {
    expect(colourOf('d.text("DATE"')).toBe("TEXT_SUBTLE");
    expect(colourOf('d.text("AUTHORIZED SIGNATORY"')).toBe("TEXT_SUBTLE");
    expect(colourOf("d.text(`Certificate ID:")).toBe("TEXT_SUBTLE");
    expect(colourOf("d.text(`Verify at:")).toBe("TEXT_SUBTLE");
  });

  it("CERTIFICATE and the heading line under it stay GOLD", () => {
    expect(colourOf('d.text("CERTIFICATE"')).toBe("GOLD");
    expect(colourOf("d.text(ofText,")).toBe("GOLD");
  });
});

describe("certificate palette — the QR code's duplicated hex", () => {
  /**
   * ⚠ These two hex strings are hand-written copies of GOLD and BG_COLOR.
   * If someone changes GOLD and not this, the QR silently keeps the old gold.
   */
  const hex = (rgb: RegExpMatchArray) =>
    "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");

  it("the QR's dark colour still equals GOLD", () => {
    const gold = CODE.match(/const GOLD: \[number, number, number\] = \[(\d+), (\d+), (\d+)\];/);
    expect(gold).not.toBeNull();
    expect(CODE).toContain(`dark: "${hex(gold!)}"`);
  });

  it("the QR's light colour still equals BG_COLOR", () => {
    const bg = CODE.match(/const BG_COLOR: \[number, number, number\] = \[(\d+), (\d+), (\d+)\];/);
    expect(bg).not.toBeNull();
    expect(CODE).toContain(`light: "${hex(bg!)}"`);
  });
});
