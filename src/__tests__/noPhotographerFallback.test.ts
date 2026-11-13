/**
 * Owner 13 Nov 2026: "always name will show, not Photographer anymore, like
 * META … I need strong plan not a weak plan". A made-up word in a member's
 * name place is gone from every surface (src/lib/displayName.ts explains the
 * layers). This test keeps it gone: no file in src may fall back to the word
 * "Photographer" (or the home.photographer string) for a missing name, and
 * the shared name pieces must keep their no-made-up-name rule.
 *
 * Labels that really mean the role ("Photographer" as a column header, a role
 * name, the onboarding choice) are not fallbacks and are not matched.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { displayName, avatarInitial } from "@/lib/displayName";
import { resolveName } from "@/lib/adminBrand";

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

// `x || "Photographer"`, `x ?? 'Photographer'`, `|| t("home.photographer", …)`, `let name = "Photographer";`
const FALLBACK = /(\|\||\?\?)\s*(["']Photographer["']|t\(\s*["']home\.photographer["'])|(let|const|var)\s+\w+\s*=\s*["']Photographer["']\s*;/;

describe("no made-up name: the word Photographer is never a name fallback", () => {
  it("no file in src falls back to it", () => {
    const hits = files(SRC).flatMap((f) =>
      readFileSync(f, "utf8").split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line) && FALLBACK.test(line))
        .map(({ line, i }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`));
    expect(hits).toEqual([]);
  });

  it("the shared pieces give a blank, never a word", () => {
    expect(displayName(null)).toBe("");
    expect(displayName("  ")).toBe("");
    expect(displayName(" Neil Basu ")).toBe("Neil Basu");
    expect(avatarInitial(undefined)).toBe("");
    expect(resolveName("u1", null, new Set())).toBe("");
    expect(resolveName("u1", null, new Set(["u1"]))).toBe("50mm Retina World");
  });

  it("the name component asks for a missing name and shows a bar meanwhile", () => {
    const block = readFileSync(join(SRC, "components", "UserIdentityBlock.tsx"), "utf8");
    expect(block).toMatch(/useMemberName\(userId, name\)/);
    expect(block).toMatch(/data-testid="name-pending"/);
  });
});
