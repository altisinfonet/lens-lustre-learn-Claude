/**
 * SEO plan step B: the readable page robots get (supabase/functions/
 * seo-route-metadata/readable.ts). Escaping is the safety line — a caption is
 * member text and must never become markup in our HTML.
 */
import { describe, expect, it } from "vitest";
import { captionTags, esc, listBody, postBody, snippet } from "../../supabase/functions/seo-route-metadata/readable";

const SITE = "https://www.50mmretina.com";

describe("readable pages for robots (step B)", () => {
  it("a caption can never become markup", () => {
    const html = postBody({
      url: `${SITE}/x/post/1`, path: "/x/post/1", author: `Eve <script>alert(1)</script>`,
      caption: `nice "shot" <img src=x onerror=alert(1)> #Street`, date: "2026-11-09T10:00:00Z",
      likes: 3, comments: 1, tags: ["street"], image: `https://cdn/x.jpg" onerror="alert(1)`,
    }, SITE);
    expect(html).not.toMatch(/<script|<img src=x|onerror="alert/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://www.50mmretina.com/hashtag/street"');
  });

  it("a post page carries the facts a member sees", () => {
    const html = postBody({
      url: `${SITE}/neil.basu/post/1`, path: "/neil.basu/post/1", author: "Neil Basu", authorUrl: `${SITE}/neil.basu`,
      caption: "Morning fog on the river.", date: "2026-11-09T10:00:00Z", likes: 12, comments: 3, tags: [],
      image: "https://cdn.50mmretina.com/p.webp",
    }, SITE);
    expect(html).toContain("<h1>Photo by Neil Basu</h1>");
    expect(html).toContain("Morning fog on the river.");
    expect(html).toContain('alt="Morning fog on the river. — photo by Neil Basu"');
    expect(html).toContain("2026-11-09");
    expect(html).toContain("12 likes · 3 comments");
    expect(html).toContain(`href="${SITE}/neil.basu"`);
  });

  it("list pages link every item", () => {
    const html = listBody("hashtag", "#street photography", "3 posts by 2 photographers.", [
      { url: `${SITE}/a/post/1`, title: "One — photo by A" },
      { url: `${SITE}/b/post/2`, title: "Two — photo by B", image: "https://cdn/2.webp" },
    ], SITE);
    expect(html.match(/<li>/g)?.length).toBe(2);
    expect(html).toContain('data-seo-readable="hashtag"');
  });

  it("helpers", () => {
    expect(esc(`a&b<"c">'`)).toBe("a&amp;b&lt;&quot;c&quot;&gt;&#39;");
    expect(snippet("one two three four", 10)).toBe("one two…");
    expect(captionTags("#Street and #street #NIGHT_2026 #")).toEqual(["street", "night_2026"]);
  });
});
