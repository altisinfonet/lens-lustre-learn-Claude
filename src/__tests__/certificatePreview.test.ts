import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 *
 * Members pressing "View" on their own certificate saw:
 *
 *     This content is blocked. Contact the site owner to fix the issue.
 *
 * The modal rendered `<iframe src={URL.createObjectURL(pdfBlob)}>`. Measured in
 * Chromium against the site's own CSP header on 2026-08-25, the browser said:
 *
 *     Refused to frame 'blob:…' because it violates the following
 *     Content Security Policy directive
 *
 * `frame-src` lists `'self'` and four third parties and has never carried
 * `blob:`. The frame still fires `onload` — on the interstitial — which is why
 * nothing in the app ever reported an error.
 *
 * ⚠ THE FIX IS NOT "ADD blob: TO frame-src".
 * An iframe renders a PDF only where the browser HAS a PDF viewer. An Android
 * WebView has none. Widening the policy would have fixed the desktop symptom
 * and left the app broken, so the preview is now an <img> drawn by the SAME
 * routine that draws the PDF. Verified in Chromium under the unchanged policy:
 * data: images load, blob: frames do not.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MODAL = read("src/components/CertificatePreviewModal.tsx");
const RENDERER = read("src/lib/generateCertificatePdf.ts");
const CANVAS = read("src/lib/certificateCanvas.ts");
const HEADERS = read("public/_headers");

/** Executable source only — every one of these names also appears in the
 *  comments that explain why it must not be used. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "")
   .split("\n")
   .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
   .join("\n");

const MODAL_CODE = strip(MODAL);
const CANVAS_CODE = strip(CANVAS);

describe("the certificate preview does not use a frame", () => {
  it("renders an image, never an iframe", () => {
    expect(MODAL_CODE).not.toMatch(/<iframe/);
    expect(MODAL_CODE).toMatch(/<img/);
  });

  it("never points a frame at a blob or a PDF", () => {
    expect(MODAL_CODE).not.toMatch(/URL\.createObjectURL/);
  });

  it("gets its picture from the shared renderer", () => {
    expect(MODAL_CODE).toMatch(/renderCertificateToPng/);
  });
});

describe("one layout, two outputs", () => {
  it("both entry points call the same drawCertificate", () => {
    // If these ever diverge, the preview can show something the PDF does not —
    // which is how a form offering types the database refused went unnoticed.
    const calls = RENDERER.match(/await drawCertificate\(/g) || [];
    expect(calls.length).toBe(2);
    expect(RENDERER).toMatch(/export interface CertificateSurface/);
    expect(RENDERER).toMatch(/export const renderCertificateToPng/);
    expect(RENDERER).toMatch(/export const generateCertificatePdf/);
  });

  it("keeps the page geometry in one place", () => {
    expect(RENDERER).toMatch(/export const CERT_PAGE_W = 297;/);
    expect(RENDERER).toMatch(/export const CERT_PAGE_H = 210;/);
  });
});

describe("the canvas surface", () => {
  it("replays recorded operations so the watermark stays behind the text", () => {
    // Drawing an image is async and every other call is not. Deferring images
    // to the end would paint the watermark OVER the text it sits behind.
    expect(CANVAS_CODE).toMatch(/const ops: Op\[\] = \[\]/);
    expect(CANVAS_CODE).toMatch(/for \(const op of ops\)/);
  });

  it("treats y as a baseline, the way jsPDF does", () => {
    expect(CANVAS_CODE).toMatch(/textBaseline = "alphabetic"/);
  });

  it("converts points to millimetres rather than assuming pixels", () => {
    expect(CANVAS_CODE).toMatch(/const PT_TO_MM = 25\.4 \/ 72;/);
  });

  it("defaults an omitted shape style to stroke, as jsPDF does", () => {
    // `doc.rect(margin, …)` with no style draws the gold border. Defaulting to
    // fill would paint a solid block over the whole certificate.
    expect(CANVAS_CODE).toMatch(/const s = \(style \|\| "S"\)\.toUpperCase\(\)/);
  });
});

describe("the download still works where an <a download> does not", () => {
  it("saves through saveBlob, not a synthetic anchor click", () => {
    expect(MODAL_CODE).toMatch(/saveBlob\(/);
    expect(MODAL_CODE).not.toMatch(/\.download\s*=/);
    expect(MODAL_CODE).not.toMatch(/a\.click\(\)/);
  });

  it("downloads a real PDF, not the preview image", () => {
    expect(MODAL_CODE).toMatch(/generateCertificatePdf\(/);
    expect(MODAL_CODE).toMatch(/doc\.output\("blob"\)/);
  });
});

describe("the security policy was not widened to make this work", () => {
  const csp = HEADERS.split("\n").find((l) => l.includes("Content-Security-Policy:")) || "";
  const directive = (name: string) =>
    (csp.split(";").find((d) => d.trim().startsWith(name + " ")) || "").trim();

  it("frame-src still carries no blob:", () => {
    // The point of drawing to a canvas was to avoid needing this. If a future
    // change adds it, the reason should be a new one, not this feature.
    expect(directive("frame-src")).not.toMatch(/blob:/);
    expect(directive("frame-src")).toMatch(/^frame-src /);
  });

  it("img-src already permitted what the fix relies on", () => {
    expect(directive("img-src")).toMatch(/\bblob:/);
    expect(directive("img-src")).toMatch(/\bdata:/);
  });

  it("object-src stays 'none' — <object>/<embed> are not an escape hatch", () => {
    expect(csp).toMatch(/object-src 'none'/);
  });
});
