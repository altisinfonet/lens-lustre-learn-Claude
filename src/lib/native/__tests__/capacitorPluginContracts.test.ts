// @vitest-environment node
/**
 * S11 build · Capacitor plugin contracts.
 *
 * The web code reaches native plugins through `window.Capacitor.Plugins.X` and
 * declares its own small type for each (GalleryPlugin, AppUpdatePlugin, …). No
 * plugin package is installed in the web build, so nothing checked that a
 * method the app calls exists in the version android-build.yml really pins.
 * A pin bump that renames or drops a method would ship an app whose button
 * silently does nothing (every call site guards with `?.`).
 *
 * This compares every member the app declares for a plugin against the methods
 * of the PINNED version (fixtures/capacitorPluginContracts.json), and the
 * fixture's versions against the pins in android-build.yml.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const fixture = JSON.parse(read("src/lib/native/__tests__/fixtures/capacitorPluginContracts.json")).plugins as Record<string, { version: string; methods: string[] }>;
const wf = read(".github/workflows/android-build.yml");

/** Window.Capacitor.Plugins key → npm package. */
const PLUGIN_PKG: Record<string, string> = {
  App: "@capacitor/app",
  Browser: "@capacitor/browser",
  Camera: "@capacitor/camera",
  FirebaseMessaging: "@capacitor-firebase/messaging",
  AppUpdate: "@capawesome/capacitor-app-update",
  Filesystem: "@capacitor/filesystem",
  Share: "@capacitor/share",
};
/** Named local types that stand for a plugin (file → type name → Plugins key). */
const NAMED: [string, string, string][] = [
  ["src/lib/native/gallery.ts", "GalleryPlugin", "Camera"],
  ["src/lib/native/push.ts", "FirebaseMessagingPlugin", "FirebaseMessaging"],
  ["src/lib/native/appUpdate.ts", "AppUpdatePlugin", "AppUpdate"],
  ["src/lib/saveFile.ts", "FilesystemPlugin", "Filesystem"],
  ["src/lib/saveFile.ts", "SharePlugin", "Share"],
  ["src/lib/appVersion.ts", "AppPlugin", "App"],
  ["src/hooks/core/useAndroidBackButton.ts", "AppPlugin", "App"],
];

/** The `{ … }` body starting at index `open` (which must be a "{"). */
function block(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}
/** Top-level member names of a type-literal body: `name?:`, `name(`, `name:`. */
function members(body: string): string[] {
  // "=>" is not a closing angle bracket — drop it before counting nesting.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/=>/g, " ");
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= clean.length; i++) {
    const c = clean[i];
    if (c === "{" || c === "(" || c === "<" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === ">" || c === "]") depth--;
    if ((c === ";" || c === "\n" || c === "," || i === clean.length) && depth === 0) {
      const m = /^\s*([A-Za-z_]\w*)\??\s*[:(<]/.exec(clean.slice(start, i));
      if (m) out.push(m[1]);
      start = i + 1;
    }
  }
  return [...new Set(out)];
}
function namedType(src: string, name: string): string[] {
  const m = new RegExp(`(?:interface|type)\\s+${name}\\b[^{=]*=?\\s*\\{`).exec(src);
  if (!m) throw new Error(`no type ${name}`);
  return members(block(src, m.index + m[0].length - 1));
}
/** Every `Plugins?: { X?: { … } }` declaration in the source tree. */
function inlineDeclarations(): { file: string; plugin: string; members: string[] }[] {
  const out: { file: string; plugin: string; members: string[] }[] = [];
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const file of walk("src")) {
    const src = read(file);
    for (const pm of src.matchAll(/Plugins\??\s*:\s*\{/g)) {
      const body = block(src, pm.index! + pm[0].length - 1);
      for (const k of Object.keys(PLUGIN_PKG)) {
        const km = new RegExp(`(^|[\\s;,{])${k}\\??\\s*:\\s*\\{`).exec(body);
        if (km) out.push({ file, plugin: k, members: members(block(body, km.index + km[0].length - 1)) });
      }
    }
  }
  return out;
}

describe("Capacitor plugin contracts", () => {
  it("the fixture covers exactly the plugins android-build.yml pins, at the pinned versions", () => {
    for (const [pkg, { version }] of Object.entries(fixture)) {
      expect(wf, `${pkg}@${version} not in the install line`).toContain(`${pkg}@${version}`);
      expect(wf, `${pkg} ${version} not in the pin check`).toMatch(new RegExp(`check ${pkg.replace(/[/.]/g, "\\$&")} ${version.replace(/\./g, "\\.")}\\n`));
    }
    for (const pkg of Object.values(PLUGIN_PKG)) expect(fixture[pkg], `no contract for ${pkg}`).toBeDefined();
  });

  it.each(NAMED)("%s · %s: every member exists in the pinned plugin", (file, type, plugin) => {
    const declared = namedType(read(file), type);
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter((m) => !fixture[PLUGIN_PKG[plugin]].methods.includes(m));
    expect(missing, `${file} ${type} calls methods ${PLUGIN_PKG[plugin]}@${fixture[PLUGIN_PKG[plugin]].version} does not have`).toEqual([]);
  });

  it("every inline `Plugins: { X: {…} }` declaration names only methods the pinned plugin has", () => {
    const decls = inlineDeclarations();
    expect(decls.length).toBeGreaterThanOrEqual(5); // App in several hooks, Browser + App in authDeepLink …
    const bad = decls.flatMap((d) => d.members
      .filter((m) => !fixture[PLUGIN_PKG[d.plugin]].methods.includes(m))
      .map((m) => `${d.file}: ${d.plugin}.${m}`));
    expect(bad).toEqual([]);
  });
});
