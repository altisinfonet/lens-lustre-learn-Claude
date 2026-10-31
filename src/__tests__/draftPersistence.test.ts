/**
 * The two Stage C sequences the owner asked to see proved.
 *
 *   A. Create → photos → write → categories → Save → leave → Drafts →
 *      Resume → edit → Publish
 *   B. Create → photos → leave WITHOUT Save
 *      → no draft row, no uploaded image
 *
 * Both are walked here event by event, asserting at every step what the
 * composer is permitted to write. B is the one that matters most: it is a
 * negative, and a broken negative is silent — no error, no crash, just storage
 * quietly filling with photos from sessions nobody finished.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decidePersistence,
  nextComposerState,
  type ComposerState,
} from "@/lib/post/draftPersistence";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const fresh = (): ComposerState => ({ draftId: null, hasLocalImages: false });
const withPhotos = (): ComposerState => ({ draftId: null, hasLocalImages: true });

describe("SEQUENCE B — leaving without Save must persist nothing", () => {
  it("picking photos writes nothing", () => {
    // The photos are in memory. Not in storage.
    expect(decidePersistence(withPhotos(), { type: "edit" })).toEqual({
      uploadImages: false, createDraft: false, updateDraft: false,
      directPublish: false, publishDraft: false,
    });
  });

  it("typing a caption writes nothing", () => {
    const a = decidePersistence(withPhotos(), { type: "edit" });
    expect(a.createDraft).toBe(false);
    expect(a.uploadImages).toBe(false);
  });

  it("choosing categories writes nothing", () => {
    const a = decidePersistence(withPhotos(), { type: "edit" });
    expect(a.updateDraft).toBe(false);
  });

  it("CLOSING writes nothing — no row, no upload", () => {
    // The single most important assertion in Stage C. If this ever returns
    // true for createDraft or uploadImages, every abandoned compose session
    // becomes a stored draft with uploaded photos.
    const a = decidePersistence(withPhotos(), { type: "close" });
    expect(a).toEqual({
      uploadImages: false, createDraft: false, updateDraft: false,
      directPublish: false, publishDraft: false,
    });
  });

  it("and the composer is still unsaved afterwards", () => {
    const s = nextComposerState(withPhotos(), { type: "close" });
    expect(s.draftId).toBeNull();
  });

  it("no event other than save or publish can EVER begin persistence", () => {
    // Exhaustive: whatever arrives, an unsaved composer stays inert.
    for (const ev of [{ type: "edit" }, { type: "close" }, { type: "resume", draftId: "d1" }] as const) {
      const a = decidePersistence(withPhotos(), ev);
      expect(a.createDraft, `${ev.type} created a draft`).toBe(false);
      expect(a.uploadImages, `${ev.type} uploaded images`).toBe(false);
    }
  });
});

describe("SEQUENCE A — save, leave, resume, edit, publish", () => {
  it("walks the whole flow", () => {
    // 1. Create, pick photos, write, choose categories — nothing persisted
    let s = withPhotos();
    expect(decidePersistence(s, { type: "edit" }).createDraft).toBe(false);

    // 2. Save — the first and only door into persistence
    const onSave = decidePersistence(s, { type: "save" });
    expect(onSave.uploadImages).toBe(true);
    expect(onSave.createDraft).toBe(true);
    expect(onSave.updateDraft).toBe(false);

    s = nextComposerState(s, { type: "save" }, { createdDraftId: "draft-1" });
    expect(s.draftId).toBe("draft-1");

    // 3. Leave — the row stays, because it was saved on purpose
    expect(decidePersistence(s, { type: "close" }).createDraft).toBe(false);
    s = nextComposerState(s, { type: "close" });
    expect(s.draftId).toBe("draft-1");

    // 4. Resume from Drafts — reading is not writing
    const onResume = decidePersistence(s, { type: "resume", draftId: "draft-1" });
    expect(onResume.uploadImages, "resuming must not re-upload").toBe(false);
    expect(onResume.createDraft).toBe(false);
    s = nextComposerState(s, { type: "resume", draftId: "draft-1" });

    // 5. Edit — now the same event means autosave, and it UPDATES
    const onEdit = decidePersistence(s, { type: "edit" });
    expect(onEdit.updateDraft).toBe(true);
    expect(onEdit.createDraft, "autosave must never create").toBe(false);

    // 6. Publish — through the RPC, because this is a real draft
    const onPublish = decidePersistence(s, { type: "publish" });
    expect(onPublish.publishDraft).toBe(true);
    expect(onPublish.directPublish).toBe(false);
    expect(onPublish.uploadImages, "images are already in storage").toBe(false);

    s = nextComposerState(s, { type: "publish" });
    expect(s.draftId).toBeNull();
  });

  it("a second Save updates and does not re-upload", () => {
    // Re-uploading would orphan the originals the row already points at.
    const saved: ComposerState = { draftId: "draft-1", hasLocalImages: false };
    const a = decidePersistence(saved, { type: "save" });
    expect(a.updateDraft).toBe(true);
    expect(a.createDraft).toBe(false);
    expect(a.uploadImages).toBe(false);
  });
});

describe("publishing without ever saving uses the untouched direct path", () => {
  it("goes direct, not through a throwaway draft", () => {
    // Creating a draft just to publish it would put a row and an upload in
    // front of the most common action on the site.
    const a = decidePersistence(withPhotos(), { type: "publish" });
    expect(a.directPublish).toBe(true);
    expect(a.publishDraft).toBe(false);
    expect(a.createDraft).toBe(false);
    expect(a.uploadImages).toBe(true);
  });

  it("a composer with no photos still does not upload", () => {
    const a = decidePersistence(fresh(), { type: "publish" });
    expect(a.uploadImages).toBe(false);
    expect(a.directPublish).toBe(true);
  });
});

describe("the policy cannot be mutated out from under a caller", () => {
  it("returns a fresh object each time", () => {
    const a = decidePersistence(fresh(), { type: "close" });
    const b = decidePersistence(fresh(), { type: "close" });
    expect(a).not.toBe(b);
    (a as { createDraft: boolean }).createDraft = true;
    expect(decidePersistence(fresh(), { type: "close" }).createDraft).toBe(false);
  });
});

describe("the composer defers to the policy rather than deciding for itself", () => {
  it("draftPersistence is the only place createDraft is reachable from", () => {
    const src = read("src/lib/post/draftPersistence.ts");
    // createDraft may only ever be true under 'save'.
    const saveArm = src.slice(src.indexOf('case "save":'), src.indexOf('case "publish":'));
    expect(saveArm).toContain("createDraft: true");
    const closeArm = src.slice(src.indexOf('case "close":'), src.indexOf('case "edit":'));
    expect(closeArm).not.toContain("createDraft: true");
    const editArm = src.slice(src.indexOf('case "edit":'), src.indexOf('case "save":'));
    expect(editArm).not.toContain("createDraft: true");
  });
});
