/**
 * BUG-043 — Cloudflare Turnstile CAPTCHA for Supabase Auth.
 *
 * Supabase Auth has captcha protection ENABLED (provider: turnstile), so every
 * password sign-in, sign-up, and password-reset request must carry a valid
 * captchaToken or GoTrue rejects it server-side. That server-side check is the
 * actual brute-force enforcement — this helper just mints tokens for the UI.
 *
 * The widget renders in a fixed bottom-right container with
 * appearance:"interaction-only": invisible for virtually all real users, and
 * only pops a visible challenge when Cloudflare wants interaction. Tokens are
 * single-use — call getCaptchaToken() freshly before every auth attempt.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

// Public site key (safe to ship in the bundle by design).
const TURNSTILE_SITE_KEY = "0x4AAAAAAD2cIy9cziOBz3e9";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (turnstileApi()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Get a fresh single-use Turnstile token. Resolves to undefined on any
 * failure (script blocked, timeout, widget error) — the auth call then
 * proceeds without a token and surfaces GoTrue's captcha error, which is
 * clearer than hanging the form.
 */
export async function getCaptchaToken(): Promise<string | undefined> {
  try {
    await loadTurnstileScript();
    const ts = turnstileApi();
    if (!ts) return undefined;

    return await new Promise<string | undefined>((resolve) => {
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;";
      document.body.appendChild(container);

      let settled = false;
      let widgetId: string | null = null;
      const finish = (token: string | undefined) => {
        if (settled) return;
        settled = true;
        try {
          if (widgetId) ts.remove(widgetId);
        } catch { /* already gone */ }
        container.remove();
        resolve(token);
      };

      try {
        widgetId = ts.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          callback: (token: string) => finish(token),
          "error-callback": () => finish(undefined),
          "timeout-callback": () => finish(undefined),
          "expired-callback": () => finish(undefined),
        });
      } catch {
        finish(undefined);
        return;
      }

      // Safety net: never block an auth form for more than 45s
      // (interactive challenges need time; invisible passes take ~1s).
      setTimeout(() => finish(undefined), 45000);
    });
  } catch {
    return undefined;
  }
}
