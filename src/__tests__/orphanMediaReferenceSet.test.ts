/**
 * THE ORPHAN REFERENCE SET MUST SEE **BOTH** REPRESENTATIONS OF MEDIA OWNERSHIP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Until Phase 2 there was one: `posts.image_urls`. There are now two:
 *
 *     posts.image_urls                                    (legacy, still live)
 *     post_media -> media_objects.derivatives -> storage  (the media engine)
 *
 * `detect-orphan-files` reports every stored object the database does not name.
 * A key the scan cannot see is a file proposed for deletion out of live
 * content. So the asymmetry is the whole design:
 *
 *     FALSE ORPHAN     — a live file omitted   — CATASTROPHIC, no undo
 *     FALSE NON-ORPHAN — a dead file retained  — merely wasteful
 *
 * Every assertion below is one of those files.
 *
 * WHY THIS FILE CALLS THE CODE INSTEAD OF GREPPING IT. `orphanReferenceSet.test.ts`
 * asserts on the SOURCE of detect-orphan-files, which is the right tool for
 * "is the list wired in" and the wrong tool for "does the classifier get the
 * answer right". The reference rules therefore live in a plain module,
 * `supabase/functions/_shared/referenceSet.ts`, that this file imports and
 * executes. Where a regex is still the honest instrument — proving the edge
 * function consumes the module rather than declaring it — the regexes are kept,
 * at the bottom, and labelled.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractPath,
  mediaReferenceKeys,
  originalKeyFor,
  type MediaRow,
} from "../../supabase/functions/_shared/referenceSet";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FN = "supabase/functions/detect-orphan-files/index.ts";
const fnSource = strip(read(FN));

const OWNER = "00af64a6-399d-4399-a5a4-5234554bc6c6";
const MEDIA = "11111111-2222-3333-4444-555555555555";
const CDN = "https://cdn.50mmretina.com";

/** A media_objects row, with the shape the scan selects. */
const row = (over: Partial<MediaRow> = {}): MediaRow => ({
  id: MEDIA,
  owner_id: OWNER,
  mime: "image/webp",
  state: "ready",
  derivatives: { original: `post-images/${OWNER}/posts/photo.webp` },
  ...over,
});

/**
 * The classifier, assembled exactly as detect-orphan-files assembles it:
 * url-column keys, then media-graph keys, then the derived `-l3` rung
 * addresses over the union. The rung derivation mirrors the three lines in
 * index.ts, which imageLadder.test.ts independently pins to that file.
 */
function buildReferenceSet(opts: {
  urlColumnValues?: string[];
  mediaRows?: MediaRow[];
}): { set: Set<string>; unresolved: { media_id: string; value: string }[]; derived: number } {
  const set = new Set<string>();
  for (const v of opts.urlColumnValues ?? []) {
    const p = extractPath(v);
    if (p) set.add(p);
  }
  const media = mediaReferenceKeys(opts.mediaRows ?? []);
  for (const k of media.keys) set.add(k);
  for (const key of [...set]) {
    const m = key.match(/^(.*)-l3(\.[a-z0-9]+)$/i);
    if (m) {
      set.add(`${m[1]}-l3-r1080${m[2]}`);
      set.add(`${m[1]}-l3-r1440${m[2]}`);
    }
  }
  return { set, unresolved: media.unresolved, derived: media.derived_in_flight };
}

/** What the scan would decide about a stored object. */
const isOrphan = (set: Set<string>, storeKey: string) => !set.has(storeKey);

describe("the twelve orphan-model states", () => {
  it("S1 legacy: a file named only by posts.image_urls is NOT an orphan", () => {
    const key = `post-images/${OWNER}/posts/legacy.webp`;
    const { set } = buildReferenceSet({ urlColumnValues: [`${CDN}/${key}`] });
    expect(isOrphan(set, key)).toBe(false);
  });

  it("S2 migrated: named by BOTH image_urls and derivatives — still NOT an orphan", () => {
    const key = `post-images/${OWNER}/posts/photo.webp`;
    const { set } = buildReferenceSet({
      urlColumnValues: [`${CDN}/${key}`],
      mediaRows: [row({ derivatives: { original: key } })],
    });
    expect(isOrphan(set, key)).toBe(false);
  });

  /**
   * THE ONE THIS WHOLE CYCLE EXISTS FOR. `post_publish_with_media`
   * (20260815041256) inserts posts with `image_urls = '{}'`, so a post
   * published through the new write path names its photographs NOWHERE except
   * post_media -> media_objects. Before this change the scan could not see
   * them, and every one of them was a deletion candidate at 30 days.
   */
  it("S3 media-only: a file named ONLY by media_objects.derivatives is NOT an orphan", () => {
    const key = `post-images/${OWNER}/posts/media-only.webp`;
    const legacyOnly = buildReferenceSet({ urlColumnValues: [] });
    expect(
      isOrphan(legacyOnly.set, key),
      "control: with no reference at all this key must read as an orphan, " +
        "otherwise the assertion below proves nothing",
    ).toBe(true);

    const { set } = buildReferenceSet({ mediaRows: [row({ derivatives: { original: key } })] });
    expect(
      isOrphan(set, key),
      "a photograph on a post published through post_publish_with_media would " +
        "be proposed for deletion.",
    ).toBe(false);
  });

  it("S4 new upload key shape (…/media/<id>/original.webp) is NOT an orphan", () => {
    const key = originalKeyFor(OWNER, MEDIA, "image/webp");
    expect(key).toBe(`post-images/${OWNER}/media/${MEDIA}/original.webp`);
    const { set } = buildReferenceSet({ mediaRows: [row({ derivatives: { original: key } })] });
    expect(isOrphan(set, key)).toBe(false);
  });

  it("S5 non-`original` derivative rungs (1440/1080/600) are NOT orphans", () => {
    const base = `post-images/${OWNER}/media/${MEDIA}`;
    const derivatives = {
      original: `${base}/original.webp`,
      "1440": `${base}/1440.webp`,
      "1080": `${base}/1080.webp`,
      "600": `${base}/600.webp`,
    };
    const { set } = buildReferenceSet({ mediaRows: [row({ derivatives })] });
    for (const k of Object.values(derivatives)) {
      expect(
        isOrphan(set, k),
        `${k} is a rung media_mark_ready accepts. Reading only 'original' ` +
          `deletes every derivative the worker writes.`,
      ).toBe(false);
    }
  });

  it("S6 in-flight upload (pending/verified, empty derivatives) — the key is DERIVED, not lost", () => {
    for (const state of ["pending", "verified"]) {
      const r = row({ state, derivatives: {} });
      const { set, derived } = buildReferenceSet({ mediaRows: [r] });
      expect(derived, `${state}: the derivation did not run`).toBe(1);
      expect(
        isOrphan(set, originalKeyFor(OWNER, MEDIA, "image/webp")),
        `${state}: bytes already uploaded, and no column names them yet.`,
      ).toBe(false);
    }
  });

  it("S7 quarantined media is NOT an orphan, even with zero post_media rows", () => {
    // media_quarantine (20260814234206) DETACHES live references in the same
    // transaction, so zero references is the DESIGNED end state of a quarantine.
    const key = `post-images/${OWNER}/posts/quarantined.webp`;
    const { set } = buildReferenceSet({
      mediaRows: [row({ state: "quarantined", derivatives: { original: key } })],
    });
    expect(
      isOrphan(set, key),
      "state is an integrity verdict, not a liveness verdict — deleting here " +
        "destroys the evidence of a failed verification.",
    ).toBe(false);
  });

  it("S8 ready media with no post_media reference is NOT an orphan", () => {
    const key = `post-images/${OWNER}/media/${MEDIA}/original.webp`;
    const { set } = buildReferenceSet({ mediaRows: [row({ derivatives: { original: key } })] });
    expect(
      isOrphan(set, key),
      "'referenced by a post' and 'owned by the database' are different " +
        "questions. Reclaiming dereferenced media is a separate reviewed sweep.",
    ).toBe(false);
  });

  it("S9 a derivative written as a full CDN URL normalises to the same key", () => {
    const key = `post-images/${OWNER}/posts/asurl.webp`;
    const { set } = buildReferenceSet({
      mediaRows: [row({ derivatives: { original: `${CDN}/${key}?v=2` } })],
    });
    expect(
      isOrphan(set, key),
      "derivatives is free-form jsonb; a URL there must reduce to the store's " +
        "own key or the object it names reads as unreferenced.",
    ).toBe(false);
  });

  it("S10 an unresolvable derivative value is RETAINED and REPORTED, never silently dropped", () => {
    const weird = "s3://some-other-store/thing.webp";
    const { set, unresolved } = buildReferenceSet({
      mediaRows: [row({ derivatives: { original: weird } })],
    });
    expect(extractPath(weird), "precondition: this value is genuinely unrecognised").toBeNull();
    expect(unresolved).toEqual([{ media_id: MEDIA, value: weird }]);
    expect(
      set.has(weird),
      "an unparsed reference is a gap in our knowledge, not a dead file. It " +
        "must still protect whatever it names.",
    ).toBe(true);
  });

  it("S11 an `-l3` key arriving via media_objects gets BOTH rung addresses derived", () => {
    const key = `post-images/${OWNER}/posts/1786264445253-w2560h1165-l3.webp`;
    const { set } = buildReferenceSet({ mediaRows: [row({ derivatives: { original: key } })] });
    expect(isOrphan(set, key.replace("-l3.webp", "-l3-r1080.webp"))).toBe(false);
    expect(isOrphan(set, key.replace("-l3.webp", "-l3-r1440.webp"))).toBe(false);
  });

  /**
   * THE POSITIVE CONTROL. Without this, "nothing is ever an orphan" passes
   * every other test in this file and the tool becomes decorative.
   */
  it("S12 a file nothing in the database names IS still an orphan", () => {
    const { set } = buildReferenceSet({
      urlColumnValues: [`${CDN}/post-images/${OWNER}/posts/live.webp`],
      mediaRows: [row()],
    });
    expect(
      isOrphan(set, `post-images/${OWNER}/posts/abandoned-1786000000000.webp`),
      "the reference set has stopped discriminating: it protects everything, " +
        "so the sweep can never reclaim anything.",
    ).toBe(true);
  });
});

describe("the media reference rules hold their shape under awkward input", () => {
  it("null derivatives, null mime and null state do not throw or vanish", () => {
    const r = mediaReferenceKeys([
      { id: MEDIA, owner_id: OWNER, mime: null, state: null, derivatives: null },
    ]);
    expect(r.derived_in_flight).toBe(1);
    expect(r.keys).toContain(`post-images/${OWNER}/media/${MEDIA}/original.webp`);
    expect(r.by_state["<null>"]).toBe(1);
  });

  it("a non-string derivative value is skipped without killing the row", () => {
    const key = `post-images/${OWNER}/posts/ok.webp`;
    const r = mediaReferenceKeys([
      row({ derivatives: { original: key, "1080": 12345 as unknown as string, "600": "" } }),
    ]);
    expect(r.keys).toContain(key);
    expect(r.unresolved).toEqual([]);
  });

  it("an empty row set produces an empty result rather than a throw", () => {
    const r = mediaReferenceKeys([]);
    expect(r.keys).toEqual([]);
    expect(r.derived_in_flight).toBe(0);
  });

  it("every state is counted, so a scan cannot look complete while skipping rows", () => {
    const r = mediaReferenceKeys([
      row({ id: "a", state: "ready" }),
      row({ id: "b", state: "ready" }),
      row({ id: "c", state: "quarantined" }),
      row({ id: "d", state: "pending", derivatives: {} }),
    ]);
    expect(r.by_state).toEqual({ ready: 2, quarantined: 1, pending: 1 });
  });

  it("the derived in-flight key follows mime, matching what the upload path writes", () => {
    expect(originalKeyFor(OWNER, MEDIA, "image/jpeg")).toMatch(/original\.jpg$/);
    expect(originalKeyFor(OWNER, MEDIA, "image/png")).toMatch(/original\.png$/);
    expect(originalKeyFor(OWNER, MEDIA, "image/avif")).toMatch(/original\.avif$/);
    expect(originalKeyFor(OWNER, MEDIA, "image/gif"), "unknown mime falls back to webp")
      .toMatch(/original\.webp$/);
  });
});

/**
 * WIRING. A correct module that nothing calls is Trap #11 wearing a new hat:
 * the 2026-08-14 rewrite found a reference list that looked authoritative and
 * was read by nothing at all.
 */
describe("detect-orphan-files actually consumes the media graph", () => {
  it("imports the shared reference rules rather than re-deriving them", () => {
    expect(
      /import\s*\{[\s\S]*?mediaReferenceKeys[\s\S]*?\}\s*from\s*"\.\.\/_shared\/referenceSet\.ts"/.test(fnSource),
      "the scan does not import mediaReferenceKeys — the tests above would be " +
        "proving a module the deployed function never calls.",
    ).toBe(true);
  });

  it("reads media_objects and feeds every key into referencedPaths", () => {
    expect(
      /\.from\(\s*"media_objects"\s*\)/.test(fnSource),
      "media_objects is never read. post_media -> media_objects -> storage is " +
        "invisible and every object the media engine owns is a deletion candidate.",
    ).toBe(true);
    expect(
      /mediaReferenceKeys\([\s\S]{0,200}?\)/.test(fnSource) &&
        /for\s*\(\s*const\s+k\s+of\s+result\.keys\s*\)\s*referencedPaths\.add\(k\)/.test(fnSource),
      "the media keys are computed but not added to referencedPaths.",
    ).toBe(true);
  });

  it("the media_objects read is queued into the same scan, not left dangling", () => {
    expect(
      /queries\.push\(\s*addMediaReferences\(\)\s*\)/.test(fnSource),
      "addMediaReferences is declared but never awaited with the rest of the scan.",
    ).toBe(true);
  });

  /**
   * The media read is NOT best-effort. A snapshot table may legitimately be
   * missing; media_objects may not. An unread media table means every object
   * the media engine owns reads as unreferenced — the `posts` failure mode,
   * one table across.
   */
  it("a failed media_objects read aborts the run", () => {
    const block = fnSource.slice(
      fnSource.indexOf("const addMediaReferences"),
      fnSource.indexOf("queries.push(addMediaReferences())"),
    );
    expect(block.length, "addMediaReferences could not be located").toBeGreaterThan(100);
    // ⚠ TIGHT ON PURPOSE. The loose form — `if (error) { … 500 chars … throw` —
    // is satisfied by `if (error) { break; }  if (false) { throw new Error(`,
    // which is precisely the swallow this assertion exists to forbid. Found by
    // tools/mutate-orphan-media.mjs mutation 4, which stayed GREEN against the
    // loose form. The throw must be the FIRST thing in the error branch.
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*throw new Error\(/.test(block),
      "an error reading media_objects does not throw IMMEDIATELY — a transient " +
        "failure would report the entire media engine's storage as orphaned.",
    ).toBe(true);
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*(break|return|continue)\b/.test(block),
      "an error reading media_objects breaks out of the page loop, which makes " +
        "a failed read indistinguishable from an empty table.",
    ).toBe(false);
    expect(
      /addMediaReferences\(\)\s*\.catch/.test(fnSource),
      "the media read is swallowed by a .catch, which makes a failed scan " +
        "indistinguishable from an empty one.",
    ).toBe(false);
  });

  it("the media read never selects sha256", () => {
    expect(
      /from\(\s*"media_objects"\s*\)[\s\S]{0,200}?select\(\s*"[^"]*sha256/i.test(fnSource),
      "the content hash is server-side only (20260814084711). This function " +
        "has no use for it and must not carry it into a report.",
    ).toBe(false);
  });

  it("the report states the media graph per run", () => {
    expect(/media_graph/.test(fnSource), "the report does not mention the media graph").toBe(true);
    expect(
      /unresolved_derivative_values/.test(fnSource),
      "unresolved derivative values are not surfaced — a reference set that " +
        "shrinks silently is the defect class this file exists to prevent.",
    ).toBe(true);
    expect(
      /media_objects_without_post_reference/.test(fnSource),
      "dereferenced media is retained by design; if it is not also COUNTED, " +
        "storage leaks invisibly as the price of that safety.",
    ).toBe(true);
  });

  it("post_media coverage is reported, never used to orphan anything", () => {
    const idx = fnSource.indexOf("const addPostMediaCoverage");
    expect(idx, "addPostMediaCoverage is missing").toBeGreaterThan(0);
    const block = fnSource.slice(idx, idx + 1400);
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*throw new Error\(/.test(block),
      "a failed post_media read does not throw immediately.",
    ).toBe(true);
    expect(
      /if\s*\(\s*error\s*\)\s*\{\s*(break|return|continue)\b/.test(block),
      "a failed post_media read breaks out of the page loop instead of aborting.",
    ).toBe(false);
    expect(
      /orphans\.push|r2Orphans\.push/.test(block),
      "post_media coverage has become an orphan test. It must never be one: a " +
        "media object with no reference is in-flight, quarantined-and-detached, " +
        "or simply not published yet.",
    ).toBe(false);
  });
});

/**
 * THE PAIR LOCK. `originalKeyFor` is a DERIVED address — no column holds it
 * while an upload is in flight — so two files spell it, and they must spell it
 * identically. Same discipline as imageLadder.test.ts holding the `-l3` rung
 * derivation to `src/lib/imageLadder.ts`.
 */
describe("the in-flight upload address has exactly one spelling", () => {
  it("media-verify-upload builds the same key this reference set derives", () => {
    const verify = read("supabase/functions/media-verify-upload/index.ts");
    const m = verify.match(
      /return\s+`post-images\/\$\{ownerId\}\/media\/\$\{mediaId\}\/original\.\$\{EXT_BY_MIME\[mime\]\s*\?\?\s*"webp"\}`/,
    );
    expect(
      m,
      "media-verify-upload no longer stores originals where this reference set " +
        "looks for them. Every in-flight upload's bytes become an orphan.",
    ).not.toBeNull();

    const shared = read("supabase/functions/_shared/referenceSet.ts");
    expect(
      /return\s+`post-images\/\$\{ownerId\}\/media\/\$\{mediaId\}\/original\.\$\{EXT_BY_MIME\[mime\]\s*\?\?\s*"webp"\}`/.test(
        shared,
      ),
      "the shared derivation drifted from the writer.",
    ).toBe(true);
  });

  it("both files agree on the extension table", () => {
    const verify = read("supabase/functions/media-verify-upload/index.ts");
    for (const [mime, ext] of Object.entries({
      "image/webp": "webp",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/avif": "avif",
    })) {
      expect(
        new RegExp(`"${mime}"\\s*:\\s*"${ext}"`).test(verify),
        `media-verify-upload no longer maps ${mime} to .${ext}`,
      ).toBe(true);
      expect(originalKeyFor(OWNER, MEDIA, mime).endsWith(`.${ext}`)).toBe(true);
    }
  });
});
