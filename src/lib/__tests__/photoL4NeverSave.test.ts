/**
 * CREDIT FIX U1 (Owner, 4 Nov 2026: "very big credit" on saved photos).
 *
 * MEASURED CAUSE: the files the Owner saved with the BIG credit are the v2
 * `-l4` masters (credit drawn by the first browser-canvas geometry, 50–53 px,
 * ≈56–64 % of the width). The posts were repointed to `-l5` by 20261110_0107,
 * but a client that still holds the PRE-repoint post row (device store, feed
 * archive, feed cache, offline post page) hands the `-l4` URL to the save
 * resolver, and the resolver treated the `-l4` master as the credited save
 * file (photoSetUrl(-l4, 2048) = the master; isCreditedPhotoUrl accepted it).
 * The same first geometry is on the v2 competition credited copy `-l4f-r2048`.
 *
 * RULE: a v2 credited file (`-l4` master, `-l4f-r2048`) is never a save target
 * and never shown — any `-l4`/`-l4f` URL resolves to its clean copy. Fixtures
 * are shaped like the three live keys the Owner saved (landscape 1620×1023,
 * portrait 1536×2048), with and without the `?cv=4` the web appended.
 */
import { describe, expect, it } from "vitest";
import { isCreditedPhotoUrl, isRetiredCreditedUrl, isSaveTargetCreditedUrl, photoSetCleanUrl, photoSetUrl } from "@/lib/imageLadder";
import { fullScreenPhoto, inlinePhotoUrl, saveAsPhotoUrl } from "@/lib/photoProtection";

const CDN = "https://cdn.50mmretina.com/post-images";
const LAND = `${CDN}/cc691988-0000-4000-8000-000000000001/posts/38f57857-0-w1620h1023-l4.webp`;
const PORT = `${CDN}/622dada0-0000-4000-8000-000000000002/posts/2c7e6b79-0-w1536h2048-l4.webp`;
const PORT2 = `${CDN}/622dada0-0000-4000-8000-000000000002/posts/1793685901047-9abvpfmsvri-w1536h2048-l4.webp`;
const SMALL = `${CDN}/622dada0-0000-4000-8000-000000000002/posts/s-0-w1000h700-l4.webp`;
const BARE = `${CDN}/622dada0-0000-4000-8000-000000000002/posts/b-0-l4.webp`;
const COMP = "https://cdn.50mmretina.com/competition-photos/u/competitions/c-w6000h4000-l4f.webp";
const L5 = `${CDN}/cc691988-0000-4000-8000-000000000001/posts/38f57857-0-w1080h682-l5.webp`;
const V2 = [LAND, PORT, PORT2, SMALL, BARE, COMP];
const withQuery = (u: string) => `${u}?cv=4`;
const isMaster = (u: string | null) => !!u && /-l4\.webp(?:[?#]|$)/i.test(u);
const isV2Credited = (u: string | null) => !!u && (isMaster(u) || /-l4f-r2048\.webp(?:[?#]|$)/i.test(u));

describe("U1 · a v2 (-l4 / -l4f) credited file is never a save target and never shown", () => {
  it("full screen of a stale -l4 / -l4f URL: no save target names the old master or -l4f-r2048", () => {
    for (const u of [...V2, ...V2.map(withQuery)]) {
      const fs = fullScreenPhoto(u);
      expect(isV2Credited(fs.saveAs), `${u} saveAs=${fs.saveAs}`).toBe(false);
      expect(isV2Credited(fs.shown), `${u} shown=${fs.shown}`).toBe(false);
      const saving = fullScreenPhoto(u, true);
      expect(isV2Credited(saving.saveAs), `${u} (saving) saveAs`).toBe(false);
      expect(isV2Credited(saving.shown), `${u} (saving) shown`).toBe(false);
      expect(isV2Credited(saveAsPhotoUrl(u)), `${u} feed saveAs`).toBe(false);
      for (const v2 of [true, false]) expect(isV2Credited(inlinePhotoUrl(u, v2)), `${u} inline`).toBe(false);
    }
  });

  it("a stale -l4 URL resolves to its CLEAN copy (the screen shows it; the web save gets it, not the big credit)", () => {
    expect(fullScreenPhoto(LAND)).toEqual({ shown: LAND.replace(/\.webp$/, "-r1080.webp"), saveAs: null });
    expect(fullScreenPhoto(PORT)).toEqual({ shown: PORT.replace(/\.webp$/, "-r1080.webp"), saveAs: null });
    expect(fullScreenPhoto(SMALL)).toEqual({ shown: SMALL.replace(/\.webp$/, "-thumb.webp"), saveAs: null });
    expect(fullScreenPhoto(COMP)).toEqual({ shown: COMP.replace(/\.webp$/, "-r1080.webp"), saveAs: null });
  });

  it("the URL helper never names a v2 credited file at ANY size, 2048 included", () => {
    for (const u of [...V2, ...V2.map(withQuery)]) {
      for (const s of [2048, 1080, 600, 320] as const) expect(isV2Credited(photoSetUrl(u, s)), `${u} @${s}`).toBe(false);
      expect(isV2Credited(photoSetCleanUrl(u)), `${u} clean`).toBe(false);
    }
  });

  it("classification: v2 credited files are RETIRED (still credited — never painted), only -r2048c is a save target", () => {
    for (const u of [LAND, PORT, BARE, withQuery(PORT), COMP.replace(/\.webp$/, "-r2048.webp")]) {
      expect(isRetiredCreditedUrl(u), u).toBe(true);
      expect(isCreditedPhotoUrl(u), u).toBe(true); // it carries a credit: never painted on screen
      expect(isSaveTargetCreditedUrl(u), u).toBe(false);
    }
    const cur = L5.replace(/\.webp$/, "-r2048c.webp");
    expect(isRetiredCreditedUrl(cur)).toBe(false);
    expect(isSaveTargetCreditedUrl(cur)).toBe(true);
    for (const u of [L5, LAND.replace(/\.webp$/, "-r1080.webp"), LAND.replace(/\.webp$/, "-thumb.webp")]) {
      expect(isRetiredCreditedUrl(u), u).toBe(false);
      expect(isSaveTargetCreditedUrl(u), u).toBe(false);
    }
  });

  it("the current -l5 set is unchanged: its save target is the credited -r2048c", () => {
    expect(fullScreenPhoto(L5).shown).toBe(L5);
    expect(fullScreenPhoto(L5).saveAs?.startsWith(L5.replace(/\.webp$/, "-r2048c.webp"))).toBe(true);
  });
});
