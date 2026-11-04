/**
 * ONE TOKENS FILE (central-control plan T1). src/ui/tokens.ts is the only place
 * a shared size is written. tailwind.config.ts reads it directly, and the block
 * in src/index.css must equal what it generates, so the three cannot disagree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";
import { cn } from "@/lib/utils";
import { TOKENS, tailwindFontSize, tailwindSpacing, tokenCssDrift, tokensCssBlock } from "@/ui/tokens";

const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
const theme = resolveConfig(tailwindConfig).theme as unknown as Record<string, Record<string, string>>;

describe("tokens.ts is the one source", () => {
  it("index.css carries exactly the generated block", () => {
    expect(tokenCssDrift(css), `paste into src/index.css:\n${tokensCssBlock()}`).toEqual([]);
  });

  it("self-test: a hand-edited value in index.css is caught", () => {
    const bad = css.replace("--space-card-x: 0.75rem;", "--space-card-x: 0.8rem;");
    expect(bad).not.toBe(css);
    expect(tokenCssDrift(bad)).toContain("--space-card-x: index.css has 0.8rem, tokens.ts has 0.75rem");
  });

  it("self-test: a variable added by hand to the block is caught", () => {
    const bad = css.replace("--comment-indent:", "--comment-extra: 1px;\n    --comment-indent:");
    expect(tokenCssDrift(bad)).toContain("--comment-extra: in index.css, not in tokens.ts");
  });

  it("self-test: a variable removed from the block is caught", () => {
    const bad = css.replace(/\s*--avatar-xl: [^;]+;/, "");
    expect(tokenCssDrift(bad)).toContain("--avatar-xl: in tokens.ts, not in index.css");
  });

  it("self-test: a missing block is caught", () => {
    expect(tokenCssDrift("body {}")).toEqual(["index.css has no TOKENS block"]);
  });

  it("every Tailwind value is a variable of the block, so tailwind holds no number of its own", () => {
    const block = tokensCssBlock();
    for (const value of [...Object.values(tailwindSpacing), ...Object.values(tailwindFontSize)]) {
      expect(value).toMatch(/^var\(--[a-z-]+\)$/);
      expect(block).toContain(`${value.slice(4, -1)}:`);
    }
  });

  it("tailwind's resolved theme reaches spacing, width, height, size and min-height", () => {
    for (const [key, value] of Object.entries(tailwindSpacing)) {
      for (const scale of ["spacing", "width", "height", "size", "minHeight", "minWidth", "gap", "padding", "margin"]) {
        expect(theme[scale][key], `${scale}.${key}`).toBe(value);
      }
    }
    for (const [key, value] of Object.entries(tailwindFontSize)) expect(theme.fontSize[key]).toBe(value);
  });

  it("holds the plan's tap, avatar and indent values", () => {
    expect(TOKENS.tap).toEqual({ min: 44, short: 32 });
    expect(TOKENS.avatar).toEqual({ xs: 24, sm: 32, md: 40, lg: 48, xl: 80 });
    expect(TOKENS.comment.indent).toBe(44);
  });
});

describe("cn() knows the tokens", () => {
  it("a type token and a colour do not cancel each other", () => {
    expect(cn("text-caption", "text-foreground")).toBe("text-caption text-foreground");
  });

  it("a later value of the same kind wins, as for any other class", () => {
    expect(cn("text-sm", "text-caption")).toBe("text-caption");
    expect(cn("px-3", "px-card-x")).toBe("px-card-x");
    expect(cn("px-card-x", "px-3")).toBe("px-3");
    expect(cn("w-8", "w-avatar-md")).toBe("w-avatar-md");
    expect(cn("gap-2", "gap-row-gap")).toBe("gap-row-gap");
  });
});
