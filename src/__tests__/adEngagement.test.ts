/**
 * LIKE · COMMENT · SHARE ON A SPONSORED AD.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-11: "For All sponsored Ad, Like Comment share is required like
 * a normal post." — and, in the same message, the standing rule this build had
 * to respect: no guesswork, no implicit behaviour, and nothing damaged.
 *
 * Most of the feature is database. What a test can hold still is the set of
 * decisions that are easy to delete by accident and expensive to notice:
 *
 *   1. the engagement row only renders for a REAL ad_creatives row.
 *      Lose the `chosen` guard and every zone's legacy image shares one
 *      comment thread under a made-up id.
 *   2. the deleted-account write lock is on all three new tables.
 *      Lose it and a deleted account can comment on ads — the exact P0 that
 *      migration 20260806160000 exists to close.
 *   3. the blocklist is the SAME function post comments use.
 *      A private copy would drift from the admin's keyword list.
 *   4. share upserts with ignoreDuplicates.
 *      Without it the second share attempts an UPDATE, which no policy allows,
 *      and the member sees an error for doing nothing wrong (BUG-062 on posts).
 *   5. "Share to your wall" is NOT offered on an ad.
 *      It would publish an advertisement under a member's own name.
 *
 * Every SQL assertion runs against a comment-stripped copy — a source-scanning
 * test on this project has twice passed by matching its own documentation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getNotifLink } from "@/lib/notificationLinks";
import { ACTION_CATALOG } from "@/lib/notifications/describe";
import { adPath, emptyEngagement } from "@/lib/ads/adEngagement";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const stripSqlComments = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const stripJsComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

const MIGRATION = "supabase/migrations/20260811120000_ad_creative_engagement.sql";
const sql = stripSqlComments(read(MIGRATION));

describe("rule 1 — engagement only attaches to a real creative", () => {
  const adZone = stripJsComments(read("src/components/ads/AdZone.tsx"));

  it("renders the bar only for the story card AND only when a library creative was picked", () => {
    expect(adZone).toMatch(
      /zone === "story-card" && chosen && <AdEngagementBar creativeId=\{chosen\.id\} \/>/,
    );
  });

  it("does not render it for the sidebar or lightbox zones", () => {
    // Those are banners beside content, not posts in a feed. If a second,
    // unguarded `<AdEngagementBar .../>` were ever added this would catch it.
    const usages = adZone.match(/<AdEngagementBar/g) || [];
    expect(usages.length).toBe(1);
  });

  it("keys everything to ad_creatives.id", () => {
    expect(sql).toContain("REFERENCES public.ad_creatives(id) ON DELETE CASCADE");
  });
});

describe("the three tables exist with the constraints that make them behave", () => {
  it("creates reactions, comments and shares", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ad_creative_reactions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ad_creative_comments");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ad_creative_shares");
  });

  it("allows one reaction and one share per member per ad", () => {
    expect(sql).toMatch(/ad_creative_reactions_one_per_member UNIQUE \(creative_id, user_id\)/);
    expect(sql).toMatch(/ad_creative_shares_one_per_member UNIQUE \(creative_id, user_id\)/);
  });

  it("refuses an empty comment in the database, not only in the form", () => {
    expect(sql).toMatch(/CHECK \(length\(btrim\(content\)\) > 0\)/);
  });

  it("accepts only the six reaction types the picker offers", () => {
    expect(sql).toMatch(/CHECK \(reaction_type IN \('like','love','haha','wow','sad','angry'\)\)/);
  });
});

describe("rule 2 — a deleted account cannot touch an ad", () => {
  it("applies the account-liveness lock to all three tables", () => {
    expect(sql).toContain("account_is_live()");
    for (const t of ["ad_creative_reactions", "ad_creative_comments", "ad_creative_shares"]) {
      expect(sql, `${t} must be in the lock loop`).toContain(`'${t}'`);
    }
    expect(sql).toContain("as restrictive for insert");
    expect(sql).toContain("as restrictive for update");
    expect(sql).toContain("as restrictive for delete");
  });

  it("turns RLS on for all three", () => {
    expect(sql).toContain("ALTER TABLE public.ad_creative_reactions ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.ad_creative_comments  ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.ad_creative_shares    ENABLE ROW LEVEL SECURITY");
  });

  it("lets a member write only as themselves", () => {
    const writes = sql.match(/WITH CHECK \(auth\.uid\(\) = user_id\)/g) || [];
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });

  it("lets an admin, and only an admin, delete somebody else's comment", () => {
    expect(sql).toMatch(
      /USING \(auth\.uid\(\) = user_id OR public\.has_role\(auth\.uid\(\), 'admin'::app_role\)\)/,
    );
  });
});

describe("rule 3 — one blocklist, not two", () => {
  it("attaches the SAME function that guards post comments", () => {
    expect(sql).toContain("EXECUTE FUNCTION public.enforce_comment_blocklist()");
  });

  it("does not define a private copy of it", () => {
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.enforce_comment_blocklist");
  });

  it("sends a flagged ad comment to the SAME review queue", () => {
    expect(sql).toContain("ALTER TABLE public.comment_reports");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS ad_comment_id uuid");
    expect(sql).toContain("INSERT INTO public.comment_reports (ad_comment_id");
    expect(sql).toContain("public._flag_review_keyword_hit(NEW.content)");
  });
});

describe("rule 4 — sharing twice is not an error", () => {
  const lib = stripJsComments(read("src/lib/ads/adEngagement.ts"));

  it("upserts the share with ignoreDuplicates", () => {
    expect(lib).toMatch(/onConflict: "creative_id,user_id", ignoreDuplicates: true/);
  });

  it("upserts a reaction WITHOUT ignoreDuplicates, because changing it must stick", () => {
    const reactBlock = lib.slice(lib.indexOf("export const reactToAd"), lib.indexOf("export const unreactToAd"));
    expect(reactBlock).toContain('onConflict: "creative_id,user_id"');
    expect(reactBlock).not.toContain("ignoreDuplicates");
  });
});

describe("rule 5 — an ad is never republished under a member's name", () => {
  const bar = stripJsComments(read("src/components/ads/AdEngagementBar.tsx"));

  it("offers no Share to your wall", () => {
    expect(bar).not.toContain("Share to your wall");
    expect(bar).not.toContain("post_shares");
  });

  it("shares the ad's own page", () => {
    expect(bar).toContain("publicUrl(adPath(creativeId))");
  });
});

describe("one round trip for a screen full of ads", () => {
  it("defines the batched RPC and lets only signed-in members run it", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_ad_engagement(_creative_ids uuid[])");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.get_ad_engagement(uuid[]) FROM public, anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_ad_engagement(uuid[]) TO authenticated");
  });

  it("reads the viewer's own state from auth.uid(), never from a parameter", () => {
    // Slice to the END of that one function. Reading to the end of the file
    // would drag in get_notification_email_enabled, whose own _user_id
    // parameter would make this pass or fail for the wrong reason.
    const start = sql.indexOf("get_ad_engagement(_creative_ids uuid[])");
    const bodyOpen = sql.indexOf("$fn$", start);
    const bodyClose = sql.indexOf("$fn$", bodyOpen + 4);
    const fn = sql.slice(start, bodyClose);
    expect(fn).toContain("r.user_id = auth.uid()");
    expect(fn).not.toMatch(/_viewer_id|_user_id uuid/);
  });

  it("the client asks for a batch, not one id at a time", () => {
    const lib = read("src/lib/ads/adEngagement.ts");
    expect(lib).toContain("_creative_ids: ids");
    expect(lib).toContain("Promise<Map<string, AdEngagement>>");
  });
});

describe("a reply on an ad reaches the person it answers", () => {
  it("writes an ad_comment_reply notification pointing at the creative", () => {
    expect(sql).toContain("'ad_comment_reply'");
    expect(sql).toContain("NEW.creative_id");
    expect(sql).toMatch(/'ad_comment_reply:' \|\| NEW\.id::text/);
  });

  it("never notifies you about your own reply", () => {
    expect(sql).toMatch(/_parent_author = NEW\.user_id/);
  });

  it("is phrased in the app in the same words as in SQL", () => {
    expect(ACTION_CATALOG.ad_comment_reply.one).toBe(
      "replied to your comment on a sponsored post.",
    );
    expect(sql).toContain("'replied to your comment on a sponsored post.'");
  });

  it("obeys the member's existing comment-email switch instead of inventing one", () => {
    expect(sql).toMatch(
      /'post_comment', 'comment_reply', 'image_comment', 'ad_comment_reply'\) THEN\s+COALESCE\(\(SELECT email_comments/,
    );
  });

  it("groups like every other reply", () => {
    const groupFn = sql.slice(sql.indexOf("public.notif_group_key("));
    expect(groupFn).toContain("'ad_comment_reply'");
  });
});

describe("the ad has a page, and everything points at it", () => {
  it("routes /ad/:creativeId", () => {
    const app = stripJsComments(read("src/App.tsx"));
    expect(app).toContain('<Route path="/ad/:creativeId" element={<AdDetail />} />');
  });

  it("has one definition of the path", () => {
    expect(adPath("abc")).toBe("/ad/abc");
  });

  it("opens the reply notification on that page and not on /post", () => {
    const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(getNotifLink({ type: "ad_comment_reply", reference_id: ID })).toBe(`/ad/${ID}`);
    expect(getNotifLink({ type: "ad_comment_reply", reference_id: ID })).not.toBe(`/post/${ID}`);
    expect(getNotifLink({ type: "ad_comment_reply", reference_id: null })).toBe("/feed");
  });
});

describe("the admin can get an ad's URL where they upload it", () => {
  const panel = stripJsComments(read("src/components/admin/ads/AdCreativeLibrary.tsx"));

  it("shows the permalink for every creative, with copy and open", () => {
    // Owner, 2026-08-11: "For each Advertisement, each Ad page link how can i
    // get URL during posting time admin panel ??"
    expect(panel).toContain("value={publicUrl(adPath(r.id))}");
    expect(panel).toMatch(/aria-label="Copy this ad's page link"/);
    expect(panel).toMatch(/aria-label="Open this ad's page"/);
  });

  it("builds it from adPath, never by hand", () => {
    // Three places render this URL (the feed card's share, the page itself,
    // and this panel). Assembling it by hand in any of them is how they drift,
    // so the panel must import the one definition and must not concatenate or
    // interpolate a path of its own.
    expect(panel).toContain('import { adPath } from "@/lib/ads/adEngagement"');
    expect(panel).not.toContain("`/ad/${");
    expect(panel).not.toContain('"/ad/" +');
  });
});

describe("nothing is invented when the viewer is signed out", () => {
  it("starts every count at a real zero", () => {
    const e = emptyEngagement("x");
    expect(e).toEqual({
      creativeId: "x",
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      myReaction: null,
      myShared: false,
      reactionCounts: {},
    });
  });
});
