/**
 * EVERY LINK THAT LEAVES THE APP USES THE CANONICAL ORIGIN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — owner report, 2026-08-04
 *
 * "Referral link on App is showing localhost type … any share link all over
 *  the app is not working in the App."
 *
 * Inside the installed app window.location.origin is `https://localhost` (the
 * WebView serves the bundled dist), so 19 call sites were handing members
 * localhost URLs: the referral link, copy-post-link, profile share, entry and
 * competition-photo shares, certificate links, journal/featured-artist shares,
 * and the password-reset emails sent from inside the app. Web looked fine
 * because there the origin IS the site — which is exactly how it shipped.
 *
 * The fix is src/lib/publicUrl.ts (hard-coded canonical origin — the same
 * decision as PostMedia's transform base) plus shareLink(), which uses the
 * native share sheet in the app (the WebView has NO navigator.share, so the
 * old code silently fell back to copying the broken URL).
 *
 * The census test at the bottom is the regression stopper: it scans src/ and
 * fails if ANY file outside the documented allowlist builds a URL from
 * window.location.origin again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SITE_ORIGIN, publicUrl, shareLink } from "../publicUrl";
import { stripComments } from "@/test-utils/sourceText";

describe("publicUrl", () => {
  it("is the canonical production origin, hard-coded", () => {
    expect(SITE_ORIGIN).toBe("https://50mmretina.com");
  });

  it("joins paths with and without a leading slash", () => {
    expect(publicUrl("/post/abc")).toBe("https://50mmretina.com/post/abc");
    expect(publicUrl("signup?ref=XYZ")).toBe("https://50mmretina.com/signup?ref=XYZ");
  });

  it("never produces a localhost URL, whatever jsdom's origin is", () => {
    // jsdom's origin IS http://localhost — the exact value the bug shipped.
    expect(window.location.origin).toContain("localhost");
    expect(publicUrl("/anything")).not.toContain("localhost");
  });
});

describe("shareLink", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.splice(0).forEach((f) => f()); });

  const stubClipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    cleanup.push(() => { delete (navigator as any).clipboard; });
    return writeText;
  };

  it("uses the native share sheet inside the installed app", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    (window as any).Capacitor = { isNativePlatform: () => true, Plugins: { Share: { share } } };
    cleanup.push(() => { delete (window as any).Capacitor; });
    const result = await shareLink({ title: "T", url: "https://50mmretina.com/x" });
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://50mmretina.com/x" }));
  });

  it("falls back to the clipboard when neither native nor Web Share exists", async () => {
    // jsdom: no window.Capacitor, no navigator.share — the desktop-browser path.
    const writeText = stubClipboard();
    const result = await shareLink({ url: "https://50mmretina.com/y" });
    expect(result).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://50mmretina.com/y");
  });

  it("uses navigator.share on the web when available", async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: navShare, configurable: true });
    cleanup.push(() => { delete (navigator as any).share; });
    const writeText = stubClipboard();
    const result = await shareLink({ url: "https://50mmretina.com/z" });
    expect(result).toBe("shared");
    expect(navShare).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("census: no outgoing URL is built from window.location.origin", () => {
  /**
   * Files that may still read window.location.origin, each for a reason that
   * is NOT an outgoing link:
   *  - publicUrl.ts            documents the rule (comments only)
   *  - oauthHelper.ts          web OAuth must return to the origin you are on
   *                            (native has its own deep-link redirect)
   *  - OptimizedImage.tsx      relative-URL parsing base, never leaves the app
   *  - pdfLogo.ts              fetches a bundled ASSET; in the app
   *                            https://localhost/... serves it locally
   *  - generateCertificatePdf.ts  same asset fetch for the watermark/logo
   *                            (its VERIFY url uses SITE_ORIGIN)
   */
  const ALLOWED = new Set([
    "lib/publicUrl.ts",
    "lib/oauthHelper.ts",
    "components/OptimizedImage.tsx",
    "lib/pdfLogo.ts",
    "lib/generateCertificatePdf.ts",
  ]);

  const srcRoot = join(process.cwd(), "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const rel = p.slice(srcRoot.length + 1).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      const body = stripComments(readFileSync(p, "utf8"));
      if (body.includes("window.location.origin")) offenders.push(rel);
    }
  };
  walk(srcRoot);

  it("no file outside the allowlist touches window.location.origin", () => {
    expect(offenders, "Use publicUrl()/SITE_ORIGIN from @/lib/publicUrl for anything that leaves the app").toEqual([]);
  });
});
