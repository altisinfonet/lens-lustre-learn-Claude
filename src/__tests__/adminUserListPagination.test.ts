import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ADMIN USER LIST — THE DEFECT THIS FILE EXISTS TO PREVENT
 *
 * `admin_search_users` ends its default branch `ORDER BY created_at DESC
 * LIMIT 100`, and AdminUsers.tsx had no paging, so row 101 was unreachable.
 * profiles crossed 100 rows on 2026-08-21 05:14 UTC and the OLDEST profile —
 * the owner's own `50mm Retina World` account, sole holder of the `admin`
 * role — silently disappeared from the admin list.
 *
 * The role filter failed the same way one layer down: holders were fetched
 * from user_roles and then intersected CLIENT-SIDE with the truncated
 * hundred, so filtering by `admin` returned nothing at all.
 *
 * ⚠ HONESTY ABOUT WHAT THIS FILE IS (project rule 7)
 * These are SOURCE PINS, not execution tests. They prove the shape of the
 * code and the SQL, not that a 150-profile database pages correctly. The
 * execution proof is a seeded run against the staging project, recorded
 * separately. A green run here does NOT certify the behaviour — it certifies
 * that the specific mistakes below have not been reintroduced.
 */

const ROOT = join(__dirname, "..", "..");
const ADMIN_USERS = readFileSync(join(ROOT, "src/components/admin/AdminUsers.tsx"), "utf8");

function migrationSource(): string {
  const dir = join(ROOT, "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.includes("admin_user_list_pagination"));
  if (!file) throw new Error("the admin_user_list_pagination migration is missing from supabase/migrations");
  return readFileSync(join(dir, file), "utf8");
}

describe("admin user list — the component", () => {
  it("calls admin_search_users_v2, not the unpaged v1", () => {
    expect(ADMIN_USERS).toContain("admin_search_users_v2");
    // v1 must not be called from this component any more. Matched with a
    // quote so the substring inside "admin_search_users_v2" cannot satisfy it.
    expect(ADMIN_USERS).not.toMatch(/"admin_search_users"/);
  });

  it("passes role and badge to the RPC instead of filtering after the limit", () => {
    expect(ADMIN_USERS).toMatch(/_role:/);
    expect(ADMIN_USERS).toMatch(/_badge:/);
    // The exact shape of the original bug: pre-fetch the holders, build a Set,
    // then filter the already-truncated page against it.
    expect(ADMIN_USERS).not.toMatch(/idSet\.has\(u\.id\)/);
    expect(ADMIN_USERS).not.toMatch(/badgeUserIds/);
    expect(ADMIN_USERS).not.toMatch(/roleUserIds/);
  });

  it("sends a real offset, derived from the page and the page size", () => {
    expect(ADMIN_USERS).toMatch(/_offset:\s*requestedPage\s*\*\s*USERS_PAGE_SIZE/);
    expect(ADMIN_USERS).toMatch(/_limit:\s*USERS_PAGE_SIZE/);
    expect(ADMIN_USERS).toMatch(/const USERS_PAGE_SIZE = 100;/);
  });

  it("reads total_count from the RPC rather than counting the page", () => {
    expect(ADMIN_USERS).toMatch(/total_count/);
    // Counting what came back would report 100 forever — the silent lie.
    expect(ADMIN_USERS).not.toMatch(/setTotalCount\(\s*users\.length\s*\)/);
    expect(ADMIN_USERS).not.toMatch(/setTotalCount\(\s*data\.length\s*\)/);
  });

  it("always tells the admin how many members there are", () => {
    // Both branches must exist: the pager for multi-page sets, and a plain
    // count when everything fits on one page. Silence is what hid the bug.
    expect(ADMIN_USERS).toMatch(/Page \{page \+ 1\} of \{pageCount\}/);
    expect(ADMIN_USERS).toMatch(/totalCount\.toLocaleString\(\)/);
  });

  it("keeps supabase.rpc in call position (RED-1 never returns)", () => {
    // Standing Rule 1. The cast must sit inside the call parentheses.
    expect(ADMIN_USERS).toMatch(/\(supabase\.rpc as unknown as/);
    expect(ADMIN_USERS).not.toMatch(/(?:const|let|var)\s+\w+\s*=\s*supabase\.rpc\s*;/);
  });

  it("does not throw the admin back to page 1 on a realtime repaint", () => {
    expect(ADMIN_USERS).toMatch(/page:\s*currentPage/);
  });
});

describe("admin user list — the migration", () => {
  const SQL = migrationSource();

  it("creates v2 and leaves v1 alone", () => {
    expect(SQL).toMatch(/create or replace function public\.admin_search_users_v2/i);
    expect(SQL).not.toMatch(/drop function[^\n]*admin_search_users\s*\(/i);
  });

  it("keeps the admin authorization check identical to v1", () => {
    expect(SQL).toMatch(/has_role\(auth\.uid\(\),\s*'admin'\)/);
    expect(SQL).toMatch(/raise exception 'Not authorized'/);
    expect(SQL).toMatch(/security definer/i);
    expect(SQL).toMatch(/set search_path to 'public'/i);
  });

  it("filters role and badge inside the SQL, before the limit", () => {
    const body = SQL.slice(SQL.indexOf("with matched as"), SQL.indexOf("order by m.created_at"));
    expect(body).toMatch(/from public\.user_roles ur/);
    expect(body).toMatch(/from public\.user_badges ub/);
    // Both EXISTS clauses must appear ahead of the limit in the statement.
    expect(SQL.indexOf("user_roles ur")).toBeLessThan(SQL.indexOf("limit v_limit"));
    expect(SQL.indexOf("user_badges ub")).toBeLessThan(SQL.indexOf("limit v_limit"));
  });

  it("returns the count of the filtered set, not of the page", () => {
    expect(SQL).toMatch(/count\(\*\) over \(\)\s+as total_count/);
  });

  it("orders by a total order so pages cannot overlap or skip", () => {
    // created_at alone is not unique; ties can reorder between two queries and
    // put the same member on page 1 and page 2, or on neither.
    expect(SQL).toMatch(/order by m\.created_at desc, m\.id desc/);
  });

  it("clamps limit and offset rather than trusting the caller", () => {
    expect(SQL).toMatch(/least\(greatest\(coalesce\(_limit, 100\), 1\), 200\)/);
    expect(SQL).toMatch(/greatest\(coalesce\(_offset, 0\), 0\)/);
  });

  it("closes the function to PUBLIC and anon", () => {
    expect(SQL).toMatch(/revoke all on function public\.admin_search_users_v2[^\n]*from public/i);
    expect(SQL).toMatch(/revoke all on function public\.admin_search_users_v2[^\n]*from anon/i);
    expect(SQL).toMatch(/grant execute on function public\.admin_search_users_v2[^\n]*to authenticated/i);
  });

  it("indexes the ordering it depends on", () => {
    // profiles had NO index on created_at. Every list load was a scan + sort.
    expect(SQL).toMatch(/create index if not exists idx_profiles_created_at_id_desc/);
    expect(SQL).toMatch(/on public\.profiles \(created_at desc, id desc\)/);
  });

  it("ships with a rollback", () => {
    const dir = join(ROOT, "supabase/rollback");
    const rb = readdirSync(dir).find((f) => f.includes("admin_user_list_pagination"));
    expect(rb, "no rollback file for the admin pagination migration").toBeTruthy();
    const body = readFileSync(join(dir, rb as string), "utf8");
    expect(body).toMatch(/drop function if exists public\.admin_search_users_v2/);
  });
});
