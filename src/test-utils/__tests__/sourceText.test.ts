/**
 * THE COMMENT STRIPPER MUST NOT EAT CODE.
 *
 * Two source-pin tests went red on 2026-08-15 with assertions that named code
 * plainly present in the file. The cause was their own comment stripper:
 * `WallPosts.tsx` contains `accept="image/*"`, the naive
 * `/\/\*[\s\S]*?\*\//g` treated that as the start of a block comment, and
 * everything up to the next `*​/` — around four hundred lines, including the
 * gate both tests assert on — was deleted before the assertion ran.
 *
 * The frightening part is not the red. It is that they had been GREEN, and went
 * red only because an unrelated comment was added elsewhere in the file and
 * changed which `*​/` closed the fake comment. For weeks they had been passing
 * for a reason unconnected to what they claimed to check.
 */

import { describe, it, expect } from "vitest";
import { stripComments } from "@/test-utils/sourceText";

describe("stripComments removes comments", () => {
  it("removes a block comment", () => {
    expect(stripComments("const a = 1;\n/* gone */\nconst b = 2;")).not.toMatch(/gone/);
  });

  it("removes a JSX comment", () => {
    expect(stripComments('<div>\n  {/* gone */}\n  <p>kept</p>\n</div>')).not.toMatch(/gone/);
  });

  it("removes a whole-line // comment", () => {
    expect(stripComments("const a = 1;\n  // gone\nconst b = 2;")).not.toMatch(/gone/);
  });

  it("keeps the code around them", () => {
    const out = stripComments("const a = 1;\n/* x */\nconst b = 2;");
    expect(out).toMatch(/const a = 1;/);
    expect(out).toMatch(/const b = 2;/);
  });
});

describe("stripComments does NOT eat code — the trap that cost an afternoon", () => {
  const REAL_SHAPE = [
    '<input accept="image/*" />',
    "const KEEP_ME = 2200;",
    "/* an ordinary comment, four hundred lines later */",
    "const ALSO_KEEP = true;",
  ].join("\n");

  it("survives accept=\"image/*\" — the exact string in WallPosts.tsx", () => {
    const out = stripComments(REAL_SHAPE);
    expect(out).toMatch(/KEEP_ME = 2200/);
    expect(out).toMatch(/ALSO_KEEP = true/);
    expect(out).not.toMatch(/an ordinary comment/);
  });

  it("PROVES the naive version fails on the same input", () => {
    // Not decoration: without this, nothing distinguishes the fixed helper from
    // the broken one, and a future "simplification" back to one regex would
    // look harmless.
    const naive = REAL_SHAPE.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(naive).not.toMatch(/KEEP_ME = 2200/);
  });

  it("leaves a url in a string alone", () => {
    expect(stripComments('const u = "https://example.com/a";\nconst v = 1;')).toMatch(/v = 1/);
  });
});
