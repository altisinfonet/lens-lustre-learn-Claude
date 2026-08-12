/**
 * THE DEVICE PHOTO LIBRARY — reached through runtime globals, never an import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS FILE MUST NOT `import` ANY `@capacitor/*` PACKAGE.
 *
 * Those packages exist only in the Android CI job. A static import here does
 * not break the app — it breaks the WEBSITE BUILD, because Vite resolves
 * imports at build time and the dependency is not installed for the web target.
 * The same rule is already written into `authDeepLink.ts` and `appVersion.ts`,
 * and `saveFile.test.ts` asserts it. `galleryStaticImportGuard` below asserts it
 * for this file too.
 *
 * So everything is reached through `window.Capacitor.Plugins`, which is present
 * only inside the APK and simply absent on the web.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALWAYS A FALLBACK
 *
 * A browser cannot enumerate a photo library — that is a platform limit, not a
 * design choice — so web always uses the OS file dialog. And on the app the
 * grid can still be unavailable: the plugin may be missing from an older APK,
 * or the member may refuse the permission. In every one of those cases the
 * composer falls back to the same file input the app uses today rather than
 * showing an empty grid and a dead end.
 */
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

/** One entry from the device library. */
export interface DevicePhoto {
  /** A displayable source — usually a `file://` or `data:` URL from the plugin. */
  webPath: string;
  /** Native path, kept so the upload step can read the original bytes. */
  path?: string;
  format?: string;
}

export type GalleryMode =
  /** The in-app grid: native, permission granted, plugin present. */
  | "native-grid"
  /** The OS picker: web always, and the app whenever the grid is unavailable. */
  | "os-picker";

interface GalleryPlugin {
  checkPermissions?: () => Promise<{ photos?: string }>;
  requestPermissions?: () => Promise<{ photos?: string }>;
  /** Capacitor's Camera plugin exposes multi-pick as `pickImages`. */
  pickImages?: (opts: { quality?: number; limit?: number }) => Promise<{ photos: DevicePhoto[] }>;
}

/** The runtime bridge, or undefined on the web. Never an import. */
const plugin = (): GalleryPlugin | undefined => {
  try {
    return (window as unknown as {
      Capacitor?: { Plugins?: { Camera?: GalleryPlugin } };
    }).Capacitor?.Plugins?.Camera;
  } catch {
    return undefined;
  }
};

/** Is the in-app grid even possible here? Cheap, synchronous, no permission prompt. */
export const canUseNativeGallery = (): boolean => {
  if (!isNativeCapacitorApp()) return false;
  const p = plugin();
  return typeof p?.pickImages === "function";
};

/**
 * Ask for library access.
 *
 * Returns false rather than throwing when refused, because a refusal is a
 * normal answer and not an error — the caller falls back to the OS picker.
 */
export async function ensureGalleryPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const current = await p.checkPermissions?.();
    if (current?.photos === "granted" || current?.photos === "limited") return true;
    const asked = await p.requestPermissions?.();
    return asked?.photos === "granted" || asked?.photos === "limited";
  } catch {
    return false;
  }
}

/**
 * Which picker should the composer show?
 *
 * Resolved once when the composer opens, so the member never sees the UI change
 * under them mid-flow.
 */
export async function resolveGalleryMode(): Promise<GalleryMode> {
  if (!canUseNativeGallery()) return "os-picker";
  return (await ensureGalleryPermission()) ? "native-grid" : "os-picker";
}

/**
 * Open the device library and return what was chosen.
 *
 * `limit` is passed through so a member cannot select 400 photos and wedge the
 * upload step. An empty array means they cancelled, which is not a failure.
 */
export async function pickFromGallery(limit = 10): Promise<DevicePhoto[]> {
  const p = plugin();
  if (!p?.pickImages) return [];
  try {
    const res = await p.pickImages({ quality: 90, limit });
    return Array.isArray(res?.photos) ? res.photos : [];
  } catch {
    // Cancelling raises on some Android versions. Indistinguishable from a
    // real failure at this layer, and both mean "nothing was chosen".
    return [];
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FROM A PICKED PHOTO TO SOMETHING THE UPLOAD PATH CAN ACTUALLY USE.
 *
 * `pickImages` hands back a `webPath` — a `capacitor://localhost/_capacitor_file_…`
 * URL the WebView can fetch, NOT bytes and NOT a File. Every existing step of
 * the composer (the compressor, the security scanner, `uploadPhotos`) takes a
 * `File`. So this is the adapter, and it is deliberately the ONLY place the two
 * worlds meet.
 *
 * ⚠ THE FILENAME IS NOT COSMETIC. `processFile()` in WallPosts rejects anything
 * whose name fails `SUPPORTED_IMAGE_RE` — a File called "photo" with no
 * extension is dropped silently, which would read as "the picker did nothing".
 * The extension is derived from the blob's real MIME type first and the
 * plugin's `format` only as a fallback, because the plugin reports `format` from
 * the file name it was given and that is exactly the thing we cannot trust.
 *
 * `fetchImpl` is injectable so the test can prove the naming and the failure
 * handling without a WebView.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

export async function devicePhotosToFiles(
  photos: DevicePhoto[],
  fetchImpl: typeof fetch = fetch,
): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p?.webPath) continue;
    try {
      const res = await fetchImpl(p.webPath);
      const blob = await res.blob();
      const type = blob.type || (p.format ? `image/${p.format}` : "image/jpeg");
      // MIME first, plugin `format` second, jpg last. See the ruling above.
      const ext = EXT_BY_MIME[type] ?? (p.format || "jpg").toLowerCase();
      out.push(
        new File([blob], `photo-${i + 1}.${ext}`, {
          type,
          lastModified: 0,
        }),
      );
    } catch {
      // One unreadable photo must not lose the other nine. A member who picked
      // ten and got nine is annoyed; one who picked ten and got zero is blocked.
      continue;
    }
  }
  return out;
}

/**
 * The whole app-side pick, in one call: open Android's picker, read what came
 * back, hand the composer real Files. Returns an empty array when the member
 * cancels — which is not a failure and must not raise.
 */
export async function pickGalleryFiles(limit = 10): Promise<File[]> {
  const photos = await pickFromGallery(limit);
  if (!photos.length) return [];
  return devicePhotosToFiles(photos);
}

/**
 * Exported so the guard test can assert the no-static-import rule against the
 * real source rather than trusting a comment.
 */
export const galleryStaticImportGuard = "no-capacitor-static-imports" as const;
