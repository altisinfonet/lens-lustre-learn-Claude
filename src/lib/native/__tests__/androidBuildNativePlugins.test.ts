import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");

describe("S2 native exits — android-build.yml runs the plugin step and proves it shipped", () => {
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/android-build.yml"), "utf8");
  it("installs the app's own plugins after `cap add android` and before `cap sync android`", () => {
    const add = wf.indexOf("run: npx cap add android");
    const install = wf.indexOf("run: node scripts/android-native-plugins.mjs android");
    const sync = wf.indexOf("run: npx cap sync android");
    expect(add).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(add);
    expect(sync).toBeGreaterThan(install);
  });
  it("fails the build when ExitInfoPlugin is not in the release bundle's dex", () => {
    const i = wf.indexOf("name: Prove the ExitInfo plugin is inside the RELEASE bundle (blocking)");
    expect(i).toBeGreaterThan(wf.indexOf("./gradlew bundleRelease"));
    const step = wf.slice(i, wf.indexOf("- name:", i + 10));
    expect(step).toContain("Lcom/fiftymmretina/app/ExitInfoPlugin;");
    expect(step).not.toContain("continue-on-error");
  });
});
