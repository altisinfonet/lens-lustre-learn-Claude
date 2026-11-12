/**
 * Every mail link on the www host (Owner 2026-11-12: a mail link opens the
 * installed app — Android only does that for the verified www host; the apex
 * 301s). Covers links built by the edge templates (siteUrl) AND links built by
 * database triggers (template data), at both mail render points.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mailDataOnCanonical, siteUrl } from "../../supabase/functions/_shared/laneConfig";

const g = globalThis as { Deno?: unknown };
function lane(origin: string | undefined) {
  g.Deno = { env: { get: (k: string) => (k === "SITE_ORIGIN" ? origin : undefined) } };
}
afterEach(() => {
  delete g.Deno;
});

describe("mail links → www", () => {
  it("siteUrl names the www host on an apex lane, staging unchanged", () => {
    lane("https://50mmretina.com");
    expect(siteUrl("/feed")).toBe("https://www.50mmretina.com/feed");
    lane("https://staging.50mmretina.com");
    expect(siteUrl("/feed")).toBe("https://staging.50mmretina.com/feed");
  });

  it("database-built links in template data move from apex to www (nested too)", () => {
    lane("https://50mmretina.com");
    const out = mailDataOnCanonical({
      actionUrl: "https://50mmretina.com/feed",
      home: "https://50mmretina.com",
      q: "https://50mmretina.com?x=1",
      nested: { entryUrl: "https://50mmretina.com/competitions/abc" },
      list: ["https://50mmretina.com/profile/1"],
      already: "https://www.50mmretina.com/feed",
      other: "https://50mmretina.com.evil.example/feed",
      text: "Hello",
      n: 3,
    });
    expect(out).toEqual({
      actionUrl: "https://www.50mmretina.com/feed",
      home: "https://www.50mmretina.com",
      q: "https://www.50mmretina.com?x=1",
      nested: { entryUrl: "https://www.50mmretina.com/competitions/abc" },
      list: ["https://www.50mmretina.com/profile/1"],
      already: "https://www.50mmretina.com/feed",
      other: "https://50mmretina.com.evil.example/feed",
      text: "Hello",
      n: 3,
    });
  });

  it("never loses a mail: unset lane or a non-apex lane returns the data unchanged", () => {
    const data = { actionUrl: "https://50mmretina.com/feed" };
    lane(undefined);
    expect(mailDataOnCanonical(data)).toEqual(data);
    lane("https://staging.50mmretina.com");
    expect(mailDataOnCanonical(data)).toEqual(data);
  });

  it("both mail render points pass template data through the rule", () => {
    for (const f of ["send-transactional-email", "process-email-queue"]) {
      const src = readFileSync(join(__dirname, "../../supabase/functions", f, "index.ts"), "utf8");
      expect(src, f).toMatch(/mailDataOnCanonical\(/);
    }
  });
});
