# P25 — certificate PDF: interface (PROPOSED, rev 2, 2026-10-30)

Status: **PROPOSED**. Frozen only when the Auditor accepts it; nothing in
§2–§6 is built before then. Rev 2 replaces rev 1 after an independent review
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
     allowed by RLS "Users can insert own certificates"
     (`20260224171705`, `WITH CHECK (user_id = auth.uid())`) and a live
     "Users can insert own competition certificates" variant;
  3. trigger functions `auto_certificate_on_winner` and
     `auto_certificate_on_r4_award`;
  4. member-called RPC `issue_course_completion_certificate`
     (`CourseDetail.tsx:87`).
- `certificates` is in the `supabase_realtime` publication (`20260325141234`).
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
- **Immutability beyond the key:** an R2 lifecycle/bucket-lock rule on `cert/`
  (no delete, no overwrite) is requested from the Owner (Cloudflare dashboard);
  until it exists, the code rule is "nothing in this repository deletes or
  overwrites under `cert/`", enforced by a CI grep test.

## 3 · Reference table (A-6 EXPAND) — members cannot read or write it

```sql
CREATE TABLE public.certificate_pdfs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id  uuid NOT NULL REFERENCES public.certificates(id) ON DELETE RESTRICT,
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
- `CHECK` on the key shape is enforced by the attach function (below), which
  derives it: `object_key = 'cert/' || c.user_id || '/' || c.id || '/' || sha256 || '.pdf'`.
- **`certificate_pdf_attach(_certificate uuid, _sha256 text) RETURNS text`** —
  `SECURITY DEFINER`, `search_path ''`; refuses unless the caller is admin;
  refuses a revoked certificate; derives the key; supersedes the current row if
  the hash differs (reissue), no-ops if equal; returns the key.
  `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` (M2 guard).
- **`certificate_pdf_ref(_certificate uuid) RETURNS TABLE (object_key text,
  sha256 text, owner_id uuid)`** — `SECURITY DEFINER`; returns the current
  reference **only** when the certificate's
  `user_id = auth.uid()` (or caller is admin) **and** the stored key equals the
  key re-derived from that row and the stored hash; else NULL (same answer for
  "not yours", "does not exist", "not rendered", "revoked"). Same grants.
- **`certificate_id` format:** a `CHECK (certificate_id ~ '^CERT-[0-9A-F]{10}$')`
  (NOT VALID first, validated after a PROBE shows existing rows comply), and
  the worker never puts any member-controlled text in a header.
- Contract after P-6: drop `certificates.file_url`.

## 4 · Worker authorisation contract (Pages Functions)

`GET /api/certificates/<certificate_row_id>/pdf`
1. `<certificate_row_id>` must match the UUID pattern → else 404.
2. `member(request)` → 401 `CERT-AUTH-001` without a valid session.
3. `rpc/certificate_pdf_ref` **as the member** → NULL ⇒ **404** `CERT-404`.
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
- **Member-requested (path 2), triggers (path 3), course RPC (path 4):** the
  certificate row exists without a PDF. The member sees "being prepared"; an
  admin one-click "Render pending certificates" runs the same renderer and PUT
  for every row without a current `certificate_pdfs` row (also the backfill).
  A member can **never** upload their own PDF (that would defeat L6).
- Alternative (larger): a server-side renderer in a Pages Function — needs the
  logo/QR pipeline without canvas. Owner/Auditor decision §8.1.
- UI: Certificates page downloads through GET; the browser stops rebuilding
  the PDF for members once a current PDF exists (Addendum "owner-only link
  handling").

## 6 · Lifecycle

- Revoked certificate: GET → 404 (ref returns NULL); object kept.
- Admin deletes a certificate / account deletion: `ON DELETE RESTRICT` on
  `certificate_pdfs` makes the delete paths handle it explicitly — the account
  deletion function marks the rows and the R2 objects are removed by an
  admin-run purge (the one sanctioned delete under `cert/`, logged), because
  a deleted member's certificate must not outlive their account.

## 7 · L6 (forgery resistance) and P31

- The stored PDF never changes; its SHA-256 is recorded. The public verify page
  (`verify_certificate` / `verify_certificate_by_token`) gains the fingerprint
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
4. Whether member self-insert (path 2) stays, now that its PDF waits for an admin.

## 9 · Evidence the gate will require

- D1 PROBE (both lanes): table exists, RLS on, zero grants to `anon`/
  `authenticated`, not in the realtime publication; `certificate_pdf_ref`
  returns the key to the owner and an admin and NULL to another member
  (fixture rolled back); a member-written certificate row cannot be made to
  resolve to another member's key.
- D2 cross-member test (staging and production): B → A's id = 404; anonymous =
  401; A = 200, `application/pdf`, SHA-256 = recorded; non-admin PUT = 403 with
  no object written; `cert/…` on the CDN host = 404.
- Immutability: same certificate, different bytes → a new superseding row and a
  new key; the old object's hash still equals its row.
