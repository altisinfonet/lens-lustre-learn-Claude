# "Failed to create post" — forensic trace, 2026-08-06

Owner: *"I do not want the symptom. I want the actual reason why the upload
fails."*

Reported symptom, from his screenshot:

```
Failed to create post
non-Error thrown: {"isTrusted":true}
```

**First failing instruction identified:** `reader.onerror = reject` at
`src/lib/fileSecurityScanner.ts:78`, reached from `createPost` →
`scanFileWithToast` → `scanFile` → `readFileBytes(file, 32)`.

**What is still unknown:** WHY the FileReader failed. That answer lives in
`reader.error` — a DOMException — and the old code threw it away. It is now
captured as `FILE-5007`.

---

## 1. The failure tree

| # | Stage | Status | Evidence |
|---|---|---|---|
| 1 | Member selects file | **✓ PASSED** | The screenshot shows **"1 photo selected"**. That state is set inside `probe.onload` (`WallPosts.tsx:247-254`) — it cannot render unless the `<img>` decode probe fired `onload`. **The browser could decode this file at selection time.** |
| 2 | **Security scan** | **✗ FAILED — first failing instruction** | Proof chain in §2. `createPost` calls `scanFileWithToast` at `WallPosts.tsx:425`, before anything else in the pipeline. |
| 3 | Compression | **? NOT REACHED** | `uploadImageWithThumbnail` is called at `WallPosts.tsx:443`, after the scan at `:425`. The scan threw first. |
| 4 | Image decode | **? NOT REACHED**, and eliminated as a cause regardless | `loadImage` (`imageCompression.ts:108`) cannot throw an Event: `tryImageElement` resolves `null` instead of rejecting, `createImageBitmap` is inside try/catch, and the final throw is `ImageDecodeError` — which has a `.name`, so `describeThrown` would have printed it. |
| 5 | Resize | **? NOT REACHED** | Inside `compressImage`, downstream of stage 4. |
| 6 | Upload to storage | **✗ NOT REACHED** | `FILE-5003 / POST_PHOTO_UPLOADED` is logged *after* each successful upload (`WallPosts.tsx:445`). Its absence for the failing correlation id is the positive check — see §4. |
| 7 | Database insert | **✗ NOT REACHED** | A refused insert logs `POST-2002 / POST_INSERT_REFUSED` with a Postgres code. Not what the member saw. |
| 8 | Success | **✗ NOT REACHED** | `POST-2004 / POST_CREATED` never fired. |

---

## 2. The proof chain — how each step is known

**Step 1 — the toast is unique.**
`"Failed to create post"` appears exactly once in the codebase:
`WallPosts.tsx:657`, inside `createPost`'s `catch`. So the failure was a THROW
out of the try block, not a handled error return.

**Step 2 — the description is `describeThrown(err)`.**
`memberFacingMessage(err)` → `describeThrown` (`reportClientError.ts:60-85`).

**Step 3 — `describeThrown` reaches `non-Error thrown:` only in one case.**
It builds `parts[]` from `err.name`, `err.message`, `err.status ?? statusCode ??
context.status`, `err.code`, and a string `err.error`. It falls through to
`non-Error thrown: ${JSON.stringify(err)}` **only when every one of those is
absent.** That single condition eliminates:

- **DOMException** — has `.name` (would print `NotReadableError · …`)
- **Supabase / PostgREST errors** — have `.message` and `.code`
- **`ImageDecodeError`** — sets `this.name = "ImageDecodeError"`
- **`FunctionsFetchError`** — has `.name`
- **Storage `{ statusCode, error }`** — has both

**Step 4 — `{"isTrusted":true}` identifies a DOM Event.**
An Event's properties (`type`, `target`, `loaded`, `total`) live on the
prototype and are not own-enumerable, so `JSON.stringify` emits only
`isTrusted`. **The thrown value was a DOM Event.**

**Step 5 — only one site inside `createPost`'s try can reject with a raw Event.**
Every `onerror = reject` in the codebase:

| Site | On the post path? |
|---|---|
| `fileSecurityScanner.ts:78` (`readFileBytes`) | **YES** — `createPost:425` → `scanFileWithToast` → `scanFile:238` |
| `fileSecurityScanner.ts:90` (`readFileText`) | **YES** — `scanFile:275` |
| `imageCompression.ts:155` (`loadImageFromUrl`) | **NO** — its only caller is `downloadImageAsJpeg:266`, a download helper |
| `ImageCropModal.tsx:69` | **NO** — cropping is opt-in and completes before Post |
| `pdfLogo.ts:19`, `generateCertificatePdf.ts:12` | **NO** — certificate rendering |

**Conclusion:** the throw came from a `FileReader` error inside the security
scanner. `readFileBytes(file, 32)` at `scanFile:238` runs first, so it is the
first failing instruction.

> **A correction worth recording.** An earlier pass in this session reported
> that `fileSecurityScanner` was *not* on the post path. That was wrong — the
> grep proving it had been truncated by `head`, so `WallPosts.tsx:425` never
> appeared in the output. Caught by reading `createPost` line by line instead of
> trusting the search. **Never conclude "not called" from a truncated grep.**

---

## 3. What was fixed, and why it is not merely "better logging"

The old line discarded the evidence:

```ts
reader.onerror = reject;   // hands over the EVENT; reader.error is lost
```

`reader.error` is a **DOMException whose `.name` is the root cause** —
`NotReadableError`, `NotFoundError`, `SecurityError`, `EncodingError`. **The one
fact that explains the failure was the one fact being thrown away.** That is why
no amount of staring at the logs could have answered this.

Now both readers reject with a real Error built by `readerFailure()`, which logs
**`FILE-5007 / FILE_UNREADABLE_FROM_DEVICE`** carrying: stage, exception name,
file name, size in bytes, MIME type, bytes requested, duration, user agent — and
a member-readable message that names the file and says to pick it again.

---

## 4. Evidence that already exists — check this before anything else

**This costs nothing and needs no new deploy.** The structured logging shipped in
`2026-08-06-1` and has been collecting since.

**Admin → Overview → Error Log:**

1. Filter code **`POST-2003`**. Every failed post is one row, with a
   `correlationId` and the total `durationMs`.
2. **Click the correlation id.** That replays the single action:
   - `POST-2004 / POST_CREATE_STARTED` — always present
   - **no `FILE-5003` row → no photo ever finished uploading** → the throw was at
     or before the scan. **This confirms or refutes the whole trace above.**
   - a `FILE-5002 / IMAGE_NO_DECODER` row → it was decode, not the scan, and this
     analysis is wrong.
3. The row's `durationMs` separates a fast local failure (a few ms — a file read)
   from a slow one (seconds — a network upload).

---

## 5. Remaining unknowns — no speculation

| # | Unknown | Evidence needed | Now captured? |
|---|---|---|---|
| 1 | **Which DOMException** the FileReader raised — this IS the root cause | `exceptionName` in `FILE-5007` | ✅ ships with the fix; needs one recurrence |
| 2 | Which file and format | `fileName`, `mimeType`, `fileSizeBytes` | ✅ same |
| 3 | App or web, and which device | `platform` + `userAgent` | ✅ same |
| 4 | One member or many | Error Log "members affected" per code | ✅ already available |
| 5 | Reproducible or one-off | `POST-2003` frequency over 24h | ✅ already available |
| 6 | **How long between choosing the photo and pressing Post** | Not recorded anywhere | ❌ **missing.** Matters only if #1 comes back `NotReadableError`/`NotFoundError`, which would point at a picker reference expiring. Do not add it before then. |
| 7 | Whether the file was picked from local storage or a cloud picker | Not knowable from the File API | ❌ **only the member can answer.** Worth asking him. |

**Not proven, and deliberately not claimed:** that the file read failed *for this
specific member*. What IS proven is that the exact string he saw can only be
produced by that reader. The DOMException name will settle it on the next
occurrence.

**Not attempted:** reproduction. The sandbox cannot open the app as a member.

---

## 6. What to ask the owner

1. **Was the photo picked from the phone's gallery, or from a cloud picker**
   (Google Photos / Drive)? A cloud pick returns a reference that must be
   re-fetched, and that is the leading explanation for a read failing *after* the
   preview already worked.
2. **Is it one member or several?** The Error Log answers this.
3. **Does it fail again immediately if he re-picks the same photo?** A clean
   retry pointing at a stale reference; a repeat pointing at the file itself.
