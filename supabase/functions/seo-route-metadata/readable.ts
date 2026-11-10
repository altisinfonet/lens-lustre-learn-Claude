/**
 * SEO plan step B (Owner 2026-11-09: "50mm posts must be fetched anywhere on
 * searching"). AI answer robots (ChatGPT, Perplexity, Claude) do not run the
 * app's JavaScript, so a page they fetch was ~70 characters: the site name.
 *
 * This builds the READABLE PAGE: plain HTML with the same facts the member
 * sees — photographer, caption, hashtags, date, photo, counts — which the Pages
 * middleware puts inside <div id="root">. People never see it: the brand loader
 * covers the screen and React replaces #root's content when the app starts.
 * Robots that do not run JavaScript read it. Same content, so not cloaking.
 *
 * Only PUBLIC content ever reaches this file (callers check privacy first).
 */

import { captionHashtagKeys } from "../_shared/hashtagRule.ts";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A caption's first words, for a title or an alt text. */
export function snippet(text: string | null | undefined, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "").trim() + "…";
}

/** Hashtags in a caption — THE hashtag rule (_shared/hashtagRule.ts = public.extract_hashtags). */
export function captionTags(text: string | null | undefined): string[] {
  return captionHashtagKeys(text);
}

export interface ReadablePost {
  url: string;            // canonical, absolute
  path: string;           // site path of the post
  author: string;         // display name
  authorUrl?: string;     // absolute profile URL
  caption: string;
  image?: string;
  date: string;           // ISO
  likes: number;
  comments: number;
  tags: string[];
}

const fmtDate = (iso: string) => {
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return ""; }
};

/** The post page, as a robot that does not run JavaScript should read it. */
export function postBody(p: ReadablePost, site: string): string {
  const alt = p.caption ? `${snippet(p.caption, 120)} — photo by ${p.author}` : `Photo by ${p.author}`;
  let h = `<main data-seo-readable="post"><article>`;
  h += `<h1>Photo by ${esc(p.author)}</h1>`;
  if (p.image) h += `<img src="${esc(p.image)}" alt="${esc(alt)}" loading="lazy">`;
  if (p.caption) h += `<p>${esc(p.caption)}</p>`;
  if (p.tags.length) {
    h += `<p>Hashtags: ${p.tags.map((t) => `<a href="${esc(`${site}/hashtag/${encodeURIComponent(t)}`)}">#${esc(t)}</a>`).join(" ")}</p>`;
  }
  h += `<p>Posted ${esc(fmtDate(p.date))} on 50mm Retina World · ${p.likes} likes · ${p.comments} comments</p>`;
  if (p.authorUrl) h += `<p><a href="${esc(p.authorUrl)}">More photographs by ${esc(p.author)}</a></p>`;
  h += `</article><nav><a href="${esc(site)}/">50mm Retina World — photography community, competitions and courses</a></nav></main>`;
  return h;
}

export interface ReadableItem { url: string; title: string; image?: string }

/** A list page (profile, hashtag): heading, intro and links to its posts. */
export function listBody(kind: string, heading: string, intro: string, items: ReadableItem[], site: string): string {
  let h = `<main data-seo-readable="${esc(kind)}"><h1>${esc(heading)}</h1>`;
  if (intro) h += `<p>${esc(intro)}</p>`;
  if (items.length) {
    h += `<ul>`;
    for (const it of items) {
      h += `<li><a href="${esc(it.url)}">${esc(it.title)}</a>`;
      if (it.image) h += ` <img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy">`;
      h += `</li>`;
    }
    h += `</ul>`;
  }
  h += `<nav><a href="${esc(site)}/">50mm Retina World — photography community, competitions and courses</a></nav></main>`;
  return h;
}
