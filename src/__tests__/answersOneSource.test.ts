/**
 * AEO answer pages (Owner order 2026-11-10): ONE answer list, two runtimes.
 * The app's copy (src/lib/answers/answers.ts) and the Deno copy
 * (supabase/functions/_shared/answers.ts, used by seo-route-metadata and the
 * sitemap) must be the same file, so robots and people read the same answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWERS, faqJsonLd } from "@/lib/answers/answers";
import { ANSWERS as DENO_ANSWERS } from "../../supabase/functions/_shared/answers";
import { answersBody } from "../../supabase/functions/seo-route-metadata/readable";

const ROOT = join(__dirname, "../..");
const norm = (s: string) => s.replace(/\r\n/g, "\n");

describe("answers — one source", () => {
  it("the Deno copy is byte-for-byte the app copy", () => {
    expect(norm(readFileSync(join(ROOT, "supabase/functions/_shared/answers.ts"), "utf8")))
      .toBe(norm(readFileSync(join(ROOT, "src/lib/answers/answers.ts"), "utf8")));
    expect(DENO_ANSWERS).toEqual(ANSWERS);
  });

  it("slugs are unique, address-safe, and every link is a site path", () => {
    const slugs = ANSWERS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of ANSWERS) {
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.answer.length).toBeGreaterThan(0);
      for (const [, to] of a.links) expect(to).toMatch(/^\/[a-z-]*$/);
    }
  });

  it("never states what the Owner ruled out (judges' names, money per vote, AI training)", () => {
    const all = ANSWERS.flatMap((a) => [a.question, ...a.answer]).join(" ");
    expect(all).toMatch(/does not disclose the identities of its judges/);
    expect(all).toMatch(/never used to train AI/);
    expect(all).not.toMatch(/[₹$€£]\s?\d|\d+\s?(rupees|dollars|INR|USD)/i);
  });

  it("FAQ markup and the robots' page carry every question", () => {
    const ld = faqJsonLd(ANSWERS, "https://www.50mmretina.com") as { mainEntity: Array<{ name: string; url: string }> };
    expect(ld.mainEntity.map((q) => q.name)).toEqual(ANSWERS.map((a) => a.question));
    expect(ld.mainEntity[0].url).toBe(`https://www.50mmretina.com/help/${ANSWERS[0].slug}`);
    const html = answersBody("Questions & answers", "intro", ANSWERS, [], "https://www.50mmretina.com");
    expect(html.startsWith('<main data-seo-readable="answers">')).toBe(true);
    expect(html).not.toMatch(/<\s*script|\son[a-z]+\s*=/i);
    for (const a of ANSWERS) expect(html).toContain(`/help/${a.slug}`);
  });

  it("/help is a reserved first segment, so no member handle can shadow it", () => {
    const seed = readFileSync(join(ROOT, "supabase/migrations/20260910_0006_f93_reserved_custom_urls.sql"), "utf8");
    expect(seed).toMatch(/\('help',/);
  });
});
