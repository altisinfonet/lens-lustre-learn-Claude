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
 *   CMNT-2100…2199   comments and comment moderation
 *   DB-3000…3999     database reads and writes
 *   API-4000…4999    edge functions and outside services
 *   FILE-5000…5999   upload, download, storage
 *   STORY-6000…6999  stories and highlights
 *   JUDGE-6100…6199  competition judging, scoring and the judging locks
 *   ADMIN-8100…8199  admin-only screens and tools
 *   NOTIF-7000…7999  notifications and push
 *   ADS-8200…8299    advertising slots, impressions and conversions
 *   UI-8000…8999     rendering, routing, stuck screens
 *   SYS-9000…9999    anything structural that does not fit above
 *
 * The prefix is part of the code, so CMNT-2101 and POST-2101 could never be
 * confused. The ranges exist so two features added on the same day cannot
 * collide, not because the numbers alone must be unique.
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
  {
    code: "AUTH-1005",
    severity: "error",
    description: "A signed-in member's account no longer exists; the session was ended.",
    resolution:
      "Expected immediately after an admin deletes an account — the member is signed out and told the account was removed. INVESTIGATE ONLY IF the account still exists in auth.users, which would mean the profile row was lost without the account being deleted, and a live member has just been signed out for no reason.",
  },
  {
    code: "AUTH-1004",
    severity: "error",
    description: "Sign-in through the installed app's OAuth deep link failed.",
    resolution:
      "App-only. Confirm app.fiftymmretina://auth-callback is still registered for the provider, then read the reason — a provider error_description means the provider refused, anything else means the session exchange failed on our side. The member is sent to /login rather than a dead screen.",
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

  {
    code: "POST-2006",
    severity: "error",
    description: "The automatic post announcing a new profile or cover photo failed.",
    resolution:
      "The member's photo DID change — only the announcement post failed. Read the reason for the Postgres message and check the posts table policies before telling them anything is wrong with their photo.",
  },
  {
    code: "POST-2007",
    severity: "warn",
    description: "A profile or cover photo was not added to its automatic album.",
    resolution:
      "Cosmetic and best-effort — the photo and its post are fine. Check getOrCreateAutoAlbum and the album_photos policies.",
  },

  // ── CMNT ──────────────────────────────────────────────────────────────────
  //
  // CMNT-2101 CARRIES A HARD RULE: NEVER LOG THE COMMENT TEXT.
  // Until 2026-08-06 commentModeration.ts printed `content: text` — the
  // member's actual words — straight to the console on every block. What the
  // owner needs to investigate a false positive is the LENGTH, the word that
  // matched and which matcher fired. None of that requires the sentence.
  {
    code: "CMNT-2101",
    severity: "warn",
    description: "A comment was blocked by keyword, variant or fuzzy moderation.",
    resolution:
      "The detail carries the matched word and which matcher fired, never the comment itself. A short comment blocked by 'variant' or 'fuzzy' is the likeliest false positive — check KNOWN_VARIANTS and hasFuzzyMatch in commentModeration.ts before changing PROFANITY_LIST.",
  },
  {
    code: "CMNT-2102",
    severity: "error",
    description: "The AI moderation edge function could not be reached.",
    resolution:
      "The comment was already posted — moderation runs after the fact and does not block it. Check the moderate-comment function's logs in the Supabase dashboard for the same minute; a cold start shows as a fetch failure with no message.",
  },
  {
    code: "CMNT-2103",
    severity: "debug",
    description: "The AI moderation function returned a decision.",
    resolution:
      "None — a development marker. Deliberately debug: it fires on every comment, so persisting it would bury the failures and burn the free-tier quota.",
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

  {
    code: "DB-3004",
    severity: "error",
    description: "The broadcast feed RPC failed and the feed fell back to plain chronological order.",
    resolution:
      "Members still see posts, but the fairness ordering (unseen first, fewest viewers first) is gone until this is fixed. Confirm get_broadcast_feed is still deployed and check the reason for its Postgres message.",
  },

  {
    code: "DB-3005",
    severity: "warn",
    description: "A batch lookup of member names and avatars failed, so fallback identities were rendered.",
    resolution:
      "READ THIS ONE CAREFULLY BEFORE PANICKING. When it fires, posts and comments render the generic name 'Photographer' with a letter-placeholder avatar — which is EXACTLY what a deleted account also looks like (see the Bug 1 screenshots, 2026-08-06). One is a lookup that failed; the other is a profile that is gone. Check for this code before concluding an account was deleted.",
  },
  {
    code: "DB-3006",
    severity: "warn",
    description: "Public vote tallies could not be loaded, so photographs are shown without their counts.",
    resolution:
      "The photographs still display; only the numbers are absent, which reads as 'no votes yet' rather than 'we could not count'. Blank is honest here, but confirm the tallies exist before anyone quotes a result.",
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

  {
    code: "FILE-5004",
    severity: "warn",
    description: "Image compression fell back to the original file.",
    resolution:
      "The upload SUCCEEDED — only the smaller encode did not. The member is unaffected apart from a larger download. The event says whether it was the full-res encode or the thumbnail; check the format in the detail against what the browser's encoder supports.",
  },
  {
    code: "FILE-5005",
    severity: "warn",
    description: "Deleting a file from storage failed.",
    resolution:
      "Best-effort cleanup that never blocks the member, so nothing is broken for them — but the file is now orphaned and still costs storage. Check the s3-delete function's logs and the bucket policies.",
  },
  {
    code: "FILE-5007",
    severity: "error",
    description: "The device refused to hand over a file the member had already chosen.",
    resolution:
      "Read exceptionName in the detail — it is the root cause, and until 2026-08-06 it was being thrown away. NotReadableError or NotFoundError means the file moved, was deleted, or its permission lapsed between choosing and posting (common with cloud photo pickers on Android, where the picker returns a reference that must be re-fetched). SecurityError means the origin lost permission. EncodingError means the bytes are damaged. Ask the member to re-pick the photo from local storage before changing any code.",
  },
  {
    code: "FILE-5006",
    severity: "error",
    description: "Listing a storage folder failed, so the caller received an empty list.",
    resolution:
      "This is member-visible as 'there are no photos here', which is indistinguishable from an empty folder. Check the bucket policies before believing the folder is genuinely empty.",
  },

  {
    code: "FILE-5009",
    severity: "warn",
    description: "The device refused to re-read a chosen photo, so it was rebuilt from the copy taken when it was selected.",
    resolution:
      "THE MEMBER'S POST SUCCEEDS — this is the recovery working, not a failure. It means the file handle went stale between choosing the photo and pressing Post, which was making posts fail outright from the installed app until 2026-08-06. Count these: a rising number means the underlying platform behaviour is getting worse, and the detail carries the exception that triggered it.",
  },
  {
    code: "FILE-5008",
    severity: "warn",
    description: "Camera details could not be read out of a photograph.",
    resolution:
      "The upload is unaffected — only the EXIF panel (camera, lens, aperture) will be empty. Common when a photo has been edited or exported by an app that strips metadata; this is the photographer's own file, not our pipeline.",
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

  // ── JUDGE ─────────────────────────────────────────────────────────────────
  //
  // Judging is not member-facing, but it is the least forgiving thing here: a
  // lost or wrong score changes who wins a competition, and unlike a failed
  // upload nobody notices at the time. The bias in these codes is therefore
  // towards recording enough to RECONSTRUCT a save, not just to know it failed.
  {
    code: "JUDGE-6101",
    severity: "debug",
    description: "A marker in the judging save path — started, written, or verified.",
    resolution:
      "None on its own. Follow one correlation id to replay a single save end to end. Deliberately debug: it fires on every score a judge enters, and at warn a judging session would bury every real failure in the Error Log.",
  },
  {
    code: "JUDGE-6102",
    severity: "error",
    description: "A judge's score, tag or comment could not be saved.",
    resolution:
      "Read writePath in the detail: 'edge' means the function refused, 'direct' means the table write did. Check the judge is still assigned to the competition and that the round is not already locked or completed.",
  },
  {
    code: "JUDGE-6103",
    severity: "warn",
    description: "The judging edge function failed and the direct database write was used instead.",
    resolution:
      "The save SUCCEEDED by the fallback path, so nothing is lost — but the edge function is the authoritative path and is failing. Check its logs. When the edgeAuthoritative flag is on there is NO fallback and this becomes JUDGE-6102.",
  },
  {
    code: "JUDGE-6104",
    severity: "error",
    description: "A judging value was written but could not be read back from the database.",
    resolution:
      "TREAT THIS AS DATA LOSS UNTIL PROVEN OTHERWISE. A write that reports success but cannot be read back is almost always RLS — the row exists but the policy does not match the reader. Check the judging table policies before suspecting the id.",
  },
  {
    code: "JUDGE-6105",
    severity: "error",
    description: "A judging database function returned an error.",
    resolution:
      "The event names which one. The judge's screen will show empty or stale data with no explanation, so they may keep working from a wrong picture — check the function is deployed before assuming the round is genuinely empty.",
  },
  {
    code: "JUDGE-6106",
    severity: "warn",
    description: "The judging lock could not be acquired.",
    resolution:
      "Usually correct behaviour — another judge holds the round. Investigate only if the same judge is blocked repeatedly, which would mean a stale lock rather than a busy one.",
  },
  {
    code: "JUDGE-6107",
    severity: "debug",
    description: "A development-only judging consistency probe reported a mismatch.",
    resolution:
      "Development only — decisionParityProbe and useUnjudgedDriftMonitor both return early outside DEV, so this can never reach a production console. It flags UI and database disagreeing about judging state; investigate at the source, not here.",
  },

  // ── NOTIF ─────────────────────────────────────────────────────────────────
  {
    code: "NOTIF-7001",
    severity: "error",
    description: "Push notification setup failed inside the installed app.",
    resolution:
      "App-only. The member will silently receive no pushes — nothing tells them. Check the permission result and whether the device registered a token in push_tokens for this member.",
  },

  // ── ADS ───────────────────────────────────────────────────────────────────
  //
  // Both are `debug` and must stay that way. Ad events fire on ordinary
  // scrolling — at warn, one member browsing the feed would write more rows in a
  // minute than every real failure writes in a week.
  {
    code: "ADS-8201",
    severity: "debug",
    description: "A duplicate advertising event was suppressed by the deduplication window.",
    resolution:
      "None — this is the guard working. It exists so an advertiser is never billed twice for one member action.",
  },
  {
    code: "ADS-8202",
    severity: "debug",
    description: "An advertising click or conversion was recorded once.",
    resolution: "None — a development marker confirming the once-only guard let exactly one event through.",
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

  {
    code: "UI-8003",
    severity: "warn",
    description: "The global search box failed to return results.",
    resolution:
      "The box shows an empty result set, which reads to the member as 'nothing found' rather than 'it broke'. Check the member's connection and the search RPCs before assuming the query was genuinely empty.",
  },
  {
    code: "UI-8004",
    severity: "warn",
    description: "A section of the logged-out home page failed to load.",
    resolution:
      "The page still renders; the failed section is simply absent, which a visitor cannot tell from 'there is nothing here yet'. The event names which section. This is the first thing a new visitor sees — treat repeated hits as urgent.",
  },

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  //
  // Only the owner and admins ever see these screens, so nothing here is a
  // member incident. They are still worth codes: an admin tool that fails
  // quietly is how a wrong number reaches a decision.
  {
    code: "ADMIN-8101",
    severity: "warn",
    description: "An admin health check could not reach one of its subsystems.",
    resolution:
      "The Health screen shows that subsystem as disconnected. Confirm from a second source before acting — a failed CHECK is not the same as a failed SERVICE, and treating it as an outage is how a healthy system gets 'fixed'.",
  },
  {
    code: "ADMIN-8102",
    severity: "error",
    description: "An upload from an admin screen failed.",
    resolution:
      "The event names the screen (gallery, photo of the day, banners). Check the bucket policies and the file's format; FILE-5002 in the same correlation window means the browser could not decode it.",
  },
  {
    code: "ADMIN-8103",
    severity: "error",
    description: "An admin change could not be saved.",
    resolution:
      "The admin's screen may still show the change even though it was not stored. The event names what failed — navigation sync or managed-page creation. Confirm the current stored state before retrying.",
  },
  {
    code: "ADMIN-8107",
    severity: "debug",
    description: "The admin member list loaded on mount, which is what keeps its live updates alive.",
    resolution:
      "None. It exists because the list previously loaded ONLY on a click, which left the realtime handler's query ref null and made it discard every live update until the page was reloaded. If this stops firing, live updates die silently again.",
  },
  {
    code: "ADMIN-8105",
    severity: "warn",
    description: "An admin action was performed but could not be written to the audit log.",
    resolution:
      "THE ACTION STILL HAPPENED — only the record of it failed, so the audit trail now has a hole. Note what was done manually and check the activity_logs policies.",
  },
  {
    code: "ADMIN-8106",
    severity: "error",
    description: "An admin action threw part-way through.",
    resolution:
      "The action may be half-applied. Confirm the current stored state before retrying — a blind retry can double-apply whatever did succeed.",
  },
  {
    code: "ADMIN-8104",
    severity: "warn",
    description: "An admin diagnostic or audit tool could not complete its run.",
    resolution:
      "The tool shows an empty or partial result, which reads as 'nothing wrong found'. It is not the same as a clean run — re-run before trusting the output.",
  },

  {
    code: "UI-8005",
    severity: "warn",
    description: "A component crashed but was contained, so only that block is missing.",
    resolution:
      "Narrower than SYS-9002: the page still works and the member may not notice anything beyond a missing name or badge. Read the reason for which child threw.",
  },
  {
    code: "UI-8006",
    severity: "info",
    description: "A member reached a route that does not exist.",
    resolution:
      "Deliberately info, so it is never persisted — crawlers and bots hit 404s constantly and would flood the log. Check the path in the detail against the navigation if a member reports a dead link.",
  },

  // ── SYS ───────────────────────────────────────────────────────────────────
  {
    code: "SYS-9001",
    severity: "error",
    description: "An unexpected exception reached a top-level handler.",
    resolution:
      "Read fn and src_file for the origin; this code means the failure was not anticipated by the code that caught it.",
  },

  // SYS-9002 was held empty from earlier on 2026-08-06 for exactly this, and is
  // now filled by AppErrorBoundary. It is FATAL rather than ERROR on purpose:
  // every other code here means something failed while the member kept using
  // the site. This one means the member is looking at a dead screen. It is the
  // 30-day blank-page report (BLANK_PAGE_ROOT_CAUSE.md) finally getting a code,
  // and it must never be filtered out as ordinary noise.
  {
    code: "SYS-9002",
    severity: "fatal",
    description: "A route crashed and the last-resort error boundary caught it — the member sees a dead screen.",
    resolution:
      "Read the component stack in the detail: its first frames name the route that died. Check BLANK_PAGE_ROOT_CAUSE.md first — a missing /assets/* chunk returns 200 text/html and is cached immutable for a year, which produces exactly this. Get the PAGE NAME from the member if you can.",
  },

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

  {
    code: "SYS-9011",
    severity: "warn",
    description: "Site settings could not be loaded, so built-in defaults are in use.",
    resolution:
      "THIS CHANGES WHAT MEMBERS SEE without anything on screen saying so — a setting an admin turned off may be back on. Confirm the site_settings read is working before investigating any 'setting did not save' report.",
  },

  // ── SYS: the installed app's update flow ──────────────────────────────────
  {
    code: "SYS-9008",
    severity: "warn",
    description: "The installed app could not check whether an update is available.",
    resolution:
      "App-only, and harmless on its own — the member simply is not offered the update. Persistent hits mean members are stranded on an old build, which is how a fixed bug keeps getting reported.",
  },
  {
    code: "SYS-9009",
    severity: "warn",
    description: "The in-app update flow failed, so the member was sent to the store listing instead.",
    resolution:
      "App-only. The member can still update, just with more steps. Check the Play in-app-update plugin before treating this as urgent.",
  },
  {
    code: "SYS-9010",
    severity: "error",
    description: "The app could not open the store listing, so the member has no way to update.",
    resolution:
      "App-only, and this is the end of the line — both the in-app flow and the store fallback failed, so the member is stuck on their current build with nothing telling them so.",
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
