# STEP 2E — Storage & Media Pipeline (Forensic Blueprint)

> Read-only audit. No code changes. Every entry is **VERIFIED** against the listed source path or marked **NOT VERIFIED**.

---

## 1. High-Level Architecture (VERIFIED)

```
                  ┌─────────────────────────────────────┐
File picker /  →  │ 1. fileSecurityScanner.scanFile…    │
drop / paste      │    (magic bytes, size, malware)     │
                  └────────────┬────────────────────────┘
                               ▼
                  ┌─────────────────────────────────────┐
                  │ 2. imageCompression.compressImage…  │
                  │    WebP-only, q=0.92 full / 0.7 thumb│
                  └────────────┬────────────────────────┘
                               ▼ (optional, judging only)
                  ┌─────────────────────────────────────┐
                  │ 3. imageHash.computeImageHash       │
                  │    sha256 + 64-bit pHash            │
                  └────────────┬────────────────────────┘
                               ▼
                  ┌─────────────────────────────────────┐
                  │ 4. imageUpload.uploadImage*         │
                  │    path policy + upsert decision    │
                  └────────────┬────────────────────────┘
                               ▼
                  ┌─────────────────────────────────────┐
                  │ 5. storageUpload.storageUpload      │
                  │    routes S3 ↔ Supabase Storage     │
                  └─────┬───────────────────────────┬───┘
                        ▼                           ▼
              S3/R2 (presigned PUT)        Supabase Storage SDK
              via s3-presign-upload         (public/private buckets)
```

---

## 2. Buckets Inventory (VERIFIED)

Buckets referenced in source (`rg "supabase\.storage\.from\(...\)"` returns only the dynamic `bucket` arg; concrete names below extracted from bucket-prop usage and the `detect-orphan-files` allow-list):

| Bucket | Visibility | Sources of writes | Notes |
|---|---|---|---|
| `avatars` | public | `EditProfile.tsx`, `ProfileStories.tsx` | upsert (fixed slot `<uid>/avatar.webp`) |
| `post-images` | public | `WallPosts.tsx`, `JournalEditor.tsx` | unique segment per post |
| `competition-photos` | public | `CompetitionSubmit.tsx`, `admin/CompetitionsModule.tsx`, `admin/CoverImageUploader.tsx` | per-user folder, unique segment |
| `portfolio-images` | public | `MyPhotos.tsx`, `FeaturedPhotos.tsx` | per-user folder |
| `journal-images` | public | `JournalEditor.tsx` | covers + body |
| `course-images` | public | `CourseEditor.tsx`, `admin/AdminPhotoOfDay.tsx` | NOT VERIFIED for course lessons |
| `site-assets` | public | `admin/AdminBanners.tsx`, `AdminSEO.tsx`, `AdminAdvertisements.tsx`, `AdminGallery.tsx`, `AdminFeaturedArtist.tsx`, `AdminCertificates.tsx`, `AdminJudgingTags.tsx`, `AdminOnPageImages.tsx`, `EmailRichTextToolbar.tsx` | shared admin assets |
| `support-attachments` | **private** | `HelpSupport.tsx`, `admin/AdminSupportTickets.tsx` | signed-URL only |
| `national-ids` | **private** | `EditProfile.tsx` (verification) | signed-URL only |
| `email-assets` | public | listed in `detect-orphan-files` BUCKETS | NOT VERIFIED in client code |

`PRIVATE_BUCKETS` constants (must stay in sync):
- `src/lib/imageUpload.ts` → `{ "national-ids", "support-attachments" }`
- `src/lib/storageUpload.ts` → `["national-ids", "support-attachments"]`
- `supabase/functions/s3-presign-upload/index.ts` → `{ "national-ids", "support-attachments" }`
- `supabase/functions/s3-signed-url/index.ts` `ALLOWED_PREFIXES` → `["national-ids/", "support-attachments/"]`

---

## 3. Path Policy — `generateImagePath()` (VERIFIED `src/lib/imageUpload.ts`)

| `ImagePathType` | Path template | Upsert |
|---|---|---|
| `avatar` | `<uid>/avatar.<ext>` | **yes** |
| `cover` | `<uid>/cover.<ext>` | **yes** |
| `certificate-template` | `certificates/<subPath\|unique>.<ext>` | **yes** |
| `post` | `<uid>/posts/<unique>.<ext>` | no |
| `competition` | `<uid>/competitions/<unique>.<ext>` | no |
| `gallery` | `gallery/<unique>.<ext>` | no |
| `my-photo` | `<uid>/my-photos/[<sub>/]<unique>.<ext>` | no |
| `inline` | `inline/<unique>.<ext>` | no |
| `journal` | `[<sub>/\|journal/]<unique>.<ext>` | no |
| `journal-cover` / `comp-cover` | `covers/<unique>.<ext>` | no |
| `featured-artist` | `featured-artists/<unique>.<ext>` | no |
| `featured` | `featured/<uid>/<unique>.<ext>` | no |
| `course-cover` | `courses/<unique>.<ext>` | no |
| `banner` | `banners/<unique>.<ext>` | no |
| `potd` | `potd/<unique>.<ext>` | no |
| `judging-tag` | `judging-tags/<unique>.<ext>` | no |
| `ad` | `ads/<unique>.<ext>` | no |
| `seo` | `seo/<unique>.<ext>` | no |
| `support` | `<uid>/<unique>.<ext>` | no |

`uniqueSegment = ${Date.now()}-${Math.random().toString(36).slice(2)}`. `UPSERT_TYPES = { avatar, cover, certificate-template }`.

---

## 4. Upload Layer (VERIFIED)

### 4.1 `uploadImage(opts)` — `src/lib/imageUpload.ts`
- Wraps `storageUpload`. Resolves upsert via `shouldUpsert(type)` unless `upsertOverride` passed.

### 4.2 `uploadImageWithThumbnail(opts)` — `src/lib/imageUpload.ts`
- Always WebP (`ext = "webp"`).
- Generates `fullPath` via `generateImagePath`, derives `thumbPath` by replacing `.webp` → `-thumb.webp`.
- Encodes full-res via `compressImageToFiles` (q=0.92, no downscale). Falls back to original on failure.
- Encodes thumb via `compressThumbnail` (max 600 px, q=0.7). On failure, full-res URL is reused for thumb.
- **S3 path**: when `isS3Enabled() === true`, calls `uploadPairToS3(full, thumb, "<bucket>/<full>", "<bucket>/<thumb>", isPrivate)` — **single presign call for both files** (mitigation against `FunctionsFetchError`).
- **Supabase path**: parallel `Promise.all` of two `storageUpload` calls.
- For private buckets, returns the storage path in `url` (not a public URL).

### 4.3 `storageUpload(bucket, path, file, opts)` — `src/lib/storageUpload.ts`
- Cached `isS3Enabled()` (TTL 60 s).
- Routes to `uploadToS3` (S3) or `supabase.storage.from(bucket).upload(...)` (Supabase).
- Public buckets → returns `getPublicUrl().publicUrl`. Private → returns `path` only.

### 4.4 `storageRemove(bucket, paths[])`
- S3: invokes `s3-delete` edge fn with full keys (`<bucket>/<path>`). Best-effort, swallows errors.
- Supabase: `storage.from(bucket).remove(paths)`.

### 4.5 `storageList(bucket, folder, opts)`
- S3: returns `null` (no listing edge fn) — callers must hide gallery UI.
- Supabase: `.list()` with default `limit=60`.

### 4.6 `storageGetPublicUrl(bucket, path)`
- Returns path unchanged if it already starts with `http(s)://` (S3/R2 absolute URL).

### 4.7 `storageGetSignedUrl(bucket, path, expiresIn=900)`
- S3: invokes `s3-signed-url` edge fn. Default fallback TTL = 900 s, but the **edge fn hard-overrides to 300 s**.
- Supabase: `.createSignedUrl(path, expiresIn)`.

---

## 5. S3 Direct-Upload Layer (VERIFIED `src/lib/s3Upload.ts`)

| Function | Behavior |
|---|---|
| `isS3Enabled()` | RPC `is_s3_storage_enabled` (bool only — bypasses RLS-protected `s3_storage_settings`). 60 s cache. |
| `clearS3Cache()` | Manual reset after admin save. |
| `invokePresignWithRetry(body)` | Up to 2 retries on `FunctionsFetchError`/network (delays 300 ms, 800 ms). On 401/403, force one `auth.refreshSession()` + retry; on second failure → `auth.signOut()` + user-facing message. |
| `uploadToS3(file, path, fileName?, isPrivate=false)` | Calls presign → browser issues `PUT` to `uploadUrl` with `Content-Type` header. Returns `{url, key}` (url omitted for private). |
| `uploadPairToS3(full, thumb, fullPath, thumbPath, isPrivate)` | NOT VERIFIED in this audit (referenced from `imageUpload.ts`; signature inferred from call site). |

---

## 6. Image Compression (VERIFIED `src/lib/imageCompression.ts`)

| API | Purpose | Defaults |
|---|---|---|
| `compressImage(file, opts)` | Canvas → WebP blob | `maxDimension=Infinity`, `webpQuality=0.92` |
| `compressImageToFiles(file, baseName?, opts)` | Returns `{webpFile, width, height}` | passes through |
| `compressAvatar(file)` | Avatar profile | `maxDimension=400`, `q=0.85` |
| `compressThumbnail(file, baseName?)` | Grid thumb | `maxDimension=600`, `q=0.7` |
| `downloadImageAsJpeg(url, fileName?)` | Client-side WebP→JPEG via Canvas, q=0.95 | no server roundtrip |

WebP-only storage policy is enforced here (matches Core memory rule "WebP-only conversion at 100% original resolution"). JPEG only generated **on demand** in the browser.

---

## 7. Image Hashing (VERIFIED `src/lib/imageHash.ts`)

| API | Algorithm | Output |
|---|---|---|
| `computeSha256(file)` (private) | `crypto.subtle.digest("SHA-256")` of raw file bytes | 64-hex chars |
| `computePerceptualHash(file)` (private) | 32×32 luminance (Rec. 709) → 2-D DCT → 8×8 low-freq block, median compare | 16-hex chars (64 bits) |
| `computeImageHash(file)` | Runs both in parallel; pHash failures degrade to `null` | `{sha256, phash}` |

Hashes are written to `photo_meta[i].image_hash` (judging duplicate detection — see Step 2B).

---

## 8. File Security Scanner (VERIFIED `src/lib/fileSecurityScanner.ts`)

- **Magic-byte allow-list**: JPEG, PNG, WebP (offset 8 = "WEBP"), GIF, BMP, TIFF (LE+BE), HEIC (offset 4 = "ftyp"), PDF, DOCX/XLSX (PK ZIP), legacy DOC/XLS (OLE2).
- **Default `MAX_FILE_SIZE`**: 50 MB. **Pattern scan**: first 64 KB.
- **Generic dangerous patterns**: `<script`, `javascript:`, `vbscript:`, on-event handlers, `eval(`, `document.cookie/write/location`, `window.location/open`, `<iframe>/<object>/<embed>`, SVG with `on*`, `data:text/html`, base64+`<script`.
- **PDF-specific patterns**: `/JavaScript`, `/JS`, `/Launch`, `/SubmitForm`, `/ImportData`, `/OpenAction`, `/AA`, `/RichMedia`, `/EmbeddedFile`.
- **Image decode validation**: `<img>` with 5 s timeout; rejects 0-dim images.
- **`AllowedFileType`** options: `image | pdf | image+pdf | document | image+pdf+document`.
- `scanFileWithToast(file, toast, opts)` → wrapper used by all dropzones; returns `boolean`.

---

## 9. EXIF Pipeline (VERIFIED `src/lib/exifExtract.ts` / `exifFormat.ts`)

- `exifExtract.ts` (115 lines): NOT FULLY VERIFIED in this audit — confirmed it exists and is consumed by `CompetitionSubmit.tsx`. Detailed field map = NOT VERIFIED.
- `exifFormat.ts` (88 lines): NOT VERIFIED — formatting helpers only, no business logic.

---

## 10. UI Drop Zones (VERIFIED)

### `FileUploadDropZone` (`src/components/FileUploadDropZone.tsx`, 294 lines)
- Props: `bucket`, `folder`, `allowedTypes`, `maxSize`, `compressImages`, `onFileUploaded`, `showGallery`, `multiple`, `compact`, `label`.
- Pipeline per file: `scanFileWithToast` → (if image && compress) `compressImageToFiles` + `uploadImage(type:"inline")` → else raw upload via Supabase storage.
- Gallery panel: `storageList(bucket, folder, {limit:60})`. Returns `null` under S3 → panel auto-hidden.

### `InlineImageDropZone` (`src/components/InlineImageDropZone.tsx`, 104 lines)
- Lighter wrapper (no gallery). NOT VERIFIED in detail beyond its 104-line size.

---

## 11. Edge Functions Map (VERIFIED — listings under `supabase/functions/`)

| Function | Auth | Purpose |
|---|---|---|
| `s3-presign-upload` | `verify_jwt=true` (default) | Presigned PUT URL (TTL 300 s). Per-user RL: 60 / 5 min. Max 50 MB. Blocks `..`, enforces `PRIVATE_BUCKETS` for `private:true`. |
| `s3-signed-url` | `verify_jwt=true` | Presigned GET (TTL 300 s). RL: 30 / 5 min. **Allow-list**: only `national-ids/`, `support-attachments/` prefixes. Owner OR admin gate. Writes audit row to `activity_logs`. |
| `s3-delete` | NOT VERIFIED | Called by `storageRemove` (best-effort). |
| `s3-upload` | NOT VERIFIED | Legacy proxy upload (presence only). |
| `migrate-storage` | admin | NOT VERIFIED (one-shot Supabase→S3 migration). |
| `detect-orphan-files` | admin | Cross-references 7 buckets vs 25 single-URL DB columns + 4 array columns (see source for full list). |
| `purge-s3-orphans` | admin | One-shot sweep of `competition-photos/` orphans, `dry_run` default `true`. |
| `backfill-image-hashes` | admin | Batch (default 25) backfill of SHA-256 into `photo_meta[i].image_hash`. Re-invoke until `done:true`. |
| `verify-image-hash` | NOT VERIFIED in body | Verifies a single photo's stored sha256. |
| `detect-ai-image` | NOT VERIFIED in body | AI-image detection (judging). |
| `analyze-gallery-image` | NOT VERIFIED in body | Gallery analysis utility. |

---

## 12. DB Columns Tracked by `detect-orphan-files` (VERIFIED)

Single-URL columns (25): `album_photos.image_url`, `certificate_testimonials.photo_url`, `certificates.file_url`, `competitions.cover_image_url`, `courses.cover_image_url`, `featured_artists.{artist_avatar_url, cover_image_url}`, `featured_photos.image_url`, `hero_banners.image_url`, `highlight_items.image_url`, `highlights.cover_url`, `journal_articles.cover_image_url`, `judging_tags.image_url`, `lessons.image_url`, `photo_albums.cover_url`, `photo_of_the_day.image_url`, `portfolio_images.{image_url, thumbnail_url}`, `posts.image_url`, `profiles.{avatar_url, cover_url, cover_video_url, national_id_url}`, `stories.image_url`, `ticket_replies.attachment_url`.

Array columns (4): `competition_entries.photos`, `posts.image_urls`, `journal_articles.photo_gallery`, `featured_artists.photo_gallery`.

⇒ Any new image-bearing column **must** be added here, otherwise the storage-health admin tool will report false orphans.

---

## 13. Caching, Realtime & Cache Invalidation (VERIFIED)

- `s3Upload.ts`: 60 s cache for `is_s3_storage_enabled` RPC; `clearS3Cache()` exposed for admin save.
- `storageUpload.ts`: separate 60 s cache (`_s3Enabled`).
- No realtime channels are owned by the storage layer itself. Avatar/cover/post URLs propagate through their owning hooks (Step 2A/2I).

---

## 14. Loading / Empty / Error States (VERIFIED, FileUploadDropZone)

- `uploading: boolean` → spinner via lucide `Loader2`.
- `isDragOver: boolean` → drop highlight.
- Gallery: `galleryLoading`, plus `galleryFiles=[]` empty state.
- Errors surfaced through `useToast` (`scanFileWithToast`, "Compression failed, uploading original", upload failures).

---

## 15. Mobile / Role-specific Behavior

- **Mobile**: NOT VERIFIED — dropzones rely on standard `<input type="file">`; no platform branching observed in the lines audited.
- **Role-specific**: Only `s3-signed-url` enforces owner-or-admin and audit-logs the read. Public-bucket reads have **no per-user gate** by design.

---

## 16. Hook → UI / Pipeline Map

| Surface (consumer) | Direct API used | Bucket | Type/Flow |
|---|---|---|---|
| `EditProfile.tsx` | `uploadImage` (`avatar`/`cover`), `scanFileWithToast` | `avatars` | upsert; private `national-ids` for verification |
| `MyPhotos.tsx` | `uploadImageWithThumbnail` (`my-photo`) | `portfolio-images` | full + 600 px thumb |
| `WallPosts.tsx`, `JournalEditor.tsx` | `uploadImage` (`post`/`journal`) | `post-images`/`journal-images` | unique segment |
| `CompetitionSubmit.tsx` | `compressImageToFiles` + `computeImageHash` + `submit_competition_entry` RPC (Step 2B) | `competition-photos` | full-res WebP |
| `admin/CompetitionsModule.tsx`, `CoverImageUploader.tsx` | `compressImageToFiles` + `scanFileWithToast` + Supabase upload | `competition-photos` | covers |
| `admin/Admin{Banners,SEO,Advertisements,Gallery,FeaturedArtist,Certificates,JudgingTags,PhotoOfDay,OnPageImages}.tsx` | `uploadImage` various types | `site-assets` | shared assets |
| `HelpSupport.tsx`, `admin/AdminSupportTickets.tsx` | `uploadImage` (`support`) + `storageGetSignedUrl` | `support-attachments` | private |
| `ProfileStories.tsx`, `FeaturedPhotos.tsx` | `uploadImage` | `avatars`/`portfolio-images` | NOT VERIFIED type per call |
| `CourseEditor.tsx` | `uploadImage` (`course-cover`) | `course-images` | NOT VERIFIED for lesson body |

---

## 17. Component Hierarchy

```
<page or admin module>
  └─ <FileUploadDropZone | InlineImageDropZone>
       ├─ scanFileWithToast (lib/fileSecurityScanner)
       ├─ compressImageToFiles (lib/imageCompression)
       ├─ uploadImage / uploadImageWithThumbnail (lib/imageUpload)
       │    └─ storageUpload (lib/storageUpload)
       │         ├─ uploadToS3 → s3-presign-upload → PUT to R2/S3
       │         └─ supabase.storage.from(bucket).upload(...)
       └─ storageList (gallery panel)
```

---

## 18. Risks / Tech-Debt Already Documented in Code

| Risk | Source comment / behavior | Severity |
|---|---|---|
| Gallery listing unsupported under S3 | `storageList` returns `null`; UI must hide button. | medium |
| Two independent S3-enabled caches (`s3Upload.ts` + `storageUpload.ts`) can drift for ≤60 s after admin save | confirmed in source | low |
| `storageRemove` swallows S3 errors silently | "best-effort cleanup" comment | medium |
| Public buckets have no per-request authz | by design (CDN serving) | accepted |
| `s3-signed-url` allow-list must be kept in sync with `PRIVATE_BUCKETS` (4 places) | hard-coded | medium |
| `detect-orphan-files` queries are hard-coded (25+4) — new image columns silently miss it | source-only, no schema introspection | medium |
| HEIC magic-byte check matches generic `ftyp` ISO BMFF — any MP4/MOV will pass magic, but image-decode step rejects | by design | low |
| `uploadPairToS3` body / error semantics | NOT VERIFIED in this audit | n/a |
| EXIF extractor field set | NOT VERIFIED in this audit | n/a |
| Edge fns `s3-delete`, `s3-upload`, `migrate-storage`, `verify-image-hash`, `detect-ai-image`, `analyze-gallery-image` body details | NOT VERIFIED in this audit | n/a |
| `_50mm_retina_salt` etc. — auth concerns out of scope here, see Step 2D | see Step 2D | n/a |

---

## 19. Open Items for a Later Deep-Dive

- Full read of `uploadPairToS3` (request shape + error handling).
- Full read of EXIF extractor and confirmed field list written into `photo_meta`.
- Full read of `detect-ai-image`, `analyze-gallery-image`, `verify-image-hash`, `s3-delete`, `migrate-storage`.
- `course-images` lesson body usage — confirm path type.
- `email-assets` bucket — no client-side writer found; confirm if admin-only or unused.

---

**End of Step 2E.**
