import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import UserIdentityBlock from "@/components/UserIdentityBlock";

/**
 * F-98 — A MEMBER'S NAME MUST BE A LINK TO THEIR NAME-URL. BOTH DIRECTIONS.
 *
 * F-95's check asserted that no id address is ever built, and it passed. It
 * passed on /discover with TWENTY-NINE anchors and ZERO member links, because
 * "no bad links" and "no links at all" are the same number. I proved the bad
 * thing gone and never once proved the good thing still present — on the page
 * the Owner opened first.
 *
 * That is the same defect as C-87 and C-88 in a third shape: an instrument that
 * could not fail on the outcome it existed to protect. So this asserts the
 * POSITIVE: a rendered member name is inside an anchor whose href is that
 * member's handle. A page with no links fails it.
 *
 * AND IT IS COUPLED TO THE REAL QUERY, deliberately. Every card in the app was
 * already passing handle={profile.custom_url} correctly — DiscoverCard included.
 * The names went dead because the PAGE QUERY never selected the column, so the
 * prop was forever undefined and the no-handle branch fired on members who all
 * have handles. A test that hands the component a well-formed object would have
 * passed while /discover was broken. These build the object from the columns
 * the page actually asks the database for, so the only way to make them pass is
 * to make the handle genuinely arrive.
 */

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Every column a file's profile query actually selects. */
function selectedColumns(relPath: string): string[] {
  const src = readFileSync(join(process.cwd(), relPath), "utf8");
  const m = src.match(/\.select\("([^"]*full_name[^"]*)"\)/);
  if (!m) throw new Error(`no profile select found in ${relPath}`);
  return m[1].split(",").map((c) => c.trim());
}

/** The row as that page would really receive it — nothing the query omits. */
function asPageReceivesIt(relPath: string) {
  const full: Record<string, unknown> = {
    id: "11111111-2222-4333-8444-555555555555",
    full_name: "Marlowe Ashgrove",
    custom_url: "marlowe.ashgrove",
    avatar_url: null,
    bio: null,
    photography_interests: [],
    created_at: "2026-01-05T00:00:00.000Z",
    current_city: null,
    last_active_at: null,
  };
  const projected: Record<string, unknown> = {};
  for (const col of selectedColumns(relPath)) {
    if (col in full) projected[col] = full[col];
  }
  return projected as { id: string; full_name: string; custom_url?: string | null };
}

function renderName(row: { id: string; full_name: string; custom_url?: string | null }) {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <UserIdentityBlock
          userId={row.id}
          name={row.full_name}
          handle={row.custom_url}
          badges={[]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The pages the Owner and the Auditor actually opened, plus the ones that share
 * their shape. Named individually so a failure says WHICH surface is dead.
 */
const SURFACES: Array<[string, string]> = [
  ["Discover", "src/pages/Discover.tsx"],
  ["Index (home)", "src/pages/Index.tsx"],
  ["Friends", "src/pages/Friends.tsx"],
  ["Search", "src/hooks/search/useSearch.ts"],
  ["Mentions (caption)", "src/hooks/feed/useCaptionMentions.ts"],
  ["Tag people", "src/components/post/TagPeopleModal.tsx"],
  ["Mention input", "src/components/MentionInput.tsx"],
  ["Profile activity feed", "src/components/profile/ProfileActivityFeed.tsx"],
];

describe("F-98 — a member's name is a link to their name-URL, on every surface", () => {
  it.each(SURFACES)(
    "%s: the name renders inside an anchor to the member's handle",
    (label, relPath) => {
      const row = asPageReceivesIt(relPath);
      const { getByText } = renderName(row as any);
      const el = getByText("Marlowe Ashgrove");
      const anchor = el.closest("a");
      expect(
        anchor,
        `${label} renders the member's name as a DEAD ${el.tagName}. ` +
          `Its query selects [${selectedColumns(relPath).join(", ")}] — ` +
          `custom_url is not among them, so the handle never arrives and the ` +
          `no-handle branch fires on a member who has one.`,
      ).not.toBeNull();
      expect(anchor?.getAttribute("href")).toBe("/marlowe.ashgrove");
    },
  );
});

describe("F-98 — the handle arrives wherever the name arrives", () => {
  /**
   * The data-layer half. Every query that fetches a member's name must fetch
   * their handle in the same round trip. This is the PostCard author_badges
   * rule, which this codebase has now paid for twice: an identity field that
   * does not travel with the name creates a state where the name is visible
   * and the identity is not. There it cost a member their verified tick. Here
   * it cost them their entire link.
   */
  it("no profile query selects full_name without custom_url", () => {
    const hits = execSync(
      `grep -rnoE '\\.select\\("[^"]*full_name[^"]*"\\)' src --include=*.ts --include=*.tsx ` +
        `| grep -v __tests__ | grep -v uiharness | grep -v custom_url || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(
      hits.length,
      `${hits.length} quer(ies) fetch a member's name without their handle:\n` +
        hits.map((h) => `  ${h}`).join("\n") +
        `\n\nEvery one renders a name somewhere. Where the handle does not ` +
        `arrive with it, that name goes dead.`,
    ).toBe(0);
  });
});

describe("F-98 — the check itself can fail", () => {
  it("a name with no handle is reported, not quietly passed", () => {
    // Guards the guard: this is the exact state /discover was in.
    const { getByText } = renderName({
      id: "x",
      full_name: "Marlowe Ashgrove",
      custom_url: undefined,
    });
    expect(getByText("Marlowe Ashgrove").closest("a")).toBeNull();
  });

  it("a name with a handle really does link", () => {
    const { getByText } = renderName({
      id: "x",
      full_name: "Marlowe Ashgrove",
      custom_url: "marlowe.ashgrove",
    });
    expect(getByText("Marlowe Ashgrove").closest("a")?.getAttribute("href")).toBe(
      "/marlowe.ashgrove",
    );
  });
});
