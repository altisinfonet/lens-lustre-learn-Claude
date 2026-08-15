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
export const SIGNED_OUT_SCENES: readonly string[] = ["screen-login"];

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

export function providesOwnShell(name: string): boolean {
  return name.startsWith(REAL_SCREEN_PREFIX);
}
