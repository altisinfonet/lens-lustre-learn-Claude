# Open work — 2026-08-05, end of session

## 1. DOWNLOADS DO NOT WORK IN THE APP — FIXED AND ON MAIN

**Owner report:** *"Any images clcked to downalod, not dowandling only in App,
any journal and featured artist any article PDF showing downlaiding but not
dwonalding as PDF docuemnt in mobile"*

### Root cause (confirmed in code, not guessed)

Both symptoms are **one cause**. Every save path ended in:

```js
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.download = fileName;
a.click();
```

- photos → `downloadImageAsJpeg` in `src/lib/imageCompression.ts`
- article PDFs → jsPDF's own `save()` (verified inside `node_modules/jspdf`:
  it builds an `<a>`, sets `download`, dispatches a MouseEvent click)

A browser hands that to its download manager. **An Android WebView has no
download manager.** It forwards downloads to a `DownloadListener`, and this app
registers none — the Android project is generated fresh by `npx cap add android`
in CI with no custom MainActivity. The click is discarded in complete silence.

That is also why the PDF *"shows downloading but does not download"*: fetching
every photo and rendering every page SUCCEEDS, so the spinner completes. Only
the final save is dropped.

### The fix (owner chose the plugin route)

`src/lib/saveFile.ts` — one `saveBlob(blob, fileName)`:

- **Web/PWA** — unchanged anchor download.
- **App** — `Filesystem.writeFile` to **CACHE**, then the existing `Share`
  plugin offers it to the system sheet.

**Why CACHE and not DOCUMENTS:** the plugin's own docs say Documents is
app-private on Android 11+, so the file would "save" and be unfindable in Files
and Gallery — worse than the bug, because it looks fixed.

**Why it never imports `@capacitor/*`:** those packages exist only in the
Android CI job, never in the Cloudflare web deploy. A static import would break
the WEBSITE's build. Reached through `window.Capacitor` runtime globals — same
standing rule as `src/lib/native/authDeepLink.ts`.

### STATE — all four files are on main

| File | Commit |
|---|---|
| `src/lib/saveFile.ts` | `9822c65` |
| `src/lib/imageCompression.ts` | `915cadb` |
| `src/lib/generateArticlePdf.ts` | `013ed29` |
| `src/lib/__tests__/saveFile.test.ts` (8 tests) | `71ec353` |

Verified after merge: working tree clean, typecheck OK, 32 tests green across
the four pinned suites, web build OK. Three of the eight tests were checked red
against the broken code first.

### ⚠ ONE LINE IS STILL HELD BACK — DO NOT FORGET IT

The app half needs `@capacitor/filesystem` added to the plugin install step in
`.github/workflows/android-build.yml`:

```
            @capacitor/share @capacitor/splash-screen \
            @capacitor/filesystem \
```

**That file is one of the two build triggers** (`on.push.paths`), so merging it
starts an Android build immediately. The owner's standing rule is that builds
are cut only when he asks — so this one-line change goes in **with** the build
he asks for.

If a build is ever cut without it, `saveBlob` correctly refuses in the app with
*"This version of the app can't save files yet. Please update the app."* — the
fix would be present but inert. **Do not cut a build without that line.**

### This fix cannot be seen on the website

The website's downloads were never broken. This is an APP-ONLY improvement and
reaches nobody until build 1052 is on Play.

---

## 2. EMOJI IN COMMENTS — requested, NOT STARTED

**Owner, 2026-08-05, verbatim requirement:**

> Users should be able to add emojis anywhere in their comments, including after
> the comment text. I specifically asked you to support emoji parsing, including
> manual emoji shortcuts. For example:
> `I love this ❤️` · `I love this <3` → ❤️ · `:)` → 😊 · `:(` → ☹️ · `;)` → 😉
> Right now, this is not implemented. If I type `<3`, it remains plain text.
>
> Please implement a proper emoji parsing system that:
> 1. Converts common text shortcuts (`<3`, `:)`, `:(`, `;)`, etc.) into emojis.
> 2. Allows users to insert standard Unicode emojis from their keyboard.
> 3. Works anywhere in the comment (beginning, middle, or end).
> 4. Stores and displays emojis correctly across all devices without breaking
>    formatting.
>
> **"Please fix this completely rather than applying a temporary workaround."**

### Notes for whoever picks this up

- He said *"I specifically asked you to support emoji parsing"* — treat this as
  a re-statement of an earlier order, not a new idea.
- Point 4 is the one that will bite. This codebase has a **text-encoding
  corruption history** — see `claude/TEXT_ENCODING_CORRUPTION.md`, where a
  property-based sweep found **74** mojibake strings (a hand-written signature
  list had found only 41, missing every 4-byte emoji). Emoji are exactly the
  4-byte characters that broke before. Any storage/display path must be checked
  against real rows, not assumed.
- Do not build it only in one composer. Comments exist in more than one place —
  enumerate every comment input first (Rule A in
  `claude/RULE_NEVER_BREAK_WHAT_WORKS.md`).
- Shortcut replacement must not fire inside a URL or mid-word
  (`http://x` contains `:` + `/`; `8)` inside `(see 8)` is not a smiley the
  member meant). Decide the boundary rules deliberately and write them down.
- Decide and record: does the shortcut convert **as the member types**, or on
  save? Converting on save means what they typed is not what they see — decide
  once, and make the composer and the stored row agree.

---

## 3. A BROWSER-EDITOR TECHNIQUE THAT ACTUALLY WORKS (hard-won today)

`git push` is blocked in this environment; the GitHub web editor is the only
write path, and its CodeMirror editor intermittently ignores synthetic
keystrokes. What works reliably:

1. **New file** → `/new/main`, paste content via a synthetic `paste`
   `ClipboardEvent` on `.cm-content`, then set the filename by calling the
   native `HTMLInputElement.value` setter + dispatching `input` (typing into it
   is unreliable, and a `/` in the name can trigger GitHub's global search).
2. **Editing an existing file** → scroll the target line into view
   (`scroller.scrollTop` + dispatch a `scroll` event), then **click directly on
   that line with a real mouse click** so CodeMirror's own cursor moves there,
   then build a DOM `Range` over the `.cm-line` elements and dispatch the paste.
3. **The click is load-bearing.** Setting a DOM Range without a preceding real
   click pastes at CodeMirror's *previous* cursor position — it once inserted an
   import at the top of a 1000-line file. Always screenshot before committing;
   `Cancel changes` discards a bad edit safely.
4. **Always end a replacement with `\n`** when the Range covers whole lines, or
   the following line joins onto the last one.
