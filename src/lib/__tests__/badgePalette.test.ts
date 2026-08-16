/**
 * EVERY BADGE IS READABLE, IN BOTH MODES, WHATEVER THE DATABASE SAYS.
 *
 * Owner report with screenshots, 2026-08-04: "except blue badge no other badge
 * people won't read". Measured against the app's real card colours, all ten
 * colour presets failed the WCAG AA 4.5:1 minimum in dark mode and eight of ten
 * failed in light mode, at 7px.
 *
 * These tests do not match strings and call it proven — they RECOMPUTE the
 * contrast ratio from the palette's own hex values. Lighten any fill and the
 * arithmetic fails.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BADGE_FILL,
  BADGE_FILL_HEX,
  BADGE_PILL_BASE,
  BADGE_PILL_SIZE,
  BADGE_ROW_SHRINK,
  BADGE_ICON_SIZE,
  solidPillFill,
  solidPillClass,
} from "../badgePalette";
import { stripComments } from "@/test-utils/sourceText";

/* ── WCAG 2.1 relative luminance + contrast ratio ─────────────────────────── */
const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE = "#ffffff";
const AA_SMALL_TEXT = 4.5;

describe("the palette is readable by arithmetic, not by opinion", () => {
  it("white text on every fill clears WCAG AA (4.5:1)", () => {
    for (const [hue, hex] of Object.entries(BADGE_FILL_HEX)) {
      const ratio = contrast(WHITE, hex);
      expect(ratio, `${hue} (${hex}) is only ${ratio.toFixed(2)}:1 — too light for white text`)
        .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it("the sanity check works: a light fill would fail", () => {
    // If this ever passes, the maths above is broken and every test here is
    // worthless. amber-400 is the kind of value someone reaches for.
    expect(contrast(WHITE, "#fbbf24")).toBeLessThan(AA_SMALL_TEXT);
  });

  it("every fill has a matching hex, and vice versa", () => {
    // A fill without a hex would silently skip the contrast check above.
    expect(Object.keys(BADGE_FILL).sort()).toEqual(Object.keys(BADGE_FILL_HEX).sort());
  });

  it("each class string names the same shade as its hex", () => {
    // bg-violet-600 must not drift away from #7c3aed.
    const SHADE: Record<string, string> = {
      "#7c3aed": "violet-600", "#4f46e5": "indigo-600", "#047857": "emerald-700",
      "#0f766e": "teal-700", "#0369a1": "sky-700", "#2563eb": "blue-600",
      "#c2410c": "orange-700", "#b45309": "amber-700", "#e11d48": "rose-600",
      "#db2777": "pink-600", "#dc2626": "red-600",
    };
    for (const [hue, cls] of Object.entries(BADGE_FILL)) {
      expect(cls, `${hue} class/hex mismatch`).toBe(`bg-${SHADE[BADGE_FILL_HEX[hue]]}`);
    }
  });
});

describe("a bad value in the database still renders readably", () => {
  it("normalises a legacy 15%-tint string to the solid fill of the same hue", () => {
    // This is exactly what is stored in badge_definitions today.
    expect(solidPillFill("bg-amber-500/15 text-amber-600 border-amber-500/30")).toBe("bg-amber-700");
    expect(solidPillFill("bg-violet-500/15 text-violet-600 border-violet-500/30")).toBe("bg-violet-600");
  });

  it("accepts a bare hue and an already-correct value", () => {
    expect(solidPillFill("emerald")).toBe("bg-emerald-700");
    expect(solidPillFill("bg-emerald-700")).toBe("bg-emerald-700");
  });

  it("falls back to a readable fill rather than rendering junk", () => {
    for (const junk of ["", null, undefined, "text-white", "bg-[#ffff00]", "banana-500"]) {
      const fill = solidPillFill(junk as string);
      expect(fill).toBe("bg-slate-700");
    }
    // and the fallback itself must be readable
    expect(contrast(WHITE, "#334155")).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it("never returns a transparent fill — that was the original bug", () => {
    const inputs = ["bg-amber-500/15 text-amber-600", "sky", "", "nonsense", "bg-red-600"];
    for (const i of inputs) {
      expect(solidPillFill(i)).not.toMatch(/\//);
      expect(solidPillFill(i)).toMatch(/^bg-[a-z]+-\d00$/);
    }
  });
});

describe("the pill itself", () => {
  it("is white text on a solid fill, so the page behind it cannot matter", () => {
    expect(BADGE_PILL_BASE).toMatch(/text-white/);
    expect(BADGE_PILL_BASE).toMatch(/rounded-full/);
    expect(BADGE_PILL_BASE).toMatch(/font-bold/);
  });

  it("is 8.5px, not the old 7px", () => {
    // Owner set 10px, then revised to 9px, then to 8.5px (2026-08-04).
    for (const size of Object.values(BADGE_PILL_SIZE)) {
      expect(size).toMatch(/text-\[8\.5px\]/);
    }
    expect(JSON.stringify(BADGE_PILL_SIZE)).not.toMatch(/text-\[7px\]/);
  });

  it("composes into one class string", () => {
    const cls = solidPillClass("bg-amber-500/15 text-amber-600", "compact");
    expect(cls).toContain("bg-amber-700");
    expect(cls).toContain("text-white");
    expect(cls).toContain("text-[8.5px]");
  });
});

describe("no surface bypasses the shared pill", () => {
  const SURFACES = [
    "src/components/UserBadgeInline.tsx",
    "src/components/UserRoleInline.tsx",
    "src/components/admin/AdminBadgeRoleDefinitions.tsx",
  ];

  it("every badge/role surface renders through solidPillClass", () => {
    for (const f of SURFACES) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, `${f} must render badges through solidPillClass`).toContain("solidPillClass");
    }
  });

  it("no surface interpolates a stored class straight into the markup", () => {
    // `${cfg.badge_class}` in a className is how the unreadable value reached
    // the screen in the first place.
    for (const f of SURFACES) {
      const src = stripComments(readFileSync(join(process.cwd(), f), "utf8"));
      expect(src, `${f} interpolates a raw stored class`).not.toMatch(
        /\$\{\s*\w+\.(badge_class|pill_class)\s*\}/,
      );
    }
  });

  it("the admin's colour presets are all solid and all readable", () => {
    const src = readFileSync(join(process.cwd(), SURFACES[2]), "utf8");
    const block = src.slice(src.indexOf("const COLOR_PRESETS"), src.indexOf("];", src.indexOf("const COLOR_PRESETS")));
    // Every preset's badge value must be one of the vetted fills.
    const badges = [...block.matchAll(/badge:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(badges.length).toBeGreaterThan(5);
    const allowed = new Set(Object.values(BADGE_FILL));
    for (const b of badges) expect(allowed, `preset "${b}" is not a vetted fill`).toContain(b);
    // and the swatch dot must be the real colour, so the admin picks what they see
    const dots = [...block.matchAll(/dot:\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const d of dots) expect(contrast(WHITE, d)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });
});

describe("the NAME outranks the badge for space", () => {
  /**
   * Owner report, 2026-08-04: "Name 1st visible then Badge. Here Name is
   * overlapped by Badge." In the ~220px sidebar the pill was `shrink-0`, so it
   * kept its full width and the NAME truncated to "nni...". My regression - the
   * bigger pill made an existing weakness visible.
   *
   * Verified by rendering at 220 / 280 / 420px: the name stays fully visible at
   * all three and the BADGE truncates instead.
   */
  it("the pill can shrink - it is not shrink-0 any more", () => {
    expect(BADGE_PILL_BASE).not.toMatch(/shrink-0/);
    expect(BADGE_PILL_BASE).toMatch(/min-w-0/);
    expect(BADGE_PILL_BASE).toMatch(/overflow-hidden/);
  });

  it("the badge row absorbs essentially all of the shortfall", () => {
    expect(BADGE_ROW_SHRINK).toMatch(/shrink-\[9999\]/);
    expect(BADGE_ROW_SHRINK).toMatch(/min-w-0/);
  });

  it("both surfaces apply it, and truncate the LABEL rather than the name", () => {
    for (const f of ["src/components/UserBadgeInline.tsx", "src/components/UserRoleInline.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, `${f} must apply BADGE_ROW_SHRINK to the row`).toContain("BADGE_ROW_SHRINK");
      expect(src, `${f} must truncate the badge label`).toMatch(/<span className="truncate">\{cfg\.label\}<\/span>/);
    }
  });

  it("the icon never disappears before the label does", () => {
    expect(BADGE_ICON_SIZE).toMatch(/shrink-0/);
  });
});
