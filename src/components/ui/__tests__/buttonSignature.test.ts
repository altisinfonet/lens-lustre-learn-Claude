import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cn } from "@/lib/utils";

/**
 * THE SHARED BUTTON'S GATE SIGNATURE MUST NOT MOVE.
 *
 * tools/uishot/capture.mjs builds a control's identity as tag + id + THE FIRST
 * TWO CLASS NAMES. Putting `tap-44` at the FRONT of the cva base string renamed
 * every shared Button in the application and produced 340 lines of
 * `"button.inline-flex.items-center" is gone (was present in the baseline)`
 * across every scene at every width. Nothing had been removed — a real removal
 * cannot hit every scene at every width identically, and that uniformity is
 * what proved it a rename.
 *
 * Moving it to position THREE fixed the common case and not the measured one:
 * when a caller passes "inline-flex items-center", twMerge drops the base
 * copies and the following names become the signature — `tap-44.justify-center`
 * at position three, which is still not the baseline. LAST is the only position
 * that cannot reach the first two slots however much twMerge removes.
 *
 * This test exists because the fix is one class's POSITION in a long string,
 * which is exactly what a later edit reorders without noticing. It reads the
 * real base string out of button.tsx rather than restating it, so it cannot
 * drift into agreeing with a copy of itself.
 */

const SRC = readFileSync(join(process.cwd(), "src/components/ui/button.tsx"), "utf8");

/** The cva base string, taken from the file rather than retyped. */
function baseString(): string {
  const m = SRC.match(/cva\(\s*(?:\/\*[\s\S]*?\*\/\s*)?"([^"]+)"/);
  if (!m) throw new Error("could not find the cva base string in button.tsx");
  return m[1];
}

/** What capture.mjs would call this control: tag + first two class names. */
function signature(className: string): string {
  return "button." + className.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
}

describe("the shared Button's gate signature", () => {
  it("is button.inline-flex.items-center with no caller override", () => {
    expect(signature(cn(baseString()))).toBe("button.inline-flex.items-center");
  });

  it("still carries tap-44 — the hit region is not lost to twMerge", () => {
    expect(cn(baseString()).split(/\s+/)).toContain("tap-44");
  });

  /*
   * The five caller shapes the Auditor measured with cn(). The signature is
   * allowed to change when a caller genuinely overrides layout classes — that
   * is the separate, larger finding that path() is an unstable key. What must
   * NEVER happen is tap-44 itself entering the first two slots, because that
   * renames a control for a reason having nothing to do with the caller.
   */
  it.each([
    ["empty", ""],
    ["icon-sized", "h-8 w-8 p-0"],
    ["repeats the base layout", "inline-flex items-center"],
    ["overrides the layout", "flex flex-col"],
    ["repeats tap-44", "tap-44"],
  ])("tap-44 never becomes part of the signature: %s", (_label, caller) => {
    const merged = cn(baseString(), caller);
    expect(merged.split(/\s+/)).toContain("tap-44");
    expect(signature(merged)).not.toContain("tap-44");
  });

  it("tap-44 is the LAST class in the base string, not merely late", () => {
    const parts = baseString().split(/\s+/).filter(Boolean);
    expect(parts[parts.length - 1]).toBe("tap-44");
  });
});
