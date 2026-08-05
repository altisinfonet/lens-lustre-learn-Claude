/**
 * SAVING A FILE — THE ONE PLACE IT HAPPENS, ON WEB AND IN THE APP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-05:
 *
 *   "Any images clcked to downalod, not dowandling only in App, any journal and
 *    featured artist any article PDF showing downlaiding but not dwonalding as
 *    PDF docuemnt in mobile"
 *
 * TWO SYMPTOMS, ONE CAUSE. Every download in this app ended the same way:
 *
 *     const url = URL.createObjectURL(blob);
 *     const a = document.createElement("a");
 *     a.download = fileName;
 *     a.click();
 *
 * — in `downloadImageAsJpeg` for photos, and inside jsPDF's own `save()` for
 * the article PDFs (verified in node_modules/jspdf: it builds an <a>, sets
 * `download`, and dispatches a MouseEvent click — exactly the same thing).
 *
 * IN A BROWSER that hands the blob to the browser's download manager and the
 * file lands in Downloads.
 *
 * INSIDE THE INSTALLED APP IT DOES NOTHING AT ALL. An Android WebView has no
 * download manager. It forwards a download to a `DownloadListener` on the
 * WebView, and this app registers none — the Android project is generated fresh
 * by `npx cap add android` in CI with no custom MainActivity, so there is
 * nothing listening. `a.download` is ignored and a `blob:` URL cannot be handed
 * to Android's system DownloadManager anyway. The click is swallowed silently:
 * no error, no toast, no file.
 *
 * That is also why the PDF "shows downloading but does not download". All the
 * real work — fetching every photo, rendering the pages — SUCCEEDS, so the
 * spinner runs and finishes. Only the final save is dropped on the floor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT SAVES TO CACHE AND THEN SHARES, RATHER THAN WRITING TO "DOCUMENTS"
 *
 * From the Filesystem plugin's own documentation for `Directory.Documents`:
 * *"On Android 11 or newer the app can only access the files/folders the app
 * created."* So a file written to Documents on any modern phone is invisible in
 * the Files app and invisible in the Gallery — we would have replaced "nothing
 * happens" with "it says saved and the member still cannot find it", which is
 * worse, because it looks fixed.
 *
 * So: write to the app's own cache (no storage permission needed, and Android
 * may reclaim it later, which is correct for a temporary copy), then hand the
 * file to the system share sheet. The member chooses — Gallery, Files, Drive,
 * WhatsApp, anywhere. That is how a saved file actually reaches a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS FILE MUST NEVER `import` A @capacitor/* PACKAGE.
 *
 * Same standing rule as src/lib/native/authDeepLink.ts, and for the same
 * reason: the Capacitor npm packages are installed ONLY in the Android CI job,
 * never in the Cloudflare web deploy. A static import here would break the
 * website's build. We reach the plugins through the `window.Capacitor` runtime
 * globals, which exist only inside the app.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

type FilesystemPlugin = {
  writeFile: (opts: {
    path: string;
    data: string;
    directory?: string;
    recursive?: boolean;
  }) => Promise<{ uri: string }>;
};

type SharePlugin = {
  share: (opts: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }) => Promise<unknown>;
};

type CapGlobal = {
  Plugins?: {
    Filesystem?: FilesystemPlugin;
    Share?: SharePlugin;
  };
};

const plugins = (): CapGlobal["Plugins"] =>
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor?.Plugins;

/**
 * The member-facing sentence for an app that predates this fix.
 *
 * Builds up to and including 1051 have no Filesystem plugin bundled, so there
 * is genuinely nothing this code can do there — and per the standing rule an
 * error must tell the member what to DO, not merely that something failed.
 */
export const SAVE_NEEDS_UPDATE_MESSAGE =
  "This version of the app can't save files yet. Please update the app, then try again.";

/** Blob → bare base64 (no `data:...;base64,` prefix, which the plugin rejects). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file to save."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Strip anything a filesystem would object to, and keep the extension. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "download";
}

/**
 * Save a blob so the member ends up with the file.
 *
 * WEB / PWA — unchanged from what has always shipped: an anchor with
 * `download`, handed to the browser's download manager.
 *
 * APP — written to the app's cache and offered through the system share sheet.
 *
 * Throws a member-facing sentence if it cannot save; callers surface it.
 */
export async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const name = safeFileName(fileName);

  if (!isNativeCapacitorApp()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const fs = plugins()?.Filesystem;
  const share = plugins()?.Share;
  if (!fs || !share) {
    // An older build with no Filesystem/Share plugin bundled. Nothing here can
    // reach the disk, so say so plainly rather than failing silently — silence
    // is what this whole file exists to end.
    throw new Error(SAVE_NEEDS_UPDATE_MESSAGE);
  }

  const data = await blobToBase64(blob);
  // CACHE, not DOCUMENTS — see the note at the top of this file. Also the only
  // directory that needs no storage permission on any Android version.
  const { uri } = await fs.writeFile({
    path: name,
    data,
    directory: "CACHE",
    recursive: true,
  });

  // `files` is the file-sharing field (Capacitor 5+). `url` is kept as a
  // fallback for a share plugin older than that; passing both is harmless.
  await share.share({
    title: name,
    files: [uri],
    url: uri,
    dialogTitle: "Save or share",
  });
}

export default saveBlob;
