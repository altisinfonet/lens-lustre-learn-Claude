import { supabase } from "@/integrations/supabase/client";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

/**
 * REPORT A CLIENT-SIDE FAILURE, SO IT CAN BE COUNTED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-05, after a day of members unable to post:
 *   "Next time happened soo how to measure?? … what tracking you are follwoing,
 *    just i cant check is not the soltuion"
 *
 * He was right: nothing recorded any of it. A failed post, a failed reply, a
 * blank boot — every one of them died in the member's browser, and the only
 * signal that ever reached anyone was a complaint hours later with no detail.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The composer's catch block ends in
 * `err?.message || "Unknown error"`, so the member sees "Unknown error"
 * precisely when the thrown value carries NO message — the single case where
 * nobody learns anything. `describeThrown()` below exists to make that case
 * yield something real: a name, a status, a stringified body, anything.
 *
 * THE RULES THIS FILE OBEYS, because a reporter that misbehaves during an
 * outage makes the outage worse:
 *
 *   1. It NEVER throws. Every path is wrapped; failure to report is swallowed.
 *   2. It NEVER blocks. Nothing awaits it — a member's Retry must not wait on
 *      a logging round-trip.
 *   3. It is rate limited SERVER-side (20/member/hour), because this is called
 *      from inside retry loops and a logger that amplifies writes during an
 *      incident is a self-inflicted second outage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The things worth counting. Anything else is dropped by the database.
 *
 * `image_load` was added 2026-08-05 for the owner's longest-running and least
 * diagnosable report — "images are not coming", repeated for weeks, always
 * without a URL because Chrome truncates the console line to `404 ()` and
 * because the image service worker was answering failures with a transparent
 * 1x1 GIF that the browser treated as SUCCESS. See
 * supabase/migrations/20260805090000_client_error_image_load.sql.
 */
export type ClientErrorKind =
  | "post_create"
  | "reply"
  | "upload"
  | "blank_page"
  | "image_load";

/**
 * Turn ANY thrown value into a sentence.
 *
 * A plain `err.message` is empty exactly when it matters most. Supabase edge
 * failures arrive as `FunctionsFetchError` (name, no useful message), storage
 * failures as `{ statusCode, error }` objects, and an aborted upload as a
 * DOMException. Each of those used to render as "Unknown error".
 */
export function describeThrown(err: unknown): string {
  if (err == null) return "threw null/undefined";
  // An empty string is the same problem as a message-less Error: it would
  // render as nothing at all, which is where "Unknown error" came from.
  if (typeof err === "string") return err.trim() === "" ? "threw an empty string" : err;

  const anyErr = err as Record<string, any>;
  const parts: string[] = [];

  if (anyErr.name) parts.push(String(anyErr.name));
  if (anyErr.message) parts.push(String(anyErr.message));

  // Supabase FunctionsHttpError hides the real status here.
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr.context?.status;
  if (status != null) parts.push(`status=${status}`);
  if (anyErr.code) parts.push(`code=${anyErr.code}`);
  if (anyErr.error && typeof anyErr.error === "string") parts.push(anyErr.error);

  if (parts.length > 0) return parts.join(" · ");

  // Last resort: the shape itself is the evidence.
  try {
    return `non-Error thrown: ${JSON.stringify(err).slice(0, 300)}`;
  } catch {
    return `non-Error thrown: ${Object.prototype.toString.call(err)}`;
  }
}

/**
 * The sentence to put in front of a MEMBER, which is not the same thing as the
 * sentence to put in the log.
 *
 * `describeThrown` deliberately prefixes an error's `name`, because "status=546"
 * and "FunctionsFetchError" are exactly what makes a log row actionable. But a
 * member reading a toast should not be shown "Error · Please add a profile
 * photo…" — the diagnostic prefix is noise to them, and on the one path where
 * the app already knows precisely what to say it actively spoils it.
 *
 * So: a real, human-written `message` wins. Everything else falls back to the
 * diagnostic sentence, because a technical description still beats the words
 * "Unknown error".
 */
export function memberFacingMessage(err: unknown): string {
  const m = (err as { message?: unknown } | null)?.message;
  if (typeof m === "string" && m.trim() !== "") return m;
  return describeThrown(err);
}

/**
 * The same idea, one step further, for a failure the member must be able to
 * REPORT — every one of which the owner requires to carry a catalog code.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * On 2026-08-17 a member on the Android app was shown, as the whole
 * explanation of why his photograph would not publish:
 *
 *     Could not publish
 *     Cannot read properties of undefined (reading 'rest')
 *
 * Two separate failures in one toast. The obvious one: a raw JavaScript
 * exception is not a sentence anybody can act on. The quieter one, and the
 * reason it cost a day: `DRAFT-2002` WAS written to the log, but never to the
 * screen — so the member had no code to quote and the report arrived as a
 * screenshot of a stack-trace fragment.
 *
 * ── THE RULE THIS ENCODES ─────────────────────────────────────────────────
 * A message the DATABASE wrote is meant for people — our own triggers raise
 * "You are posting too quickly" and "Please add a profile photo first" — so it
 * is shown as-is. A message the JAVASCRIPT ENGINE wrote is a defect in our
 * code; the member did nothing wrong and can do nothing about it, so they get
 * a plain sentence instead. Either way the code goes on the end, so the next
 * report says "I'm getting DRAFT-2002" and the search starts where it should.
 *
 * The raw text is never lost — `logger` still records it verbatim under the
 * same code.
 */
export function memberFacingFailure(err: unknown, code: string): string {
  const raw = (err as { message?: unknown } | null)?.message;
  const msg = typeof raw === "string" ? raw.trim() : "";

  // The signatures of a programming fault, not of a refusal a member caused.
  const isOurBug =
    /cannot read propert|reading '|is not a function|is not iterable|undefined is not|null is not an object|of undefined|of null|is not defined/i.test(
      msg,
    );

  if (msg && !isOurBug) return `${msg} (${code})`;
  return `Something went wrong on our side. Nothing was lost — please try again. (${code})`;
}

/**
 * Fire-and-forget. Deliberately NOT async from the caller's point of view —
 * see rule 2 above.
 */
export function reportClientError(
  kind: ClientErrorKind,
  err: unknown,
  detail?: Record<string, unknown>,
): void {
  try {
    const message = describeThrown(err);
    if (!message) return;

    // `supabase.rpc` is typed from the generated `integrations/supabase/types.ts`,
    // which is a snapshot and does not know about a function added in a
    // migration that has not been regenerated. The cast is the narrow, honest
    // way to say that — the argument names below still have to match the SQL
    // signature exactly or the call fails at runtime.
    void (supabase.rpc as any)("log_client_error", {
        _kind: kind,
        _message: message,
        _detail: (detail ?? null) as any,
        _platform: isNativeCapacitorApp() ? "app" : "web",
        _app_build: (window as any).__APP_BUILD ?? null,
        _url: typeof location !== "undefined" ? location.pathname : null,
      })
      .then(
        () => undefined,
        () => undefined, // rule 1: a failed report is not an error
      );
  } catch {
    // rule 1, again — nothing here may reach the member.
  }
}

export default reportClientError;
