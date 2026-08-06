<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: src/lib/errorCodes.ts
     Regenerate: npx tsx scripts/generate-error-codes.ts
     src/lib/__tests__/errorCatalog.test.ts fails CI if this file drifts. -->

# Error codes

Every structured log carries one of these codes. When a code is reported —
"I am getting DB-3002" — this table says which subsystem it belongs to,
what failed, and where to start looking.

Codes are permanent once shipped and are never recycled for a new meaning.

| Code | Severity | Description | Resolution |
| ---- | -------- | ----------- | ---------- |
| AUTH-1001 | WARN | An action needing a signed-in member ran with no session. | Confirm the member is signed in; if they were, check whether the session expired or the app was resumed from a cold start before auth restored. |
| AUTH-1002 | ERROR | A member without permission attempted a restricted action. | Check the member's roles in user_roles and confirm the calling code gates the control as well as the request. |
| AUTH-1003 | WARN | A banned member attempted an action that bans forbid. | Expected behaviour when the ban is correct. Confirm the ban is intentional before treating this as a bug. |
| VAL-2001 | WARN | A caption exceeded the 2200-character limit. | No action needed — the composer disables Post and highlights the excess. Investigate only if the member reports being blocked with a short caption. |
| POST-2001 | WARN | Post creation was attempted with no photograph attached. | Correct by design — a post requires a photograph (see the ruling in WallPosts.createPost). Investigate only if the member says they DID attach one, which would point at the file picker. |
| POST-2002 | ERROR | The database refused the post insert. | Read the reason field for the Postgres message. 42501 means a RESTRICTIVE policy (bans) blocked it; check user_roles and the banned state before anything else. |
| POST-2003 | ERROR | Post creation failed somewhere in the upload-to-insert pipeline. | Check the reason for a network signature (failed to fetch / FunctionsFetchError) which means the member's connection or a cold edge worker, not our logic. |
| POST-2004 | INFO | A post was created successfully. | None — success marker used to measure the pipeline's duration. |
| POST-2005 | WARN | The post was created but one or more photo tags failed to save. | The post is fine; check post_tags RLS and whether the tagged member is still a friend. |
| DB-3001 | ERROR | A database call returned an error. | Read the reason for the Postgres code and message; confirm the table and policy named there still exist. |
| DB-3002 | ERROR | A record that must exist was not found. | Confirm the id in the detail field still exists, and that the reader is allowed to see it — an RLS-filtered row is indistinguishable from a missing one. |
| DB-3003 | ERROR | A write reported success but changed zero rows. | Almost always RLS: the row exists but the policy did not match. Check the table's policies for the operation before suspecting the id. |
| API-4001 | ERROR | An edge function or outside service failed or timed out. | Check the function's logs in the Supabase dashboard for the same minute; a cold start shows as a fetch failure with no message. |
| FILE-5001 | ERROR | An image upload to storage failed. | Check the bucket's policies and the member's connection; the reason field carries the storage error verbatim. |
| FILE-5002 | WARN | A selected file was rejected as an unsupported image format. | Expected for HEIC/RAW from some phones. Investigate only if the format listed in the detail is one we claim to support. |
| FILE-5003 | INFO | An image upload completed. | None — success marker carrying the upload duration. |
| STORY-6001 | ERROR | A story delete matched zero rows. | The story was already gone, or the DELETE policy did not match. Check pg_policies for 'stories' and confirm the caller owns the row. |
| STORY-6002 | ERROR | A story delete returned a database error. | Read the reason for the Postgres message; check the stories table policies. |
| STORY-6003 | INFO | A story was deleted and removed from the screen. | None — success marker for the owner's 'delete anytime' rule. |
| UI-8001 | INFO | A member picked a name from the caption mention list. | None — used to confirm mentions are being used and converted. |
| UI-8002 | WARN | The member-search behind a mention or search box failed. | Check the profiles_public view and the member's connection; the dropdown degrades to empty rather than breaking the box. |
| SYS-9001 | ERROR | An unexpected exception reached a top-level handler. | Read fn and src_file for the origin; this code means the failure was not anticipated by the code that caught it. |
