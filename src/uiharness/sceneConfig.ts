/**
 * Scene metadata that must be readable BEFORE any app module loads.
 *
 * `main.tsx` has to decide whether to seed a signed-in session before it
 * imports `scenes.tsx`, because importing scenes pulls in the Supabase client,
 * and that client reads localStorage the moment it is constructed. Anything the
 * decision depends on therefore lives here, in a file that imports no app code
 * at all.
 */

/**
 * Scenes photographed as a SIGNED-OUT visitor. Everything else is signed in.
 *
 * This is a list rather than a flag on the scene because the scene object does
 * not exist yet at the moment the question is asked — see above.
 */
export const SIGNED_OUT_SCENES: readonly string[] = [
  "screen-login",
  "screen-not-found-signed-out",
  "screen-not-found-in-place-signed-out",
];

export function isSignedOutScene(name: string): boolean {
  return SIGNED_OUT_SCENES.includes(name);
}

/**
 * The `screen-` prefix means "this scene mounts a REAL PAGE and brings its own
 * provider stack" — router, auth, theme, i18n, query client, the real Layout.
 *
 * `main.tsx` must therefore NOT wrap it in the harness's own MemoryRouter.
 * Measured, not assumed: doing so threw
 *   "You cannot render a <Router> inside another <Router>"
 * on all five real screens at all three widths, and every screenshot was a
 * blank page. Pinned by a test so the convention cannot drift into a comment
 * nobody reads.
 */
export const REAL_SCREEN_PREFIX = "screen-";

/**
 * `journey-` IS THE SAME CONTRACT, FOR MORE THAN ONE PAGE.
 *
 * Added 2026-08-16 with the first journey scene. A journey mounts `AppShell`
 * exactly as a `screen-` scene does — same providers, same router — it just
 * registers several routes so a scene can navigate between real pages.
 *
 * Missing this prefix here is not a subtle failure: `main.tsx` wraps anything
 * it does not recognise in its own MemoryRouter, and the scene died with
 * "You cannot render a <Router> inside another <Router>" and rendered a blank
 * page — the same symptom the comment above records from the first five real
 * screens. Caught immediately, because the probe reported zero buttons on a
 * page that should have had fifteen.
 */
export const JOURNEY_PREFIX = "journey-";

export function providesOwnShell(name: string): boolean {
  return name.startsWith(REAL_SCREEN_PREFIX) || name.startsWith(JOURNEY_PREFIX);
}
