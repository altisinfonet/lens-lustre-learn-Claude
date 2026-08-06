/**
 * THE ERROR CATALOG — the single source of truth.
 *
 * OWNER DIRECTIVE, 2026-08-06:
 *
 *   "Include the code in every log … Now when someone reports 'I'm getting
 *    DB-3002' your team immediately knows which subsystem, what failed, and
 *    where to start investigating."
 *   "Maintain an Error Catalog — keep a single document such as
 *    /docs/error-codes.md."
 *
 * WHY THE CODE IS THE SOURCE AND THE MARKDOWN IS GENERATED FROM IT.
 *
 * A catalog kept in a document beside a catalog kept in code is two catalogs,
 * and within a month they disagree — the exact failure this project already
 * suffered with notification wording (see src/lib/notifications/describe.ts,
 * where the same lesson is recorded). So: this file is the truth,
 * `docs/error-codes.md` is generated from it, and
 * src/lib/__tests__/errorCatalog.test.ts FAILS CI if the two ever drift.
 *
 * RULES FOR ADDING A CODE
 *
 *  1. Format `PREFIX-NNNN`, prefix 2–6 capitals, exactly four digits. The
 *     database enforces the same shape (log_app_event) and DROPS anything
 *     else, because a code that cannot be grouped is noise that hides the
 *     codes that can.
 *  2. A code is PERMANENT once shipped. Members and the owner quote them
 *     ("I'm getting DB-3002"); re-using a number for a different meaning
 *     makes every historical row a lie. Retire, never recycle.
 *  3. `resolution` must be an instruction, not a restatement of the problem.
 *     "Verify the member's session and ask them to sign in again" is useful.
 *     "Auth failed" is not.
 *  4. Number ranges are reserved per subsystem below so two features added on
 *     the same day cannot collide.
 */

export type Severity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface ErrorCodeEntry {
  /** Stable code, e.g. "POST-2001". */
  readonly code: string;
  /** Default severity when this code is emitted. */
  readonly severity: Severity;
  /** What happened, in one sentence. */
  readonly description: string;
  /** What to DO about it — an instruction, never a restatement. */
  readonly resolution: string;
}

/**
 * Reserved ranges. Keep new codes inside the block for their subsystem.
 *
 *   AUTH-1000…1999   sign-in, session, permission
 *   VAL-2000…2999    input the member gave us
 *   POST-2000…2999   creating and editing posts (the composer)
 *   DB-3000…3999     database reads and writes
 *   API-4000…4999    edge functions and outside services
 *   FILE-5000…5999   upload, download, storage
 *   STORY-6000…6999  stories and highlights
 *   NOTIF-7000…7999  notifications and push
 *   UI-8000…8999     rendering, routing, stuck screens
 *   SYS-9000…9999    anything structural that does not fit above
 */
export const ERROR_CATALOG: readonly ErrorCodeEntry[] = [
  // ── AUTH ──────────────────────────────────────────────────────────────────
  {
    code: "AUTH-1001",
    severity: "warn",
    description: "An action needing a signed-in member ran with no session.",
    resolution:
      "Confirm the member is signed in; if they were, check whether the session expired or the app was resumed from a cold start before auth restored.",
  },
  {
    code: "AUTH-1002",
    severity: "error",
    description: "A member without permission attempted a restricted action.",
    resolution:
      "Check the member's roles in user_roles and confirm the calling code gates the control as well as the request.",
  },
  {
    code: "AUTH-1003",
    severity: "warn",
    description: "A banned member attempted an action that bans forbid.",
    resolution:
      "Expected behaviour when the ban is correct. Confirm the ban is intentional before treating this as a bug.",
  },

  // ── VAL ───────────────────────────────────────────────────────────────────
  {
    code: "VAL-2001",
    severity: "warn",
    description: "A caption exceeded the 2200-character limit.",
    resolution:
      "No action needed — the composer disables Post and highlights the excess. Investigate only if the member reports being blocked with a short caption.",
  },

  // ── POST ──────────────────────────────────────────────────────────────────
  {
    code: "POST-2001",
    severity: "warn",
    description: "Post creation was attempted with no photograph attached.",
    resolution:
      "Correct by design — a post requires a photograph (see the ruling in WallPosts.createPost). Investigate only if the member says they DID attach one, which would point at the file picker.",
  },
  {
    code: "POST-2002",
    severity: "error",
    description: "The database refused the post insert.",
    resolution:
      "Read the reason field for the Postgres message. 42501 means a RESTRICTIVE policy (bans) blocked it; check user_roles and the banned state before anything else.",
  },
  {
    code: "POST-2003",
    severity: "error",
    description: "Post creation failed somewhere in the upload-to-insert pipeline.",
    resolution:
      "Check the reason for a network signature (failed to fetch / FunctionsFetchError) which means the member's connection or a cold edge worker, not our logic.",
  },
  {
    code: "POST-2004",
    severity: "info",
    description: "A post was created successfully.",
    resolution: "None — success marker used to measure the pipeline's duration.",
  },
  {
    code: "POST-2005",
    severity: "warn",
    description: "The post was created but one or more photo tags failed to save.",
    resolution:
      "The post is fine; check post_tags RLS and whether the tagged member is still a friend.",
  },

  // ── DB ────────────────────────────────────────────────────────────────────
  {
    code: "DB-3001",
    severity: "error",
    description: "A database call returned an error.",
    resolution:
      "Read the reason for the Postgres code and message; confirm the table and policy named there still exist.",
  },
  {
    code: "DB-3002",
    severity: "error",
    description: "A record that must exist was not found.",
    resolution:
      "Confirm the id in the detail field still exists, and that the reader is allowed to see it — an RLS-filtered row is indistinguishable from a missing one.",
  },
  {
    code: "DB-3003",
    severity: "error",
    description: "A write reported success but changed zero rows.",
    resolution:
      "Almost always RLS: the row exists but the policy did not match. Check the table's policies for the operation before suspecting the id.",
  },

  // ── API ───────────────────────────────────────────────────────────────────
  {
    code: "API-4001",
    severity: "error",
    description: "An edge function or outside service failed or timed out.",
    resolution:
      "Check the function's logs in the Supabase dashboard for the same minute; a cold start shows as a fetch failure with no message.",
  },

  // ── FILE ──────────────────────────────────────────────────────────────────
  {
    code: "FILE-5001",
    severity: "error",
    description: "An image upload to storage failed.",
    resolution:
      "Check the bucket's policies and the member's connection; the reason field carries the storage error verbatim.",
  },
  {
    code: "FILE-5002",
    severity: "warn",
    description: "A selected file was rejected as an unsupported image format.",
    resolution:
      "Expected for HEIC/RAW from some phones. Investigate only if the format listed in the detail is one we claim to support.",
  },
  {
    code: "FILE-5003",
    severity: "info",
    description: "An image upload completed.",
    resolution: "None — success marker carrying the upload duration.",
  },

  // ── STORY ─────────────────────────────────────────────────────────────────
  {
    code: "STORY-6001",
    severity: "error",
    description: "A story delete matched zero rows.",
    resolution:
      "The story was already gone, or the DELETE policy did not match. Check pg_policies for 'stories' and confirm the caller owns the row.",
  },
  {
    code: "STORY-6002",
    severity: "error",
    description: "A story delete returned a database error.",
    resolution: "Read the reason for the Postgres message; check the stories table policies.",
  },
  {
    code: "STORY-6003",
    severity: "info",
    description: "A story was deleted and removed from the screen.",
    resolution: "None — success marker for the owner's 'delete anytime' rule.",
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  {
    code: "UI-8001",
    severity: "info",
    description: "A member picked a name from the caption mention list.",
    resolution: "None — used to confirm mentions are being used and converted.",
  },
  {
    code: "UI-8002",
    severity: "warn",
    description: "The member-search behind a mention or search box failed.",
    resolution:
      "Check the profiles_public view and the member's connection; the dropdown degrades to empty rather than breaking the box.",
  },

  // ── SYS ───────────────────────────────────────────────────────────────────
  {
    code: "SYS-9001",
    severity: "error",
    description: "An unexpected exception reached a top-level handler.",
    resolution:
      "Read fn and src_file for the origin; this code means the failure was not anticipated by the code that caught it.",
  },

  // SYS-9002 IS DELIBERATELY RESERVED, NOT MISSING.
  // HANDOFF_2026-08-06 §5 allocates it to "error boundary caught" for
  // src/components/AppErrorBoundary.tsx, which is still unconverted. A code is
  // permanent once shipped, so the number is held rather than reused — do not
  // fill this gap with something else.

  // ── SYS: the development network tracer ───────────────────────────────────
  //
  // EVERY ONE OF THESE IS `debug` ON PURPOSE, AND THAT IS NOT LAZINESS.
  //
  // Two reasons, both from LOGGING_STANDARD.md rule 2:
  //   1. `debug` is console-only — it is never written to client_errors. The
  //      tracer emits one line per duplicate, per slow call and per large
  //      payload; at `warn` a single developer page load would push dozens of
  //      rows into the owner's live Error Log and bury the real failures.
  //   2. `debug` is not even PRINTED in production (see PRINT_FROM_IN_PROD in
  //      logger.ts). That is the third guard behind the import.meta.env.DEV
  //      checks in main.tsx and startNetworkTrace(), so a mistake at any one
  //      call site still cannot reach a member's console.
  {
    code: "SYS-9003",
    severity: "debug",
    description: "The development network tracer began intercepting fetch().",
    resolution:
      "None — a development marker. If this appears in a production console, the import.meta.env.DEV guards in main.tsx and startNetworkTrace() have been removed; restore them.",
  },
  {
    code: "SYS-9004",
    severity: "debug",
    description: "The development network tracer finished its window and reported.",
    resolution:
      "None — read the detail for call count, unique endpoints, total payload and parallel batches. The full untruncated timeline stays on window.API_TRACE.",
  },
  {
    code: "SYS-9005",
    severity: "debug",
    description: "The same endpoint was requested more than once inside the trace window.",
    resolution:
      "Look for a hook that runs on every render, or two components fetching the same table. Check the React Query key before changing the fetch itself.",
  },
  {
    code: "SYS-9006",
    severity: "debug",
    description: "A single API call took longer than the tracer's slow threshold.",
    resolution:
      "Compare the endpoint against the same query in the Supabase dashboard; a slow RPC is a database problem, a slow table read with a small payload is usually a missing index.",
  },
  {
    code: "SYS-9007",
    severity: "debug",
    description: "A single API response was larger than the tracer's payload threshold.",
    resolution:
      "Check the select list on that query — an unbounded select('*') on a wide table is the usual cause, and it costs the member's mobile data.",
  },
] as const;

/** Fast lookup, built once. */
const BY_CODE: ReadonlyMap<string, ErrorCodeEntry> = new Map(
  ERROR_CATALOG.map((e) => [e.code, e]),
);

/** The shape the database enforces too — kept identical on purpose. */
export const CODE_PATTERN = /^[A-Z]{2,6}-\d{4}$/;

export function getErrorCode(code: string): ErrorCodeEntry | undefined {
  return BY_CODE.get(code);
}

export function isKnownErrorCode(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * Render the catalog as the markdown table kept at docs/error-codes.md.
 *
 * The document is GENERATED, never hand-edited: errorCatalog.test.ts compares
 * the file on disk to this function's output and fails if they differ, so the
 * two can never drift apart.
 */
export function renderCatalogMarkdown(): string {
  const header = [
    "<!-- GENERATED FILE — DO NOT EDIT BY HAND.",
    "     Source of truth: src/lib/errorCodes.ts",
    "     Regenerate: npx tsx scripts/generate-error-codes.ts",
    "     src/lib/__tests__/errorCatalog.test.ts fails CI if this file drifts. -->",
    "",
    "# Error codes",
    "",
    "Every structured log carries one of these codes. When a code is reported —",
    '"I am getting DB-3002" — this table says which subsystem it belongs to,',
    "what failed, and where to start looking.",
    "",
    "Codes are permanent once shipped and are never recycled for a new meaning.",
    "",
    "| Code | Severity | Description | Resolution |",
    "| ---- | -------- | ----------- | ---------- |",
  ].join("\n");

  const rows = ERROR_CATALOG.map(
    (e) =>
      `| ${e.code} | ${e.severity.toUpperCase()} | ${e.description} | ${e.resolution} |`,
  ).join("\n");

  return `${header}\n${rows}\n`;
}
