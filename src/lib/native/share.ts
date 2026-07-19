// @ts-nocheck — Capacitor plugins are installed locally (see CAPACITOR_SETUP.md).
// Excluded from CI typecheck until deps are installed; remove this line afterward
// to get full typing back.
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

// Share sheet. Uses the native share dialog inside the app, the Web Share API in
// supporting browsers, and copy-to-clipboard as a final fallback. Returns true if
// the content was shared or copied.

export async function shareContent(opts: { title?: string; text?: string; url?: string }): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title || 'Share' });
      return true;
    }
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      await (navigator as any).share(opts);
      return true;
    }
    if (opts.url && navigator?.clipboard) {
      await navigator.clipboard.writeText(opts.url);
      return true;
    }
  } catch {
    // user cancelled the share sheet — not an error
  }
  return false;
}
