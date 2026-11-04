import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backfillMasterKey, backfillSlotKey, backfillSlots, isBackfillSource, BACKFILL_SLOTS,
} from "../photoSetBackfill";
import { fitInside } from "@/lib/photoSetEncode";
import { photoSetSiblingKeys, photoSetUrl, photoSetMarker } from "@/lib/imageLadder";

const O = "11111111-1111-4111-8111-111111111111";

describe("U5 backfill keys — the -l4 set written BESIDE an old photo", () => {
  it("accepts only an old post photo in a member's post-images folder", () => {
    expect(isBackfillSource(`post-images/${O}/posts/1793596625316-1tjg4vg9wsa-w2170h1479-l3.webp`)).toBe(true);
    expect(isBackfillSource(`post-images/${O}/posts/e4c924d9-0-w1080h719.webp`)).toBe(true);
    expect(isBackfillSource(`post-images/${O}/1775573669531_0.webp`)).toBe(true);
    // never a v2 photo (already a set), never a derivative folder, never another bucket, never a path trick
    expect(isBackfillSource(`post-images/${O}/posts/a-w2048h1365-l4.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/posts/a-w4000h3000-l4f.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/posts/a-w2048h1365-l4-thumb.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/d/${O}/w600.webp`)).toBe(false);
    expect(isBackfillSource(`avatars/${O}/avatar.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/../x.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/not-a-uuid/posts/a.webp`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/posts/a.jpg`)).toBe(false);
    expect(isBackfillSource(`post-images/${O}/posts/a-thumb.webp`)).toBe(false);
  });

  it("keeps the WHOLE old name as the stem, so two old photos can never share a new key", () => {
    const a = backfillMasterKey(`post-images/${O}/posts/x-w1080h719.webp`, 1080, 719);
    const b = backfillMasterKey(`post-images/${O}/posts/x.webp`, 1080, 719);
    expect(a).toBe(`post-images/${O}/posts/x-w1080h719-w1080h719-l4.webp`);
    expect(b).toBe(`post-images/${O}/posts/x-w1080h719-l4.webp`);
    expect(a).not.toBe(b);
  });

  it("the new name is a v2 name the display code reads (marker, siblings; 2048 = the clean 1080 since credit fix U1)", () => {
    const k = backfillMasterKey(`post-images/${O}/posts/1793596625316-1tjg4vg9wsa-w2170h1479-l3.webp`, 2048, 1396);
    expect(k).toBe(`post-images/${O}/posts/1793596625316-1tjg4vg9wsa-w2170h1479-l3-w2048h1396-l4.webp`);
    expect(photoSetMarker(k)).toBe("-l4");
    expect(photoSetUrl(k, 2048)).toBe(backfillSlotKey(k, "r1080"));
    expect(photoSetUrl(k, 1080)).toBe(backfillSlotKey(k, "r1080"));
    expect(photoSetUrl(k, 600)).toBe(backfillSlotKey(k, "thumb"));
    expect(photoSetUrl(k, 320)).toBe(backfillSlotKey(k, "r320"));
    // the orphan scan derives exactly the siblings the backfill writes (thumb is in thumbnail_urls)
    expect(photoSetSiblingKeys(k).sort()).toEqual([backfillSlotKey(k, "r1080"), backfillSlotKey(k, "r320")].sort());
  });

  it("plans the copies like the uploader: no upscaling, 1080 only above 1080, 320 only above 320", () => {
    const big = backfillSlots(2170, 1479);
    expect(big.map((s) => s.slot)).toEqual(["master", "r1080", "thumb", "r320"]);
    expect(big[0]).toMatchObject({ width: 2048, height: 1396, credit: true });
    expect(big.find((s) => s.slot === "r1080")).toMatchObject({ width: 1080, height: 736, credit: false });
    expect(big.find((s) => s.slot === "thumb")).toMatchObject({ width: 600, height: 409 });
    expect(big.find((s) => s.slot === "r320")).toMatchObject({ width: 320, height: 218 });
    for (const s of big) expect({ width: s.width, height: s.height }).toEqual(fitInside(2170, 1479, s.maxDimension));

    expect(backfillSlots(1080, 719).map((s) => s.slot)).toEqual(["master", "thumb", "r320"]);
    expect(backfillSlots(1080, 719)[0]).toMatchObject({ width: 1080, height: 719 });
    expect(backfillSlots(300, 200).map((s) => s.slot)).toEqual(["master", "thumb"]);
    expect(backfillSlots(300, 200).find((s) => s.slot === "thumb")).toMatchObject({ width: 300, height: 200 });
    expect(backfillSlots(0, 10)).toEqual([]);
  });

  it("the orphan scan counts a recorded set as referenced before the swap (tolerating a lane without the table)", () => {
    const src = readFileSync(join(process.cwd(), "supabase/functions/detect-orphan-files/index.ts"), "utf8");
    const snap = src.slice(src.indexOf("const SNAPSHOT_COLUMNS"), src.indexOf("];", src.indexOf("const SNAPSHOT_COLUMNS")));
    expect(snap).toMatch(/\{ table: "photo_set_backfill", columns: \["new_url", "new_thumb"\] \}/);
    // after the swap the old photo is what the swap rollback restores: referenced while the swap record exists
    expect(snap).toMatch(/\{ table: "photo_set_swap", columns: \["old_image_urls", "old_thumbnail_urls", "old_image_url", "old_thumbnail_url"\] \}/);
  });

  it("slot keys use the uploader's spelling and nothing else", () => {
    const k = `post-images/${O}/posts/x-w2048h1365-l4.webp`;
    expect(BACKFILL_SLOTS).toEqual(["master", "r1080", "thumb", "r320"]);
    expect(backfillSlotKey(k, "master")).toBe(k);
    expect(backfillSlotKey(k, "thumb")).toBe(`post-images/${O}/posts/x-w2048h1365-l4-thumb.webp`);
    expect(backfillSlotKey(k, "r1080")).toBe(`post-images/${O}/posts/x-w2048h1365-l4-r1080.webp`);
    expect(backfillSlotKey(k, "r320")).toBe(`post-images/${O}/posts/x-w2048h1365-l4-r320.webp`);
  });
});
