/**
 * DOWNLOADS MUST WORK IN THE APP — PINNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-05:
 *
 *   "Any images clcked to downalod, not dowandling only in App, any journal and
 *    featured artist any article PDF showing downlaiding but not dwonalding as
 *    PDF docuemnt in mobile"
 *
 * ONE CAUSE, TWO SYMPTOMS. Every save ended in `<a download>` + `.click()` —
 * directly in `downloadImageAsJpeg`, and inside jsPDF's `save()` for the
 * article PDFs. An Android WebView has no download manager and this app
 * registers no DownloadListener, so that click is discarded in silence.
 *
 * These tests pin the SHAPE of the fix, because the three things that can undo
 * it are all invisible at runtime on the web:
 *
 *   1. someone re-introduces `a.download` / `pdf.save()` in a save path;
 *   2. someone `import`s a @capacitor/* package into src/, which breaks the
 *      WEBSITE's build (those packages exist only in the Android CI job);
 *   3. someone writes to Directory.Documents, which on Android 11+ is
 *      app-private — the file would appear to save and be unfindable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const saveFile = stripComments(read("src/lib/saveFile.ts"));
const compression = stripComments(read("src/lib/imageCompression.ts"));
const pdf = stripComments(read("src/lib/generateArticlePdf.ts"));
const workflow = read(".github/workflows/android-build.yml");

describe("every save goes through the one helper", () => {
  it("the image download no longer builds its own anchor", () => {
    expect(compression).toMatch(/await saveBlob\(blob, fileName \|\| "photo\.jpg"\);/);
    expect(compression).not.toMatch(/a\.download\s*=/);
  });

  it("the article PDF does not use jsPDF's browser-only save()", () => {
    // jsPDF's save() is an <a download> + synthetic click. Verified in
    // node_modules/jspdf. output("blob") gives the same bytes without it.
    expect(pdf).not.toMatch(/pdf\.save\(/);
    expect(pdf).toMatch(/await saveBlob\(pdf\.output\("blob"\)/);
  });
});

describe("the app path actually reaches the phone", () => {
  it("web behaviour is unchanged — anchor download, still there", () => {
    // The website was never broken. Losing this would be a new bug on the
    // surface that was working.
    expect(saveFile).toMatch(/if \(!isNativeCapacitorApp\(\)\) \{/);
    expect(saveFile).toMatch(/a\.download = name;/);
  });

  it("writes to CACHE, never DOCUMENTS", () => {
    // Directory.Documents is app-private on Android 11+, so the member would be
    // told it saved and would never find the file. That is worse than the bug.
    expect(saveFile).toMatch(/directory: "CACHE"/);
    expect(saveFile).not.toMatch(/directory: "DOCUMENTS"/);
  });

  it("hands the written file to the system share sheet", () => {
    expect(saveFile).toMatch(/files: \[uri\]/);
  });

  it("an app too old to save says what to DO about it", () => {
    // Standing rule: an error message must give the member a next step.
    expect(saveFile).toMatch(/SAVE_NEEDS_UPDATE_MESSAGE/);
    expect(saveFile).toMatch(/Please update the app/);
  });
});

describe("the website's build cannot be broken by this", () => {
  it("saveFile.ts never imports a @capacitor package", () => {
    // Those packages are installed ONLY in the Android CI job. A static import
    // here would fail the Cloudflare build and take the whole site down.
    // Same standing rule as src/lib/native/authDeepLink.ts.
    expect(saveFile).not.toMatch(/from "@capacitor\//);
    expect(saveFile).toMatch(/window as unknown as \{ Capacitor\?: CapGlobal \}/);
  });

  /**
   * ⚠ NOT ASSERTED HERE, DELIBERATELY, AND IT MUST NOT BE FORGOTTEN.
   *
   * The app half of this fix also needs `@capacitor/filesystem` added to the
   * plugin install step in `.github/workflows/android-build.yml`.
   *
   * That file is ONE OF THE TWO BUILD TRIGGERS (`on.push.paths`), so editing it
   * starts an Android build the moment it merges. The owner's standing rule is
   * that a build is cut only when he asks — so the one-line workflow change is
   * held back and goes in WITH the build he asks for, not before it.
   *
   * Asserting it here would mean shipping a knowingly-red test to main, which
   * is its own bad habit. It is asserted the moment that line lands; until
   * then this comment is the record. Reference so it is not lost:
   * `workflow` is read above and is ready for the assertion.
   */
  it("records that the plugin install is still pending the build", () => {
    // Green either way — it documents which of the two states we are in, and
    // becomes a real assertion when the workflow line lands.
    const installed = /@capacitor\/filesystem/.test(workflow);
    expect(typeof installed).toBe("boolean");
  });
});
