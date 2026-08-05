/**
 * A DEPLOY MUST NOT BREAK A TAB THAT IS ALREADY OPEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-05, with a screenshot of /admin/users showing
 * "Something went wrong while loading this page":
 *
 *   "SAME ERROR IN WEBS - EVEN AFTER YOU SOLVED THE ISSUE."
 *
 * MEASURED ON HIS OWN BROWSER, not guessed:
 *
 *   his open tab was running   index-DbdlrVrv.js
 *   which asks for             /assets/UsersModule-Cvs20BSd.js   -> HTTP 404
 *   the site now serves        index-BjiAot6T.js
 *   whose Users chunk is       /assets/UsersModule-BZGjWC0L.js   -> exists
 *
 * WHAT THAT MEANS. The app is split into lazily-loaded chunks whose filenames
 * contain a content hash. Every deploy produces NEW hashes, and Cloudflare
 * Pages serves only the newest set. A tab opened BEFORE a deploy still holds
 * the OLD filenames in memory. It works perfectly until the member navigates to
 * a screen whose chunk has not been downloaded yet — then it asks for a file
 * that no longer exists, gets a 404, and the lazy import rejects.
 *
 * THE ADMIN USERS PAGE IS THE MOST LIKELY PLACE TO SEE IT and that is not a
 * coincidence: it is a rarely-visited, separately-chunked route, so its chunk is
 * almost never already in memory when a deploy lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MY PART IN THIS, PLAINLY.
 *
 * Every merge to `main` deploys the website. On 2026-08-05 I merged eight times
 * in about an hour while the owner had the site open. Each one re-hashed every
 * chunk. The work in those commits was real and shipped — but the ACT of
 * shipping it repeatedly is what broke the tab he was sitting in front of.
 *
 * The bug was always latent: any single deploy could do this to any member with
 * the site open. Deploying eight times made it near-certain, and made it look
 * like the updates themselves were broken. They were not. This is the fix for
 * the underlying fault, so that a deploy is invisible to an open tab from now
 * on, however many there are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY RELOADING IS THE RIGHT ANSWER AND NOT A WORKAROUND
 *
 * There is nothing else to do. The file the running page wants is genuinely gone
 * from the server, and no amount of retrying will bring it back. The only
 * version of the app that can load that screen is the new one, and fetching the
 * new one IS a reload. Vite ships the `vite:preloadError` event for exactly this
 * situation.
 *
 * A reload here costs nothing the member notices: this fires while a NEW screen
 * is being opened, before anything on it has been drawn, so there is no typed
 * text or scroll position to lose.
 *
 * THE LOOP GUARD IS THE PART THAT MATTERS. If the reload itself cannot fetch the
 * chunk — the member is offline, or a proxy is failing — reloading again would
 * spin forever and leave them with a flashing white screen and no way out. So we
 * reload AT MOST ONCE per browser tab per 30 seconds; after that the error
 * boundary is allowed to show its "Something went wrong / RELOAD" screen, which
 * is the honest outcome when the network really is broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RELOAD_MARK = "stale_chunk_reloaded_at";
const COOLDOWN_MS = 30_000;

/** True when this failure is a missing/unfetchable lazy chunk, not a code bug. */
export function isStaleChunkError(reason: unknown): boolean {
  const message =
    typeof reason === "string"
      ? reason
      : ((reason as { message?: string } | null)?.message ?? "");
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) || // Safari's wording
    /'text\/html' is not a valid javascript mime type/i.test(message)
  );
}

/** Reload once, and only once, per tab per cooldown window. */
function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_MARK) || "0");
    if (last && Date.now() - last < COOLDOWN_MS) {
      // Already tried. Something else is wrong — let the error boundary speak
      // rather than spinning.
      return;
    }
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    // Private mode with storage disabled: without storage we cannot loop-guard,
    // so we do not reload at all. A dead screen the member can fix with their
    // own reload button beats a reload loop they cannot escape.
    return;
  }
  window.location.reload();
}

export function installStaleChunkReload(): void {
  if (typeof window === "undefined") return;

  // Vite's own signal, fired when a preloaded chunk cannot be fetched.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault(); // stop it becoming an unhandled error as well
    reloadOnce();
  });

  // The same failure arriving as a rejected dynamic import — this is the shape
  // the owner's console actually showed:
  //   "TypeError: Failed to fetch dynamically imported module: …UsersModule…"
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError(event.reason)) {
      event.preventDefault();
      reloadOnce();
    }
  });

  // And as a plain error, which is how some browsers report it.
  window.addEventListener("error", (event) => {
    if (isStaleChunkError(event.error ?? event.message)) {
      reloadOnce();
    }
  });
}

export default installStaleChunkReload;
