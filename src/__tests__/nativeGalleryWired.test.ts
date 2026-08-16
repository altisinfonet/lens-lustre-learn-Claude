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
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { devicePhotosToFiles } from "@/lib/native/gallery";
import { stripComments } from "@/test-utils/sourceText";

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
    const code = stripComments(src);
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A FAILURE MUST NOT LOOK LIKE A CANCELLATION.
 *
 * Owner, 2026-08-16: "Create Post : Many times not working."
 *
 * `pickGalleryFiles` used to return `File[]`. Both of these came back as `[]`:
 *
 *   • the member backed out of Android's picker          — say nothing
 *   • they chose four photos and none could be read      — say something
 *
 * and the composer's answer to `[]` is to return without opening anything. So
 * a total read failure was indistinguishable, on screen, from the Create
 * button doing nothing — which is exactly the report.
 *
 * These pin the distinction itself. They cannot prove a photo reads on a real
 * device; they prove the caller is TOLD which of the two happened, which is
 * what makes the difference between a bug someone can report and a bug they
 * conclude is "the app being broken".
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("cancelled and failed are not the same answer", () => {
  const photo = (n: number) => ({ webPath: `capacitor://localhost/_capacitor_file_/p${n}.jpg` });

  /** Installs a fake Camera plugin that hands back `n` photos. */
  const withPicker = (n: number) => {
    (globalThis as unknown as { window: Window }).window = globalThis.window ?? ({} as Window);
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {
        Camera: {
          pickImages: async () => ({ photos: Array.from({ length: n }, (_, i) => photo(i)) }),
        },
      },
    };
  };

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.unstubAllGlobals();
  });

  it("reports a cancellation as picked: 0, so the caller stays silent", async () => {
    withPicker(0);
    const { pickGalleryFiles } = await import("@/lib/native/gallery");
    const r = await pickGalleryFiles(10);
    expect(r).toEqual({ files: [], picked: 0, unreadable: 0 });
  });

  it("reports a TOTAL read failure as picked > 0 with no files — the silent dead end", async () => {
    withPicker(4);
    vi.stubGlobal("fetch", async () => { throw new Error("capacitor path revoked"); });
    const { pickGalleryFiles } = await import("@/lib/native/gallery");
    const r = await pickGalleryFiles(10);
    expect(r.picked, "the member did choose photos").toBe(4);
    expect(r.files.length, "and none of them survived").toBe(0);
    expect(r.unreadable).toBe(4);
    // The distinction the whole fix rests on: this is NOT a cancellation.
    expect(r.picked > 0 && r.files.length === 0).toBe(true);
  });

  it("reports a PARTIAL loss so the post still opens with what survived", async () => {
    withPicker(3);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call += 1;
      if (call === 2) throw new Error("one bad photo");
      return { blob: async () => new Blob(["x"], { type: "image/jpeg" }) } as unknown as Response;
    });
    const { pickGalleryFiles } = await import("@/lib/native/gallery");
    const r = await pickGalleryFiles(10);
    expect(r.picked).toBe(3);
    expect(r.files.length, "two of three is better than none").toBe(2);
    expect(r.unreadable).toBe(1);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "(A) NOTHING OPENS AT ALL" — the owner's own answer, 2026-08-16, when asked
 * which of three shapes the Create Post failure takes.
 *
 * The Camera plugin REJECTS both when the member backs out and when the picker
 * cannot open. The old `catch` returned `[]` for both, the composer's answer to
 * `[]` is to close, and so a picker that failed to open was a Create button
 * that did nothing and said nothing.
 *
 * The default matters and is deliberately the unforgiving one: only a message
 * that actually says "cancel" counts as a cancellation. Anything unrecognised
 * is treated as a fault, because guessing "cancelled" restores the silence this
 * exists to remove.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("a picker that cannot open is not a member changing their mind", () => {
  const withThrowingPicker = (message: string) => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: { Camera: { pickImages: async () => { throw new Error(message); } } },
    };
  };

  afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

  it.each([
    "User cancelled photos app",
    "canceled",
    "Activity cancelled by user",
  ])("treats %j as a cancellation and stays silent", async (msg) => {
    withThrowingPicker(msg);
    const { pickFromGallery } = await import("@/lib/native/gallery");
    await expect(pickFromGallery(10)).resolves.toEqual([]);
  });

  it.each([
    "Unable to resolve activity",
    "Permission denied",
    "",
  ])("treats %j as a FAILURE and raises so the member is told", async (msg) => {
    withThrowingPicker(msg);
    const { pickFromGallery, GalleryPickerError } = await import("@/lib/native/gallery");
    await expect(pickFromGallery(10)).rejects.toBeInstanceOf(GalleryPickerError);
  });
});
