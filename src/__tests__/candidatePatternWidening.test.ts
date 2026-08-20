/**
 * WIDENING THE CANDIDATE PATTERN WITHOUT FALSIFYING FOUR FROZEN FENCES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 34 slides across 19 posts are real photographs, in a bucket the CDN serves,
 * owned by the member who posted them, and outside every manifest only because
 * the engine's pattern did not describe them. Bringing them in means changing
 * the definition of "candidate" — and that definition is load-bearing in four
 * places, one of which is a HISTORICAL RECORD.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH is not "the new slides do not migrate".
 * It is the quiet one: `media_migration_fence_digest` gets widened in place,
 * every past fence silently starts covering more, and
 * `docs/MANIFEST_PROVENANCE.md` — which states that `f0a74d3e…`, `46c4cad2…`,
 * `eff23edc…` and `c6173052…` each still reproduce — becomes false. Nothing
 * breaks. Nothing is red. The provenance chain is simply no longer true.
 *
 * MEASURED 2026-08-20, which is why v1 is frozen rather than widened:
 *
 *     class B/C slides created at or before   cycle 1 fence   27
 *                                             cycle 2 fence   34
 *                                             cycle 3 fence   34
 *                                             cycle 4 fence   34
 *
 * And the disjointness that makes the widening safe, over all 310 production
 * slides:
 *
 *     matches A  229 · matches B  19 · matches C  15 · matches >1   0
 *     B/C already migrated 0 · B/C non-public 0 · B/C owner mismatch 0
 *
 * Full audit: docs/CANDIDATE_PATTERN_AUDIT.md
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  CANDIDATE_CLASSES,
  CANDIDATE_PATH,
  CDN_HOST,
  candidateClass,
} from "../../supabase/functions/_shared/manifestPlan";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const bodies = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));
const allSql = bodies.join("\n");

/**
 * The LAST definition of a function across every migration, because
 * CREATE OR REPLACE means an earlier file's text proves nothing about the
 * function that is actually live. Same rule the other suites follow.
 */
function lastDefinitionOf(fn: string): string {
  // ⚠ MATCH THE DEFINITION, NOT EVERY MENTION. The first version of this helper
  // searched for `function public.<fn>(` and happily returned the tail of a
  // GRANT statement — a target that is not the thing under test at all, the
  // same stale-target class as the retargeted mutations in tools/. The marker
  // below is the CREATE, and the result is checked to look like a body.
  let found = "";
  for (const body of bodies) {
    const re = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`, "gi");
    let m: RegExpExecArray | null;
    let last = -1;
    while ((m = re.exec(body)) !== null) last = m.index;
    if (last >= 0) found = body.slice(last);
  }
  if (!found) throw new Error(`no CREATE FUNCTION for ${fn} found in migrations`);
  if (!/\$[a-z]*\$|BEGIN/i.test(found)) {
    throw new Error(`the slice for ${fn} does not look like a function body`);
  }
  return found;
}

/** Every migration concatenated, for corpus-wide structural assertions. */
function allMigrationText(): string {
  return allSql;
}

const OWNER = "01c5059c-5df3-4885-ae61-21a88f25114a";
const ALBUM = "9f31841a-9ece-431a-9703-6df1783068c4";

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE FROZEN PATTERN IS STILL THE FROZEN PATTERN
   ═══════════════════════════════════════════════════════════════════════════ */

describe("class A is frozen", () => {
  it("CANDIDATE_PATH still describes exactly what the approved manifests were approved against", () => {
    /**
     * Compared on the NORMALISED source — a literal regex escapes its slashes
     * (`\/`) and one built from a string does not, and that difference is
     * cosmetic. What must not change is the shape it accepts.
     */
    expect(CANDIDATE_PATH.source.replace(/\\\//g, "/")).toBe(
      "^post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/posts/[^/?]+$",
    );
    // Belt and braces: the behaviour, not just the text.
    expect(CANDIDATE_PATH.test(`post-images/${OWNER}/posts/a.webp`)).toBe(true);
    expect(CANDIDATE_PATH.test(`post-images/${OWNER}/a.webp`)).toBe(false);
    expect(CANDIDATE_PATH.test(`avatars/${OWNER}/my-photos/${ALBUM}/a.webp`)).toBe(false);
    expect(CANDIDATE_PATH.test(`post-images/${OWNER}/posts/a.webp?v=1`)).toBe(false);
  });

  it("class A is first, so `candidateClass` reports A for a class-A path", () => {
    expect(CANDIDATE_CLASSES[0].cls).toBe("A");
    expect(candidateClass(`post-images/${OWNER}/posts/x-w1x1-l3.webp`)).toBe("A");
  });

  it("`media_migration_fence_digest` is NEVER redefined after the engine migration", () => {
    /**
     * ⚠ THE WHOLE POINT OF THIS FILE. Redefining it would retroactively change
     * what four approved fences covered.
     */
    const definitions = files.filter((f, i) =>
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.media_migration_fence_digest\s*\(/i.test(bodies[i]),
    );
    expect(
      definitions,
      "media_migration_fence_digest is defined in more than one migration. The " +
        "later one silently wins, and every historical digest changes with it.",
    ).toEqual(["20260818011014_media_migration_engine.sql"]);
  });

  it("the widened population lives in a SEPARATE function", () => {
    expect(/CREATE OR REPLACE FUNCTION public\.media_migration_fence_digest_wide/.test(allSql)).toBe(true);
    // …and it is a drop-in: same columns, so the migrator reads it identically.
    expect(/RETURNS TABLE \(key_set_md5 text, item_count integer, post_count integer\)/.test(allSql)).toBe(true);
  });

  it("the wide function is service_role only, like the one it mirrors", () => {
    expect(/REVOKE ALL ON FUNCTION public\.media_migration_fence_digest_wide\(timestamptz\) FROM PUBLIC, anon;/.test(allSql)).toBe(true);
    expect(/REVOKE ALL ON FUNCTION public\.media_migration_fence_digest_wide\(timestamptz\) FROM authenticated;/.test(allSql)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE THREE CLASSES ARE DISJOINT
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the classes do not overlap", () => {
  const samples = [
    [`post-images/${OWNER}/posts/1787154334198-abc-w1023h1537-l3.webp`, "A"],
    [`post-images/${OWNER}/1775277567455_0.webp`, "B"],
    [`avatars/${OWNER}/my-photos/${ALBUM}/1787139817305-8o84m43aglj.webp`, "C"],
  ] as const;

  it.each(samples)("%s is exactly class %s and nothing else", (path, cls) => {
    const hits = CANDIDATE_CLASSES.filter((c) => c.re.test(path)).map((c) => c.cls);
    expect(hits).toEqual([cls]);
  });

  it("A and B cannot overlap, because `[^/?]+$` forbids a slash", () => {
    const a = `post-images/${OWNER}/posts/x.webp`;
    expect(CANDIDATE_CLASSES[0].re.test(a)).toBe(true);
    expect(CANDIDATE_CLASSES[1].re.test(a)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. UNRELATED PATHS ARE STILL REJECTED
   ═══════════════════════════════════════════════════════════════════════════ */

describe("what must stay out, stays out", () => {
  const rejected: [string, string][] = [
    [`avatars/${OWNER}/avatar.webp`,
      "MUTABLE — overwritten on every profile-photo change, so content identity can never be stable"],
    [`avatars/${OWNER}/avatar.webp?t=1785855632591`,
      "a cache-buster is part of the URL, never the object"],
    [`avatars/${OWNER}/cover.webp?t=1783171206205`, "as above, and also mutable"],
    [`avatars/covers/${OWNER}/1773897608964-2150573909.jpg`,
      "the owner is at path segment 3, not 2 — MIG-1019 would refuse it anyway"],
    [`post-images/${OWNER}/posts/sub/dir/x.webp`, "a slash where the pattern forbids one"],
    [`post-images/${OWNER}/x.webp?v=2`, "query string"],
    [`avatars/${OWNER}/my-photos/x.webp`, "no album uuid — class C requires one"],
    [`avatars/${OWNER}/my-photos/${ALBUM}/sub/x.webp`, "a slash too deep"],
    [`banners/${OWNER}/x.webp`, "a platform prefix, not member media"],
    [`post-images/NOT-A-UUID/posts/x.webp`, "the owner segment is not a uuid"],
    [`gallery/x.webp`, "a shared prefix with no owner segment at all"],
    ["", "empty"],
  ];

  it.each(rejected)("%s is not a candidate (%s)", (path) => {
    expect(candidateClass(path)).toBeNull();
  });

  it("the migrator still refuses a non-candidate with MIG-1017", () => {
    const plan = readFileSync(join(ROOT, "supabase/functions/_shared/manifestPlan.ts"), "utf8");
    expect(/code: "MIG-1017"/.test(plan)).toBe(true);
    expect(
      /if \(candidateClass\(object_path\) === null\) \{/.test(plan),
      "the manifest validator no longer classifies the path — MIG-1017 has stopped guarding",
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. OWNERSHIP CANNOT BE SPOOFED
   ═══════════════════════════════════════════════════════════════════════════ */

describe("ownership holds for every class without a new rule", () => {
  it("the owner is path segment 2 in all three shapes", () => {
    for (const p of [
      `post-images/${OWNER}/posts/x.webp`,
      `post-images/${OWNER}/x.webp`,
      `avatars/${OWNER}/my-photos/${ALBUM}/x.webp`,
    ]) {
      expect(candidateClass(p)).not.toBeNull();
      expect(p.split("/")[1]).toBe(OWNER);
    }
  });

  it("MIG-1019 and MIG-2006 both still pin it, and neither was relaxed", () => {
    const plan = readFileSync(join(ROOT, "supabase/functions/_shared/manifestPlan.ts"), "utf8");
    expect(/object_path\.split\("\/"\)\[1\] !== owner_id/.test(plan), "MIG-1019 no longer pins the owner").toBe(true);
    expect(/code: "MIG-1019"/.test(plan)).toBe(true);
    expect(
      /split_part\(_item->>'object_path', '\/', 2\) <> _owner_id::text/.test(allSql),
      "MIG-2006 no longer pins the owner at execution",
    ).toBe(true);
  });

  it("a class-C path in ANOTHER member's folder is still a class-C shape — the OWNER check is what refuses it", () => {
    // The pattern is about shape; MIG-1019/2006 are about whose it is. Both are
    // needed, and this records that the pattern alone is not an authorisation.
    const stranger = "00af64a6-399d-4399-a5a4-5234554bc6c6";
    const p = `avatars/${stranger}/my-photos/${ALBUM}/x.webp`;
    expect(candidateClass(p)).toBe("C");
    expect(p.split("/")[1]).not.toBe(OWNER);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. BUCKET CONFUSION
   ═══════════════════════════════════════════════════════════════════════════ */

describe("bucket confusion is not expressible", () => {
  it("no candidate path carries a host, a scheme or a traversal", () => {
    for (const bad of [
      `https://cdn.50mmretina.com/post-images/${OWNER}/posts/x.webp`,
      `//cdn.50mmretina.com/post-images/${OWNER}/posts/x.webp`,
      `/post-images/${OWNER}/posts/x.webp`,
      `post-images/${OWNER}/../${OWNER}/posts/x.webp`,
    ]) {
      expect(candidateClass(bad)).toBeNull();
    }
  });

  it("the audit records the retrieval that proved both prefixes are served", () => {
    const audit = readFileSync(join(ROOT, "docs/CANDIDATE_PATTERN_AUDIT.md"), "utf8");
    expect(existsSync(join(ROOT, "docs/CANDIDATE_PATTERN_AUDIT.md"))).toBe(true);
    expect(/RETRIEVED 1080x1350/.test(audit), "the class-B retrieval evidence is gone").toBe(true);
    expect(/RETRIEVED 4013x2675/.test(audit), "the class-C retrieval evidence is gone").toBe(true);
    expect(/refused/.test(audit), "the discriminating control is gone").toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE MIGRATOR SAYS WHICH POPULATION IT WAS GATED ON
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the fence function is a recorded choice, not a default", () => {
  const mig = readFileSync(join(ROOT, "supabase/functions/migrate-post-media/index.ts"), "utf8");

  it("defaults to the FROZEN population", () => {
    expect(/const wide: boolean = body\?\.wide === true;/.test(mig)).toBe(true);
    expect(
      /const fenceFn = wide \? "media_migration_fence_digest_wide" : "media_migration_fence_digest";/.test(mig),
      "the migrator no longer defaults to the frozen fence",
    ).toBe(true);
  });

  it("echoes the choice, so a transcript records it", () => {
    expect(/fence_fn: fenceFn, wide,/.test(mig)).toBe(true);
  });

  it("records WHICH deployed version is live, and it is no longer the narrow one", () => {
    /**
     * ⚠ THIS TEST CHANGED MEANING ON 2026-08-20, AND THAT IS THE POINT.
     *
     * Until the wide cycle ran, the repo and the deployed function differed on
     * purpose: v1 was built against the narrow pattern and is what migrated the
     * 229, and it would have refused every class-B/C manifest row with MIG-1017
     * — correct for the code it was. This test asserted that the divergence was
     * WRITTEN DOWN, because the danger was a reader assuming the wide flag was
     * live and misreading the resulting refusals.
     *
     * v2 (ezbr 267aa65a…) is now deployed and the divergence is closed. So the
     * assertion becomes the opposite one, and it must be just as specific: the
     * header must still name a version, because "there is no note" and "the note
     * says they agree" are different states and only one of them is checked.
     *
     * `_shared/s3.ts` records what happens when two copies of the same thing
     * drift: "the divergent one is always the one that runs".
     */
    expect(
      /DEPLOYMENT STATE, 2026-08-20 — READ THIS BEFORE RUNNING A CYCLE/.test(mig),
      "the deployment-state note is gone — a reader cannot tell which version is live",
    ).toBe(true);
    expect(
      /DEPLOYED:\s+version 2/.test(mig),
      "the header no longer names the deployed version",
    ).toBe(true);
    expect(
      /THESE TWO DIFFER, ON PURPOSE AND TEMPORARILY/.test(mig),
      "the divergence was closed when v2 shipped; this warning would now be a lie",
    ).toBe(false);
    expect(
      /wide: true/.test(mig),
      "the header must still say that a class-B/C cycle has to ask for the wide fence",
    ).toBe(true);
  });

  it("MIG-1040 is not bypassed by either choice", () => {
    const plan = readFileSync(join(ROOT, "supabase/functions/_shared/manifestPlan.ts"), "utf8");
    expect(/code: "MIG-1040"/.test(plan)).toBe(true);
    expect(/assertFence\(/.test(mig)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WORKSTREAM 3 — THE REFUSALS THAT KEEP THE REMAINING 29 SLIDES OUT
   ═══════════════════════════════════════════════════════════════════════════

   @decision D-006

   Since 2026-08-20 these refusals are not merely defensive: they PIN the
   owner's decision that the 29 slides are permanently excluded from migration
   (docs/PERMANENT_LEGACY_EXCLUSIONS.md). Weakening any of them is overturning
   an owner decision, not tidying a test.

   The WS3 audit (2026-08-20) re-derived the 29 remaining legacy-only slides
   from production and proved that NONE of them is migratable by this engine:

     • 27 slides live on `jtdtehuqtinjxropkkcn.supabase.co`, not in R2. All 23
       distinct objects return 404 from `cdn.50mmretina.com`, and every one of
       them is a 600px `-thumb.webp` DERIVATIVE, not an original.
     • 2 slides are real R2 cover photographs under `avatars/covers/<owner>/`,
       where the owner sits at path segment 3 rather than 2.

   Two of the controls that refuse them had NO test on their VALUE, only on
   their presence:

     • nothing asserted what `CDN_HOST` actually is. Retargeting it at
       `jtdtehuqtinjxropkkcn.supabase.co` would have admitted all 27 Supabase
       thumbnails while `host !== CDN_HOST` still appeared in the source and
       every existing assertion stayed green.
     • nothing asserted that the candidate classes refuse the real production
       keys — only synthetic ones.

   ⚠ THESE ARE NOT HYPOTHETICALS. The keys below are the real production
   objects, copied from the audit. If a future widening admits them, the engine
   will try to migrate a thumbnail as if it were an original.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WS3 — the 29 remaining legacy slides must stay out of the candidate set", () => {
  it("CDN_HOST is the CDN, and is asserted by VALUE", () => {
    /**
     * The 27 Supabase-hosted slides are refused first by the host check, before
     * any pattern runs. A host constant with no value assertion is a one-word
     * edit away from admitting them.
     */
    expect(CDN_HOST).toBe("cdn.50mmretina.com");
    expect(CDN_HOST).not.toContain("supabase");
  });

  it("refuses every real Supabase-hosted key from the WS3 audit", () => {
    /**
     * These are bucket-relative keys as they would appear AFTER the host is
     * stripped — i.e. the shape a widened host check would hand to the pattern.
     * `storage/v1/object/public/...` is not a candidate under any class.
     */
    const realSupabaseKeys = [
      "storage/v1/object/public/post-images/5745a9c9-55ec-4f0b-8a75-3a55ab3064d8/1773424319982_0-thumb.webp",
      "storage/v1/object/public/post-images/622dada0-2ec0-4472-85ac-7d2a034a1cf5/1775128354335_0-thumb.webp",
      "storage/v1/object/public/post-images/85250f9f-f210-444c-97cc-dd03949efe27/avatar-thumb.webp",
      "storage/v1/object/public/post-images/85250f9f-f210-444c-97cc-dd03949efe27/covers/1775110594127-1000651117-thumb.webp",
    ];
    for (const k of realSupabaseKeys) {
      expect(candidateClass(k), `${k} must not be a candidate`).toBeNull();
    }
  });

  it("refuses the two real avatars/covers keys — the owner is at segment 3", () => {
    /**
     * These two objects DO exist in R2 and are genuine photographs (1500x1000
     * and 2000x1333 JPEGs, retrieved and measured 2026-08-20). They are refused
     * for one reason only: `avatars/covers/<owner>/` puts the owner one segment
     * too deep, so MIG-1019's "owner at segment 2" rule cannot prove ownership.
     *
     * ⚠ THE FIX FOR THESE IS NOT TO WIDEN THE PATTERN. `media_mark_ready`
     * independently refuses the same shape and says so in terms:
     * "DO NOT REMOVE, AND DO NOT WIDEN THE PREFIX LIST."
     */
    const realCoverKeys = [
      "avatars/covers/569aa88e-3401-4836-88ea-2d43a1ab7e18/1773897608964-2150573909.jpg",
      "avatars/covers/569aa88e-3401-4836-88ea-2d43a1ab7e18/1773897806339-Faces of the World.jpg",
    ];
    for (const k of realCoverKeys) {
      expect(candidateClass(k), `${k} must not be a candidate`).toBeNull();
      // and the owner really is at segment 3, which is why segment 2 fails
      expect(k.split("/")[1]).toBe("covers");
      expect(k.split("/")[2]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("the live readiness gate still pins the owner to segment 2", () => {
    /**
     * Belt and braces: even if a pattern admitted `avatars/covers/<owner>/`,
     * `media_mark_ready` would refuse the object with MEDIA-2102. Asserted
     * against the LAST definition across migrations, because CREATE OR REPLACE
     * means an earlier file's text proves nothing.
     */
    const src = lastDefinitionOf("media_mark_ready");
    expect(src).toContain("'^(post-images|avatars)/' || _owner::text || '/'");
    expect(src).toContain("MEDIA-2102");
    expect(src, "the prefix list must not have grown a third entry").not.toMatch(
      /\^\(post-images\|avatars\|[a-z-]+\)\//,
    );
  });

  it("duplicate protection exists for BOTH shapes a migration could violate", () => {
    /**
     * (owner_id, sha256) stops the same photograph becoming two media rows.
     * (post_id, media_id) and PK(post_id, ord) stop one post carrying the same
     * object twice or two objects at one position.
     */
    const all = allMigrationText();
    expect(all).toMatch(/CREATE UNIQUE INDEX[^;]*media_objects_owner_content[^;]*\(owner_id, sha256\)/s);
    expect(all).toMatch(/CREATE UNIQUE INDEX[^;]*post_media_post_media_uniq[^;]*\(post_id, media_id\)/s);
    expect(all).toMatch(/PRIMARY KEY \(post_id, ord\)|primary key \(post_id, ord\)/);
  });

  it("nothing in the migrator deletes, renames or overwrites a source object", () => {
    /**
     * The engine reads bytes and writes rows. A migration that mutated storage
     * would make the manifest's recorded hashes describe something that no
     * longer exists, and there would be no way back.
     */
    const migrator = readFileSync(
      join(process.cwd(), "supabase/functions/migrate-post-media/index.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["DeleteObject", "PutObject", "CopyObject", "deleteS3", "copyS3", "x-amz-copy-source"]) {
      expect(migrator, `the migrator must never ${forbidden}`).not.toContain(forbidden);
    }
    expect(migrator).not.toMatch(/method:\s*["'](PUT|DELETE)["']/);
  });
});
