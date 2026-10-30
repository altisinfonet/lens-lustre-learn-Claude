# P25 — certificate PDF: interface (PROPOSED, 2026-10-30)

Status: **PROPOSED** by the stages runner. Frozen only when the Auditor accepts
it; nothing in §2–§5 is built before then. Gate (GATE_REGISTER P25):

> one immutable PDF per certificate in R2; the database holds a private
> reference only; delivery through the S2 worker; a member cannot fetch another
> member's certificate by address; L6's forgery-resistance requirement met
> against a fixed document.

## 1 · Today (measured in git, staging 9b4e0201)

- The PDF is rebuilt in the browser on every view by
  `src/lib/generateCertificatePdf.ts` (jsPDF + qrcode + canvas for the logo),
  from `src/pages/Certificates.tsx` and `CertificatePreviewModal.tsx`. It is
  never stored.
- `certificates` has `file_url` (unused: "0 of 23 rows carry file_url",
  `AdminCertificates.tsx:335`), `verification_token`, `reference_id`,
  `certificate_id`. Rows: ≈ 11 production, ≈ 3 staging (stats estimates,
  PROBE 0501, 2026-10-30).
- Issue paths: admin client insert (`AdminCertificates.tsx:310`) and SQL
  auto-issue (`auto_certificate_on_r4_award`, course completion).
- Private media already exists: R2 binding `MEDIA` (no public domain, never
  routed through media-authz), Pages Functions that check the member's own JWT
  (`functions/api/video/_lib.ts` `member()` / `asMember()`), and a put-if-absent
  writer (`functions/api/media/derivatives/put.ts`).
- "S2 worker" is not defined anywhere in the repo. This proposal reads it as
  **a Cloudflare Pages Function on our own domain** (same deployment as the
  site, deployed from git — no Supabase edge-function deploy, which is
  currently blocked on the access token).

## 2 · R2 object key scheme

```
bucket : MEDIA            (private; no public hostname)
key    : cert/<user_id>/<certificate_row_id>/<sha256-hex>.pdf
```

- One object per rendered document; the SHA-256 of the bytes is in the key, so
  an object is **immutable by construction** (a re-render with different bytes
  is a different key; the writer is put-if-absent and refuses an existing key).
- A reissue (correction) creates a new object and moves the reference; the old
  object stays for audit until P-6 contract.
- The key is not a URL and grants nothing on its own: the bucket has no public
  domain.

## 3 · Reference column shape (A-6 EXPAND)

On `public.certificates` (additive; `file_url` stays until contract):

| column | type | meaning |
|---|---|---|
| `pdf_object_key` | `text NULL` | the §2 key; NULL = not rendered yet |
| `pdf_sha256` | `text NULL` | hex SHA-256 of the stored bytes (`^[0-9a-f]{64}$`) |
| `pdf_rendered_at` | `timestamptz NULL` | when the object was written |

Rules (enforced in SQL):
- `pdf_object_key` and `pdf_sha256` are set **once** per document version by an
  admin-only `SECURITY DEFINER` function `certificate_pdf_attach(_id, _key,
  _sha256)`; it refuses if the key's embedded hash ≠ `_sha256`, or if the row
  already holds a different hash (a reissue goes through an explicit
  `certificate_pdf_reissue` that keeps history).
- Members never read the key directly over PostgREST: column privileges on the
  three columns are revoked from `anon`/`authenticated`; the owner-only
  resolver below is the only read path.
- `certificate_pdf_ref(_id uuid) RETURNS text` — `SECURITY DEFINER`, returns
  the key only when `user_id = auth.uid()` or the caller is admin; otherwise
  NULL (never an error that confirms existence). `GRANT EXECUTE … TO
  authenticated` only (M2 guard).

Contract (after P-6 stable): drop `file_url`.

## 4 · Worker authorisation contract (Pages Functions)

`GET /api/certificates/<certificate_row_id>/pdf`
1. `member(request)` → 401 `CERT-AUTH-001` without a valid session.
2. `rpc/certificate_pdf_ref` **as the member** (their JWT) → NULL ⇒ **404**
   `CERT-404` (same answer for "not yours" and "does not exist").
3. `env.MEDIA.get(key)` → stream with `content-type: application/pdf`,
   `cache-control: private, no-store`, `x-content-type-options: nosniff`,
   `content-disposition: attachment; filename="certificate-<certificate_id>.pdf"`.
4. Missing object for a set key ⇒ 500 `CERT-OBJ-001` (logged; never silently
   re-rendered).

`PUT /api/certificates/<certificate_row_id>/pdf` (render-once write)
- **Admin only** (role checked server-side via the caller's JWT). A member can
  never upload their own certificate — that would defeat L6.
- Body = PDF bytes ≤ 5 MB, `%PDF-` magic checked. The function computes the
  SHA-256, writes `MEDIA.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" } })`
  (put-if-absent), then calls `certificate_pdf_attach` as the admin.

## 5 · Forgery resistance (L6) — against a fixed document

- The stored PDF never changes; its SHA-256 is in the database.
- The public verify page (`/verify-certificate`, `verify_certificate` RPC)
  additionally shows the document fingerprint (first 16 hex of `pdf_sha256`)
  and can compare a file the visitor holds (hashed **in the visitor's
  browser**; the file is not uploaded). A copy whose bytes differ from the
  issued PDF does not match.

## 6 · Evidence the gate will require

- PROBE (both lanes): columns exist; column privileges closed; resolver
  returns NULL for a non-owner and the key for the owner and an admin
  (fixture rolled back).
- Cross-member fetch (the security clause): member B, signed in, requests
  member A's certificate → **404**; anonymous → **401**; A → 200 with
  `application/pdf` and the recorded SHA-256. Run against staging and
  production by a Playwright/HTTP check in CI.
- Immutability: a second PUT for the same certificate with different bytes →
  409; the stored object's hash = `pdf_sha256`.

## 7 · Decisions needed before freezing (Owner / Auditor)

1. **"Rendered once at issue time" — where.** Proposed: the admin's browser
   renders with today's renderer and uploads through the admin-only PUT at
   issue time; SQL auto-issued certificates are rendered by a one-click admin
   backfill. A fully server-side render needs the logo/QR pipeline rewritten
   without canvas — larger, also possible with Pages Functions.
2. **What L6 requires exactly** — the requirement text is not in this
   repository. §5 is a proposal.
3. **Production `MEDIA` binding** — confirmed on staging
   (`docs/evidence/d2/VID/media-authz/staging-live-proof.md`); production is
   UNVERIFIED and may need one Cloudflare dashboard click.
