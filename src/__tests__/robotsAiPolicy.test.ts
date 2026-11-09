/**
 * Owner decision 2026-11-09: AI SEARCH / answer robots may read the site (they
 * link back); AI TRAINING robots may not copy anything. This reads the robots.txt
 * template the way a robot does (RFC 9309: a robot obeys the most specific group
 * naming it, else "*") and fails if either half of the decision is undone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const robots = readFileSync(join(__dirname, "../../public/robots.txt"), "utf8");

/** user-agent (lower case) → its group's rules, as "allow /x" / "disallow /x". */
function groups(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let agents: string[] = [];
  let rules: string[] = [];
  let inRules = false;
  const flush = () => { for (const a of agents) out.set(a, rules); };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (inRules) { flush(); agents = []; rules = []; inRules = false; }
      agents.push(val.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      inRules = true;
      rules.push(`${key} ${val}`);
    }
  }
  flush();
  return out;
}

const g = groups(robots);
const rulesFor = (agent: string) => g.get(agent.toLowerCase()) ?? g.get("*") ?? [];
const blocksAll = (agent: string) => rulesFor(agent).includes("disallow /");

const SEARCH = ["Googlebot", "Googlebot-Image", "Bingbot", "Applebot", "OAI-SearchBot", "ChatGPT-User",
  "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "facebookexternalhit"];
const TRAINING = ["GPTBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended", "CCBot",
  "Meta-ExternalAgent", "Bytespider", "img2dataset", "ImagesiftBot"];

describe("robots.txt — AI search yes, AI training no (Owner 2026-11-09)", () => {
  it.each(SEARCH)("%s may read public pages", (a) => {
    expect(blocksAll(a)).toBe(false);
  });
  it.each(TRAINING)("%s is blocked everywhere", (a) => {
    expect(g.has(a.toLowerCase())).toBe(true);
    expect(blocksAll(a)).toBe(true);
  });
  it("search robots still stay out of private areas", () => {
    for (const a of ["Googlebot", "OAI-SearchBot", "PerplexityBot", "SomeNewBot"]) {
      expect(rulesFor(a)).toEqual(expect.arrayContaining(["disallow /admin", "disallow /wallet", "disallow /settings/"]));
    }
  });
  it("the catch-all group is not a blanket block", () => {
    expect(g.get("*")).toBeDefined();
    expect(g.get("*")).not.toContain("disallow /");
  });
});
