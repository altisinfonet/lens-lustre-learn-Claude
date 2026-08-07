import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PERF regression pin, 2026-08-07.
 *
 * Navbar resolves admin-configured nav icons by name. It used to do that with
 * `import * as LucideIcons from "lucide-react"`, which pulls ALL ~1,500 icons
 * (~500 KB) into the boot chunk. It now uses a curated NAV_ICONS map of named
 * imports with a Circle fallback. This fails if the namespace import comes back.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/Navbar.tsx"),
  "utf8",
);

describe("Navbar does not pull the whole icon library into the boot chunk", () => {
  it("never imports the lucide-react namespace", () => {
    expect(SRC).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']/);
  });

  it("resolves nav icons through a curated map with a fallback", () => {
    expect(SRC).toContain("NAV_ICONS");
    expect(SRC).toMatch(/NAV_ICONS\[[^\]]+\]\s*\?\?\s*Circle/);
  });

  it("covers every icon configured in the live nav menu", () => {
    // The 12 names measured from site_settings on 2026-08-07. If the admin adds
    // a new one and it is not here, it will show the Circle fallback — add it.
    for (const name of [
      "Award", "BookOpen", "Compass", "FileCheck", "HelpCircle", "Home",
      "LogIn", "Newspaper", "Rss", "Trophy", "UserPlus", "Users",
    ]) {
      expect(SRC).toContain(name);
    }
  });
});
