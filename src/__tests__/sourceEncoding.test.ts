/**
 * NO MOJIBAKE IN THE SOURCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-03
 *
 * The owner reported that text on the site was "just unreadable". It was not a
 * font problem. Reading the live DOM on 50mmretina.com/feed, the string behind
 * "See All" was:
 *
 *     53 65 65 20 41 6c 6c 20 | U+00E2 U+0086 U+0092
 *
 * The character that belongs there is U+2192 "→", whose UTF-8 bytes are exactly
 * E2 86 92. Those three bytes had been decoded as Latin-1 into three separate
 * characters and saved that way. U+0086 and U+0092 are C1 CONTROL characters —
 * no font contains a glyph for them, so every font draws a box. Changing the
 * typeface could never have fixed it.
 *
 * 74 runs were damaged across 6 files. 41 of them rendered to members:
 *
 *   - every competition placement badge   🏆 🥈 🥉 🎖 ⚖️ 🌟 ✨ ⭐ 👁
 *   - every round status icon             ✓ ★ ✗ ⚠
 *   - the sidebar medal helper            🏆 🥇 🥈 🥉
 *   - four sidebar links                  "See All →", "View All →", …
 *   - the pinned-comment marker           📌
 *   - both comment box placeholders       "Write a reply…", "Add a comment…"
 *
 * The remaining 33 sat in comments and never rendered.
 *
 * WHY A TEST AND NOT JUST A FIX
 *   Nobody typed those characters. A tool in the chain read a UTF-8 file as
 *   Latin-1 and re-saved it. Whatever did that can do it again, silently, and
 *   the damage is invisible in a normal diff review — "â" looks like a typo,
 *   not like corruption. This test is the tripwire.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HOW IT DETECTS THE DAMAGE
 *
 * Mojibake has a signature that clean text does not: a run of two or more
 * characters in U+0080..U+00FF that, re-encoded as Latin-1, is valid UTF-8.
 *
 * That cannot fire on legitimate content:
 *   - a single accented letter ("é") is one character — the run needs two
 *   - a genuine pair ("ää" = C3A4 C3A4 as text, E4 E4 as Latin-1 bytes) is not
 *     valid UTF-8, so the round trip throws
 *   - a repair that yields a control character is rejected outright
 *
 * Proven against the real corruption before it was fixed: 74 detections, 0 false
 * positives across 1497 text files — including src/i18n/translations.ts, which
 * holds ~120,000 Devanagari, Tamil, Telugu, Bengali and Gujarati characters and
 * is completely clean.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "supabase/functions"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);
const EXTS = /\.(tsx?|jsx?|css|html|json|sql)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory absent in this checkout — nothing to scan
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/** Two or more consecutive characters in the Latin-1 supplement block. */
const RUN = /[-ÿ]{2,}/g;

/** A control character has no business surviving a repair. */
const hasControl = (s: string) =>
  [...s].some((c) => c.codePointAt(0)! < 0x20 || (c.codePointAt(0)! >= 0x7f && c.codePointAt(0)! <= 0x9f));

/**
 * Re-encode a run as Latin-1 bytes and try to read it back as UTF-8.
 * Returns the repaired text when the run really is mojibake, else null.
 */
function repairIfMojibake(run: string): string | null {
  const bytes = new Uint8Array([...run].map((c) => c.codePointAt(0)!));
  if (bytes.some((b) => b > 0xff)) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null; // not valid UTF-8 → genuine accented text, leave it alone
  }
  if (hasControl(decoded)) return null;
  return decoded;
}

type Finding = { file: string; line: number; saw: string; meant: string };

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const src = readFileSync(file, "utf8");
      RUN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RUN.exec(src)) !== null) {
        const meant = repairIfMojibake(m[0]);
        if (meant === null) continue;
        findings.push({
          file: file.slice(process.cwd().length + 1),
          line: src.slice(0, m.index).split("\n").length,
          saw: [...m[0]].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" "),
          meant,
        });
      }
    }
  }
  return findings;
}

describe("source files are not mojibake-corrupted", () => {
  it("contains no character run that decodes as misread UTF-8", () => {
    const findings = scan();
    const report = findings
      .map((f) => `  ${f.file}:${f.line}  has ${f.saw}  — should be "${f.meant}"`)
      .join("\n");
    expect(
      findings,
      findings.length === 0
        ? ""
        : `\n${findings.length} corrupted character run(s) found. A tool has re-saved a ` +
            `UTF-8 file as Latin-1.\nDo NOT hand-edit these — run the repair described in ` +
            `this file's header.\n\n${report}\n`,
    ).toHaveLength(0);
  });

  it("the detector actually fires — it is not vacuously green", () => {
    // The exact corruption that shipped: "→" (U+2192, UTF-8 E2 86 92) read as
    // Latin-1. Built from code points on purpose — writing the broken characters
    // literally would make THIS file fail the test above, which is exactly what
    // that test is for.
    const corrupted = "See All " + String.fromCharCode(0x00e2, 0x0086, 0x0092);
    RUN.lastIndex = 0;
    const m = RUN.exec(corrupted);
    expect(m).not.toBeNull();
    expect(repairIfMojibake(m![0])).toBe("→");
  });

  it("leaves genuine non-Latin text alone", () => {
    // src/i18n/translations.ts ships ~120,000 characters of these scripts.
    for (const sample of ["हिंदी", "বাংলা", "தமிழ்", "తెలుగు", "ગુજરાતી", "café", "naïve", "Müller", "señor"]) {
      RUN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RUN.exec(sample)) !== null) {
        expect(repairIfMojibake(m[0])).toBeNull();
      }
    }
  });
});
