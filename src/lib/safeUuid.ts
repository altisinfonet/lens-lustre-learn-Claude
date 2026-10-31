/**
 * A UUID that cannot crash the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — production evidence, 2026-08-09.
 *
 * Admin → Site Health → Client failures, on build `2026-08-07-7` (1058):
 *
 *   Blank page / crash   app   7×   TypeError · crypto.randomUUID is not a function
 *   sys                  app  13×   A route crashed; the member is looking at the
 *                                   Reload screen, not the page they asked for.
 *
 * Both rows are `platform = app`. Twenty failures in a single hour, and the
 * owner's report matches exactly: *"after changing pages sometimes coming and
 * sometime showing blank pages"*.
 *
 * `crypto.randomUUID()` is NOT universally available:
 *   • it landed in Chromium 92 (July 2021), so any phone whose **Android System
 *     WebView** has never been updated does not have it — and the WebView
 *     updates through the Play Store independently of the OS, so a current
 *     Android version is no guarantee;
 *   • it is exposed only in a **secure context**. `crypto.getRandomValues()`
 *     has neither restriction and has shipped since Chromium 11.
 *
 * On such a device the call throws a TypeError. Every unguarded call site sat
 * inside a render or a react-query `queryFn`, so the throw reached
 * `AppErrorBoundary` and the member got the Reload screen — a blank page with a
 * header. Nothing was wrong with the page they asked for.
 *
 * WHY IT LOOKED INTERMITTENT rather than "the app is broken": the call sites are
 * on different paths (device id, A/B session id, nav menu seed, upload
 * filename). Which pages die depends on which path that particular screen
 * touches, so the same phone shows some pages fine and others blank.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE: no code in `src/` may call `crypto.randomUUID()` directly.
 * `src/lib/__tests__/safeUuid.test.ts` fails the build if one comes back.
 *
 * (Edge functions under `supabase/functions/` are exempt — they run in Deno,
 * which always has it. This is a browser problem only.)
 *
 * NOT FOR SECRETS. The last-resort `Math.random()` branch is not
 * cryptographically strong. Every caller here wants a collision-free *label* —
 * a device id, a temp filename, a local list key — never an unguessable token.
 * If you ever need a secret, generate it server-side.
 */

/** The v4 shape: 8-4-4-4-12 lowercase hex, version nibble 4, variant 8|9|a|b. */
export function safeRandomUUID(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;

  // Fast path — every modern browser, and identical output to before.
  if (typeof c?.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Some hardened/embedded WebViews expose the name but throw on call.
      // Falling through is the whole point of this file.
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    // Unreachable in any browser that has `crypto` at all — kept so this
    // function can never be the thing that throws.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx (RFC 4122)

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));

  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

export default safeRandomUUID;
