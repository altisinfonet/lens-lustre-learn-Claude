/**
 * D-003 — MEDIA DELIVERY IS STILL UNAUTHORIZED, AND THAT MUST NOT CHANGE QUIETLY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `post_media_for` decides which ADDRESSES a viewer learns. It does not decide
 * who may fetch them. Measured 2026-08-20 from https://example.com — a
 * third-party origin, no session, no cookie, `credentials:'omit'`:
 *
 *     migrated post media    RETRIEVED  2560x1165
 *     a second post's media  RETRIEVED  1023x1537
 *     a key that does not exist          refused      <- the control discriminates
 *
 * So the platform is in its pre-D-003 state: public bucket, public CDN, no
 * server-side check on the bytes.
 *
 * ⚠ WHAT THIS FILE IS FOR. Closing that gap means changing how a media address
 * becomes a picture — signed URLs, a token, a proxy, a different prefix. Any of
 * those is a change to the platform's privacy promise, and the way it goes
 * wrong is not a crash: it is landing HALF of it. A restricted prefix on a
 * bucket that still serves everything publicly does not protect anything; it
 * only looks protected in a diff. That is the exact failure D-001 refused to
 * ship, and D-002 is the notice that stands in for it until it is fixed.
 *
 * So this test pins the CURRENT state. It fails the moment someone starts
 * building authorized delivery — which is correct: at that moment the register
 * entry, the notice and the pin all have to move together, and this failure is
 * what forces that. It is not a test of the fix; it is a test that the fix
 * cannot arrive silently.
 *
 * @decision D-003
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const READER  = "src/lib/media/postMediaRead.ts";
const RPC_SQL = "supabase/migrations/20260819170132_post_media_read_rpc.sql";
const NOTICE  = "src/components/post/PrivacyGapNotice.tsx";

describe("D-003: media delivery is still unauthorized, and the register says so", () => {
  it("the register carries D-003 as ACTIVE with the dependency written down", () => {
    const reg = read("docs/DECISIONS.md");
    expect(reg).toMatch(/^## D-003 — /m);
    const body = reg.slice(reg.indexOf("## D-003"));
    expect(/-\s+\*\*Status:\*\*\s*ACTIVE/.test(body), "D-003 is no longer ACTIVE").toBe(true);
    expect(
      /Cloudflare/.test(body) && /outside this repository/.test(body),
      "D-003 no longer names the dependency that blocks it. A decision whose " +
        "blocker is unrecorded reads as work someone forgot to do.",
    ).toBe(true);
  });

  it("the client still resolves a media path to a PLAIN public CDN address", () => {
    const src = strip(read(READER));
    expect(
      /return `https:\/\/\$\{MEDIA_CDN_HOST\}\/\$\{path\}`;/.test(src),
      "the media resolver no longer produces a plain public URL. If authorized " +
        "delivery is being introduced, D-003 and PrivacyGapNotice must move in " +
        "the same commit — see docs/DECISIONS.md.",
    ).toBe(true);
    for (const signal of ["createSignedUrl", "signed_url", "signedUrl", "X-Amz-Signature", "token="]) {
      expect(
        src.includes(signal),
        `${signal} has appeared in the client media path. That is authorized ` +
          `delivery arriving without the register, the notice or the negative ` +
          `test moving with it.`,
      ).toBe(false);
    }
  });

  it("post_media_for still returns an object path, not a delivery grant", () => {
    const sql = read(RPC_SQL);
    expect(/object_path text/.test(sql), "the RPC's return type changed shape").toBe(true);
    expect(
      /signed|expires|token/i.test(sql.replace(/--.*$/gm, "").replace(/comment on function[\s\S]*$/i, "")),
      "the RPC has started minting something time-limited. That is the D-003 " +
        "work; close the register entry in the same commit.",
    ).toBe(false);
  });

  /**
   * The notice is the only thing standing between a member and a promise the
   * platform cannot keep. D-002 pins it to the chooser; this pins it to the
   * delivery gap, which is the reason it exists at all.
   */
  it("the privacy-gap notice is still shipped while the gap is open", () => {
    expect(
      existsSync(join(process.cwd(), NOTICE)),
      "PrivacyGapNotice is gone while D-003 is still ACTIVE — the gap is open " +
        "and nothing tells the member.",
    ).toBe(true);
    const src = read(NOTICE);
    expect(/direct link/.test(src), "the notice no longer states the actual limit").toBe(true);
  });

  it("no client grant has been added to the media tables as a shortcut", () => {
    const sql = read(RPC_SQL).replace(/--.*$/gm, "").replace(/comment on function[\s\S]*$/i, "");
    expect(
      /\bgrant\b[^;]*\bon\b[^;]*\b(post_media|media_objects)\b/i.test(sql),
      "a table grant appeared beside the read RPC. Item B and Item C exist to " +
        "refuse exactly that.",
    ).toBe(false);
  });
});
