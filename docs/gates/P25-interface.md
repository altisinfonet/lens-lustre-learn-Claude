# P25 — certificate PDF: interface (PROPOSED, rev 5, 2026-10-30)

Status: **PROPOSED, rev 5**. Frozen only when the Auditor accepts it; nothing in
§2–§7 is built before then. Rev 5 makes the new control columns unwritable by
members (table-wide INSERT would otherwise let a member pre-approve their own
row). Rev 4 made every read path honour the results
hold on competition certificates (rev 3's owner-only lookup skipped it). Rev 3
fixed rev 2's deletion design (RESTRICT would have broken account deletion). Rev 2 replaced rev 1 after an independent review
found that rev 1's "column privileges revoked" cannot work under Supabase's
table-level grants and that members can write their own certificate rows —
together a cross-member read. Gate (GATE_REGISTER P25):

> one immutable PDF per certificate in R2; the database holds a private
> reference only; delivery through the S2 worker; a member cannot fetch another
> member's certificate by address; L6's forgery-resistance requirement met
> against a fixed document.

Split (Addendum Phase 6): D1 = reference table, functions, P31 coupling,
PROBEs (`docs/evidence/d1/P25/`). D2 = render-once, worker, UI, cross-member
test (`docs/evidence/d2/P25/`).

## 1 · Today (git, staging 9b4e0201)

- **Rendering:** rebuilt in the browser on every view by
  `src/lib/generateCertificatePdf.ts` (jsPDF + qrcode + canvas), from
  `src/pages/Certificates.tsx` (lazy, ~:475) and `CertificatePreviewModal.tsx`.
  Never stored.
- **`certificates` columns used here:** `file_url` (unused — "0 of 23 rows carry
  file_url", `AdminCertificates.tsx:335`), `certificate_id` (display id, filled
  by `generate_certificate_identifiers` only when NULL, **no format CHECK**),
  `verification_token`, `reference_id`, `is_revoked`. Rows ≈ 11 production,
  ≈ 3 staging (stats estimates, PROBE 0501).
- **Issue paths (all four):**
  1. admin client insert (`AdminCertificates.tsx:310`);
  2. **member self-insert** — `Certificates.tsx:259-272` inserts as the member,
     allowed by RLS — git's untyped "Users can insert own certificates"
     (`20260224171705`, `WITH CHECK (user_id = auth.uid())`) and the live,
     type-restricted "Users can insert own competition certificates";
     `authenticated` holds **table-wide INSERT** on `certificates`
     (`20261013_0001:1425`), so any column a member is not meant to set must
     be forced by a trigger;
  3. trigger function `auto_certificate_on_r4_award` (git also defines
     `auto_certificate_on_winner`; it is absent from the 2026-09-11 live
     snapshot — the D1 PROBE confirms which exist on each lane);
  4. member-called RPC `issue_course_completion_certificate`
     (`CourseDetail.tsx:87`).
- `certificates` is in the `supabase_realtime` publication (`20260325141234`).
- **Delete paths (all four):** account deletion — `delete-my-account` and
  `delete-user` call `admin_delete_auth_user`, whose `DELETE FROM auth.users`
  cascades to `certificates` (`user_id … ON DELETE CASCADE`, `20260224160300:44`);
  `hard-delete-competition` deletes certificates (:334, error unchecked); admin
  `deleteCert` in `AdminCertificates`.
- **Results hold:** the live owner SELECT policy is `user_id = auth.uid() AND
  (type NOT LIKE 'competition\_%' OR published_at IS NOT NULL)`;
  `auto_certificate_on_r4_award` inserts with `published_at NULL` until results
  are declared, and `notify_certificate_issued` gives the member the row id at
  insert time. Every PDF path must honour the same rule.
- **Member-supplied fields:** on self-insert a member may set `title`,
  `description`, and (because the generator trigger only fills NULLs) `id`,
  `certificate_id` and `verification_token`.
- **Private media:** R2 binding `MEDIA` (no public hostname of its own). It is
  **also** bound to the `cloudflare/media-authz` Worker on the CDN host, which
  serves only the `video/` and `photo/` prefixes (`handler.ts:143-145`); other
  prefixes fall through to the photos bucket, so a `cert/` key is not served
  today — §4 adds an explicit refusal anyway.
- Member-checked Pages Functions exist (`functions/api/video/_lib.ts`
  `member()` / `asMember()`). The derivatives writer
  (`functions/api/media/derivatives/put.ts`) is **head-then-put, not
  put-if-absent** (it never passes `onlyIf`).
- **"S2 worker"** is not defined in the repository. This proposal reads it as a
  Cloudflare Pages Function on our own domain, deployed from git (no Supabase
  edge-function deploy, which is blocked on the access token).

## 2 · R2 object key scheme

```
bucket : MEDIA
key    : cert/<user_id>/<certificate_row_id>/<sha256-hex-64>.pdf
```

- The key is **derived**, never trusted from stored text: every reader rebuilds
  the prefix from the certificate row and checks the hash part (§3, §4).
- Content hash in the key ⇒ a given key always holds the same bytes. Writes use
  `MEDIA.put(key, body, { onlyIf: { etagDoesNotMatch: "*" } })`; a `null`
  return (condition failed) is treated as "already present", never as success
  for different bytes (the hash in the key makes that impossible anyway).
- **Immutability beyond the key:** no code overwrites an object under `cert/`
  (content-addressed keys + put-if-absent). The **only** delete under `cert/`
  is the purge runner of §6, which deletes keys listed in the orphan table and
  nothing else; a CI grep test enforces that no other code calls `delete` on
  `cert/`. (An R2 lock rule would conflict with account deletion, so none is
  requested.)
- `onlyIf: { etagDoesNotMatch: "*" }` as put-if-absent (returning `null` when
  the object exists) is **unverified**; it is tested on staging first, with the
  `If-None-Match: *` header form as the fallback. A failure costs no integrity
  (the hash is in the key).

## 3 · Reference table (A-6 EXPAND) — members cannot read or write it

```sql
CREATE TABLE public.certificate_pdfs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id  uuid NOT NULL REFERENCES public.certificates(id) ON DELETE CASCADE,
  object_key      text NOT NULL,
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  rendered_at     timestamptz NOT NULL DEFAULT now(),
  rendered_by     uuid NOT NULL,          -- the admin
  superseded_at   timestamptz NULL,       -- reissue history
  UNIQUE (object_key)
);
CREATE UNIQUE INDEX certificate_pdfs_one_current ON public.certificate_pdfs (certificate_id) WHERE superseded_at IS NULL;
ALTER TABLE public.certificate_pdfs ENABLE ROW LEVEL SECURITY;   -- no policies
REVOKE ALL ON public.certificate_pdfs FROM PUBLIC, anon, authenticated;
```

- Not in `supabase_realtime`. No policies, no grants to API roles ⇒ no member
  path reads or writes it; the admin `FOR ALL` policy on `certificates` does not
  reach it either.
- The key shape is not a CHECK constraint; the attach function derives it: `object_key = 'cert/' || c.user_id || '/' || c.id || '/' || sha256 || '.pdf'`.
- **`certificate_pdf_orphans(object_key text PRIMARY KEY, orphaned_at timestamptz, reason text)`**
  — same closure (RLS on, no policies, no API grants). An `AFTER DELETE` trigger
  on `certificate_pdfs` and an `AFTER UPDATE … superseded_at` path record the
  key there. So **every** delete path (account deletion via the auth cascade,
  `hard-delete-competition`, admin `deleteCert`) works unchanged, in the
  database, with no edge-function deploy.
- **One visibility rule, `certificate_pdf_visible(c certificates, viewer uuid)`**
  — `owner = viewer AND NOT is_revoked AND (type NOT LIKE 'competition\_%' OR
  published_at IS NOT NULL)`, or viewer is admin. Used by `certificate_pdf_ref`. The bulk render (§5) selects rows by
  the **owner part** of the rule (not the admin bypass), and every upload still
  passes `certificate_pdf_attach_check`, which requires the hold released: a
  held certificate is neither served nor rendered before results are declared.
- **`issue_path`** on `certificates` (`text NOT NULL`, set by a **`SECURITY
  INVOKER`** `BEFORE INSERT` trigger — invoker, so `current_user` is still the
  caller's role; never accepted from the client): `member` when `current_user =
  'authenticated'` and the caller is not admin; `admin` when the caller is
  admin; `system` for every other role (the `SECURITY DEFINER` issuers —
  `auto_certificate_on_r4_award`, `issue_course_completion_certificate` — run
  as the owner). `system` is granted **only** for an explicit allow-list of
  owner roles (the migration owner); every other role, and every unknown case,
  **fails closed to `member`**. A future owner-privileged function that inserts
  member-supplied text must be reviewed before it is added to the list.
- **`render_approved_at timestamptz` / `render_approved_by uuid`** on
  `certificates`, set only by admin-only `certificate_approve_render(_id)`.
  Rendering requires `issue_path <> 'member' OR render_approved_at IS NOT NULL`.
- **Control columns are server-owned:** the same `BEFORE INSERT` trigger
  **forces `render_approved_at` and `render_approved_by` to NULL** (and sets
  `issue_path` itself), whatever the client sent. A `BEFORE UPDATE` guard
  (`SECURITY INVOKER`) refuses any change to `issue_path`,
  `render_approved_at` or `render_approved_by` unless the transaction-local
  flag set by `certificate_approve_render` is present — so neither a member
  nor the admin `FOR ALL` policy can write them directly.
  **Backfill (fail-closed):** every existing row (≈ 11 production) gets
  `issue_path = 'member'` and no approval — an admin approves each one before
  its first render.
- **Trigger privileges:** the `AFTER DELETE` (orphan) and `AFTER UPDATE`
  (supersede) triggers are `SECURITY DEFINER`, `search_path ''`, owned by the
  migration owner — an admin's edit runs as `authenticated`, which has no
  grants on the no-grant tables. Cascades already run as the referencing
  table's owner.
- **Edits:** an `AFTER UPDATE` trigger on `certificates` — any change to
  `title`, `type`, `description`, `user_id` or `is_revoked` — sets
  `superseded_at` on the current PDF row, so the next GET is 404 until an admin
  re-renders (no stale PDF is ever served). Also on `published_at` changes, so
  a hold→publish transition is visible to the bulk render.
- **`certificate_pdf_attach_check(_certificate uuid) RETURNS boolean`** —
  `SECURITY DEFINER`; true only for an admin caller, an existing non-revoked
  certificate, render approval where `issue_path = 'member'`, and the results
  hold released (`published_at` set for `competition_%`).
  Called by the worker **before** any R2 write.
- **`certificate_pdf_attach(_certificate uuid, _sha256 text) RETURNS text`** —
  `SECURITY DEFINER`, `search_path ''`; refuses unless the caller is admin;
  refuses a revoked certificate; derives the key; supersedes the current row if
  the hash differs (reissue), no-ops if equal. If the derived key already
  exists as a **superseded** row (identical bytes re-rendered), it reactivates
  that row and **removes the key from `certificate_pdf_orphans` in the same
  transaction**, so the purge can never delete a live object. Returns the key.
  `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` (M2 guard).
- **`certificate_pdf_ref(_certificate uuid) RETURNS TABLE (object_key text,
  sha256 text, owner_id uuid)`** — `SECURITY DEFINER`; returns the current
  reference **only** when the certificate's
  `user_id = auth.uid()` (or caller is admin) **and** the stored key equals the
  key re-derived from that row and the stored hash, **and**
  `certificate_pdf_visible(row, auth.uid())` holds; else nothing (same answer for
  "not yours", "does not exist", "not rendered", "revoked" — **zero rows**).
  Same grants for all three functions: `REVOKE ALL … FROM PUBLIC, anon;
  GRANT EXECUTE … TO authenticated`.
- **`certificate_id` format:** a `CHECK (certificate_id ~ '^CERT-[0-9A-F]{10}$')`
  (NOT VALID first, validated after a PROBE shows existing rows comply), and
  the worker never puts any member-controlled text in a header.
- Contract after P-6: drop `certificates.file_url`.

## 4 · Worker authorisation contract (Pages Functions)

`GET /api/certificates/<certificate_row_id>/pdf`
1. `<certificate_row_id>` must match the UUID pattern → else 404.
2. `member(request)` → 401 `CERT-AUTH-001` without a valid session.
3. `rpc/certificate_pdf_ref` **as the member** → empty ⇒ **404** `CERT-404`.
4. Re-check the returned reference independently of the database's own check:
   `object_key === \`cert/${owner_id}/${id}/${sha256}.pdf\`` (defence in depth).
5. `env.MEDIA.get(key)`; stream with `content-type: application/pdf`,
   `cache-control: private, no-store`, `vary: authorization`,
   `x-content-type-options: nosniff`,
   `content-disposition: attachment; filename="certificate.pdf"` (fixed name —
   no member-controlled text in headers).
6. Key set but object missing ⇒ 500 `CERT-OBJ-001` (logged, never re-rendered).

`PUT /api/certificates/<certificate_row_id>/pdf` (render-once write)
1. UUID check; `member(request)`.
2. **Before any R2 write**, as the caller: `rpc/certificate_pdf_attach_check(_certificate)`
   (same grants as below; admin? certificate exists, not revoked?) → 403 / 404 with **no object
   written**.
3. Body ≤ 5 MB, starts with `%PDF-`; compute SHA-256.
4. `MEDIA.put(derivedKey, bytes, onlyIf absent)`; then `rpc/certificate_pdf_attach`
   as the caller. Attach refusal after a write leaves a content-addressed
   object nobody references (recorded by a nightly orphan PROBE, not deleted).

CDN host (`cloudflare/media-authz`): add an explicit `cert/` → 404 before any
bucket lookup (defence in depth; it is never served there).

## 5 · Who renders, and when

- **Admin-issued (path 1):** the admin's browser renders with today's renderer
  and calls PUT immediately after the insert.
- **Triggers (path 3), course RPC (path 4):** the row exists without a PDF;
  the member sees "being prepared"; an admin one-click "Render pending
  certificates" renders every such row without a current PDF (also the
  backfill).
- **Member-requested (path 2):** a member-written row (`issue_path = 'member'`,
  free-text title/description) is **never** rendered by the bulk action — the
  approval columns cannot be pre-set by the member (§3); an
  admin reviews and approves it first (or the self-insert path is retired —
  decision §8.4), so a self-asserted certificate cannot become an official,
  hash-recorded document.
  A member can **never** upload their own PDF (that would defeat L6).
- Alternative (larger): a server-side renderer in a Pages Function — needs the
  logo/QR pipeline without canvas. Owner/Auditor decision §8.1.
- UI: Certificates page downloads through GET; the browser stops rebuilding
  the PDF for members once a current PDF exists (Addendum "owner-only link
  handling").

## 6 · Lifecycle

- **Revoked** (or un-revoked, or edited): the current PDF row is superseded by
  the `AFTER UPDATE` trigger; GET → 404 until an admin re-renders; the object
  is listed in `certificate_pdf_orphans`.
- **Deleted** (any of the four paths): `ON DELETE CASCADE` removes the
  reference row in the same transaction; the `AFTER DELETE` trigger records the
  key in `certificate_pdf_orphans`. Nothing in the existing delete code changes.
- **Purge:** an admin-run purge (Pages Function, admin-only, logged) reads
  keys through admin-only `SECURITY DEFINER` `certificate_pdf_orphans_due()`
  (older than 24 h **and** not referenced by any non-superseded
  `certificate_pdfs` row). **Per key**, immediately before deleting it from
  R2, it calls `certificate_pdf_orphan_claim(key)` (admin-only; atomically
  marks the key as being purged and refuses if it was reactivated meanwhile);
  `attach` refuses to reactivate a claimed key. Then
  `certificate_pdf_orphans_done(keys)`. A deleted member's certificate does not outlive
  their account by more than one purge cycle.

## 7 · L6 (forgery resistance) and P31

- The stored PDF never changes; its SHA-256 is recorded. The public verify page
  (`verify_certificate`; public access to `verify_certificate_by_token` was
  removed — `PROBE_oi3_verify_certificate_by_token_public_removed.sql`) gains the fingerprint
  (first 16 hex) and an in-browser compare of a file the visitor holds against
  the **full** hash returned for that one certificate (the hash is not secret:
  knowing it does not grant the object — delivery is owner-only and the key
  check in §4 does not rely on secrecy).
- Option B if L6 requires more: an Ed25519 signature over the stored bytes,
  public key on the verify page.
- **P31 coupling:** P31 closed `search_certificates` to non-admins (applied on
  production 2026-09-06). Extending `verify_certificate*` must keep P31's rule —
  lookup by exact certificate id / token only, no search — and land in the same
  PR as the verify-page change (GATE_REGISTER: "must land in the same change as
  P31 or the two contradict").

## 8 · Decisions needed before freezing (Owner / Auditor)

1. Where "rendered once" happens — admin browser at issue time + one-click
   pending render (proposed) vs server-side renderer.
2. What L6 requires — the text is not in the repository (hash compare vs
   signature).
3. Production `MEDIA` binding (staging verified; production UNVERIFIED) and an
   R2 retention/lock rule on `cert/` — Cloudflare dashboard.
4. Member self-insert (path 2): keep it with admin approval before rendering
   (proposed), or retire it.

## 9 · Evidence the gate will require

- D1 PROBE (both lanes): both tables exist, RLS on, zero grants to `anon`/
  `authenticated`, not in the realtime publication; a held competition
  certificate resolves to nothing for its owner; deleting a certificate
  through each delete path succeeds and leaves its key in
  `certificate_pdf_orphans`; an edit supersedes the PDF; `certificate_pdf_ref`
  returns the key to the owner and an admin and NULL to another member
  (fixture rolled back); a member-written certificate row cannot be made to
  resolve to another member's key.
- D2 cross-member test (staging and production): B → A's id = 404; anonymous =
  401; A = 200, `application/pdf`, SHA-256 = recorded; non-admin PUT = 403 with
  no object written; `cert/…` on the CDN host = 404.
- Immutability: same certificate, different bytes → a new superseding row and a
  new key; until its purge (≥ 24 h) the old object's hash still equals its row.
- **Results hold:** a held `competition_%` certificate (published_at NULL) →
  owner GET = 404 and the bulk render skips it; after publish → owner GET =
  200 once rendered. Member-written row without approval → not rendered;
  **a member inserting a row with `render_approved_at`/`render_approved_by`
  set → stored NULL, not rendered**; a member or admin UPDATE of those columns
  or of `issue_path` outside `certificate_approve_render` → refused.
