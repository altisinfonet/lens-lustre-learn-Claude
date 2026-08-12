/**
 * THE DEAD-MODULE TRIPWIRE, and the picked-photo → File adapter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * Twice in Stage C a component was written, unit-tested, reviewed and merged —
 * and imported by nothing:
 *
 *   • `src/components/post/CreatePostModal.tsx` — the whole three-step Create
 *     post screen. Vite drops unreferenced modules, so it was never in the
 *     bundle. The owner saw a wall of category chips on the feed and said
 *     *"Bloody fucker, Where is the change ??"*. The tests were green the
 *     entire time.
 *   • `src/lib/native/gallery.ts` — the Android photo path. Zero callers, AND
 *     the plugin it reaches for (`@capacitor/camera`) was not even installed by
 *     the Android CI job, so `window.Capacitor.Plugins.Camera` was `undefined`
 *     in every APK ever built.
 *
 * The lesson is not "be more careful". It is that **a green test suite proves a
 * module works, not that anything renders it.** Import-count is the missing
 * assertion, so it is asserted here.
 *
 * If you delete a feature on purpose, delete its entry below too — that is the
 * moment to notice the module is now dead and should go.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { devicePhotosToFiles } from "@/lib/native/gallery";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every .ts/.tsx under src, except the file being asked about and its tests. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) {
        walk(rel);
      } else if (/\.tsx?$/.test(entry)) {
        out.push(rel);
      }
    }
  };
  walk("src");
  return out;
}

/**
 * How many NON-TEST modules import this one.
 *
 * Tests are excluded deliberately: `CreatePostModal.tsx` and `gallery.ts` were
 * both imported by their own tests and by nothing else, which is precisely the
 * state this guard has to call dead.
 */
function productionImporters(modulePath: string): string[] {
  const name = modulePath.replace(/^src\//, "@/").replace(/\.tsx?$/, "");
  const bare = name.replace(/\/index$/, "");
  return sourceFiles()
    .filter((f) => f !== modulePath)
    .filter((f) => !/__tests__|\.test\.tsx?$|\.spec\.tsx?$/.test(f))
    .filter((f) => {
      const src = read(f);
      return src.includes(`from "${bare}"`) || src.includes(`from '${bare}'`);
    });
}

describe("nothing ships dead", () => {
  const mustBeReachable = [
    "src/lib/native/gallery.ts",
    "src/components/post/CategoryChips.tsx",
    "src/components/post/DraftsList.tsx",
    "src/components/feed/CategoryStrip.tsx",
    "src/hooks/feed/usePostDrafts.ts",
    "src/lib/post/draftPersistence.ts",
  ];

  for (const mod of mustBeReachable) {
    it(`${mod} is imported by real code, not only by its test`, () => {
      const importers = productionImporters(mod);
      expect(
        importers.length,
        `${mod} has no production importer — Vite will tree-shake it out and it ` +
          `will not exist in the bundle, however green its own tests are.`,
      ).toBeGreaterThan(0);
    });
  }
});

describe("the Android camera plugin is actually installed", () => {
  // gallery.ts reads window.Capacitor.Plugins.Camera. That object only exists
  // if the CI job installed the plugin before `npx cap add android`. It did not,
  // for the entire life of the feature.
  it("android-build.yml installs @capacitor/camera", () => {
    expect(read(".github/workflows/android-build.yml")).toContain("@capacitor/camera");
  });
});

describe("gallery.ts still refuses static @capacitor imports", () => {
  it("reaches the bridge only through runtime globals", () => {
    const src = read("src/lib/native/gallery.ts");
    // Strip comments — this file DISCUSSES the banned pattern at length, and a
    // naive match would read its own documentation as a violation.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']@capacitor\//);
    expect(code).toContain("window as unknown as");
  });
});

describe("a picked photo becomes a File the composer accepts", () => {
  const fakeFetch = (type: string, bytes = [1, 2, 3]) =>
    (async () =>
      ({ blob: async () => new Blob([new Uint8Array(bytes)], { type }) }) as unknown as Response) as unknown as typeof fetch;

  it("names the file from its REAL mime type, not the plugin's format claim", async () => {
    // The plugin says "heic"; the bytes are a png. processFile() checks the
    // NAME, so trusting `format` here would drop the photo silently.
    const files = await devicePhotosToFiles(
      [{ webPath: "capacitor://localhost/_capacitor_file_/x", format: "heic" }],
      fakeFetch("image/png"),
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("photo-1.png");
    expect(files[0].type).toBe("image/png");
  });

  it("falls back to the plugin format when the blob has no type", async () => {
    const files = await devicePhotosToFiles(
      [{ webPath: "x", format: "webp" }],
      fakeFetch(""),
    );
    expect(files[0].name).toBe("photo-1.webp");
  });

  it("gives every file an extension — SUPPORTED_IMAGE_RE rejects bare names", async () => {
    const files = await devicePhotosToFiles(
      [{ webPath: "a" }, { webPath: "b" }],
      fakeFetch("image/jpeg"),
    );
    expect(files.map((f) => f.name)).toEqual(["photo-1.jpg", "photo-2.jpg"]);
    for (const f of files) {
      expect(f.name).toMatch(/\.(jpe?g|png|webp|gif|bmp|avif)$/i);
    }
  });

  it("ONE unreadable photo does not lose the other nine", async () => {
    let call = 0;
    const flaky = (async () => {
      call += 1;
      if (call === 2) throw new Error("EACCES");
      return { blob: async () => new Blob([new Uint8Array([1])], { type: "image/jpeg" }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const files = await devicePhotosToFiles(
      [{ webPath: "a" }, { webPath: "b" }, { webPath: "c" }],
      flaky,
    );
    // A member who picked three and got two is annoyed. One who picked three
    // and got zero is blocked. Never turn this into a rethrow.
    expect(files).toHaveLength(2);
  });

  it("skips entries with no webPath instead of producing an empty File", async () => {
    const files = await devicePhotosToFiles(
      [{ webPath: "" }, { webPath: "ok" }],
      fakeFetch("image/jpeg"),
    );
    expect(files).toHaveLength(1);
  });

  it("returns nothing when the member cancels", async () => {
    expect(await devicePhotosToFiles([], fakeFetch("image/jpeg"))).toEqual([]);
  });
});
