/**
 * Admin → Users — "Filter by platform": All · App users · Web users · Unknown.
 *
 * Owner, 2026-10-30: "give small tabs: All, App users, Web users, Unknown."
 *
 * The list is paged (100 per page), so a tab must filter on the SERVER, across
 * every page, and its count must describe the whole matching set — not the 100
 * rows loaded. This renders the real component against a fake server holding
 * 250 synthetic members (125 web · 63 app · 62 unknown — the same split as the
 * SQL fixture supabase/tests/admin-platform-filter/20_behaviour.sql) that
 * implements admin_search_users_v2 / _v3 / admin_user_platform_counts the way
 * 20261103_0101 does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

type Member = { id: string; email: string; full_name: string; created_at: string; last_platform: "app" | "web" | null; roles: string[] };

const MEMBERS: Member[] = Array.from({ length: 250 }, (_, k) => {
  const i = k + 1;
  return {
    id: `m-${String(i).padStart(3, "0")}`,
    email: `m${String(i).padStart(3, "0")}@fixture.invalid`,
    full_name: `${i % 5 === 0 ? "Alpha" : "Member"} ${i}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
    last_platform: i % 2 === 0 ? "web" : i % 4 === 1 ? "app" : null,
    roles: ["user", ...(i % 3 === 0 ? ["judge"] : [])],
  };
});

let v3Installed = true;
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

function matching(args: Record<string, unknown>) {
  const q = String(args._query ?? "").toLowerCase();
  return MEMBERS.filter((m) =>
    (!q || (args._by === "email" ? m.email : m.full_name).toLowerCase().includes(q)) &&
    (!args._role || m.roles.includes(String(args._role))));
}

function rpc(fn: string, args: Record<string, unknown>) {
  rpcCalls.push({ fn, args });
  if (fn === "admin_search_users_v3" || fn === "admin_user_platform_counts") {
    if (!v3Installed) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } });
  }
  if (fn === "admin_user_platform_counts") {
    const s = matching(args);
    return Promise.resolve({ data: [{
      all_count: s.length,
      app_count: s.filter((m) => m.last_platform === "app").length,
      web_count: s.filter((m) => m.last_platform === "web").length,
      unknown_count: s.filter((m) => m.last_platform === null).length,
    }], error: null });
  }
  if (fn === "admin_search_users_v3" || fn === "admin_search_users_v2") {
    const p = fn === "admin_search_users_v3" ? (args._platform as string | null) : null;
    const s = matching(args)
      .filter((m) => !p || (p === "unknown" ? m.last_platform === null : m.last_platform === p))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const off = Number(args._offset ?? 0);
    const page = s.slice(off, off + Number(args._limit ?? 100));
    return Promise.resolve({ data: page.map((m) => ({
      id: m.id, email: m.email, full_name: m.full_name, avatar_url: null, bio: null,
      is_suspended: false, suspended_until: null, suspension_reason: null, created_at: m.created_at, total_count: s.length,
    })), error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

function from(table: string) {
  return {
    select: () => ({
      in: (_col: string, ids: string[]) => {
        const rows = MEMBERS.filter((m) => ids.includes(m.id));
        if (table === "user_roles") return Promise.resolve({ data: rows.flatMap((m) => m.roles.map((role) => ({ user_id: m.id, role }))), error: null });
        if (table === "user_badges") return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: rows.map((m) => ({ id: m.id, last_active_at: null, last_platform: m.last_platform })), error: null });
      },
    }),
  };
}

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args), from, channel: () => channel, removeChannel: () => {} } };
});
vi.mock("@/hooks/profile/useMemberHandles", () => ({ useMemberHandles: () => new Map() }));
vi.mock("@/lib/presence/online", () => ({ useOnlineIds: () => new Set<string>() }));
vi.mock("@/hooks/profile/useBadgeDefinitions", () => ({ useBadgeDefinitions: () => new Map() }));
vi.mock("@/hooks/profile/useRoleDefinitions", () => ({ useRoleDefinitions: () => new Map() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }) }));
vi.mock("@/components/AutoRole", () => ({ invalidateRoleCache: () => {} }));
vi.mock("@/hooks/core/use-toast", () => ({ toast: () => {} }));
vi.mock("@/i18n/I18nContext", () => ({
  useT: () => (k: string, fallback?: string) =>
    ({ "dash.status.all": "All", "au.filterByRole": "Filter by role", "au.filterByBadge": "Filter by badge", "common.search": "Search" } as Record<string, string>)[k] ?? fallback ?? k,
}));

import AdminUsers from "@/components/admin/AdminUsers";

const platformChips = () => Array.from(document.querySelectorAll("[data-testid^='platform-tab-']")).map((b) => b.textContent?.trim());
const rowIds = () => Array.from(document.querySelectorAll("[data-member-id]")).map((el) => el.getAttribute("data-member-id") as string);
const lastCall = (fn: string) => [...rpcCalls].reverse().find((c) => c.fn === fn)?.args;

beforeEach(() => { rpcCalls.length = 0; v3Installed = true; });

describe("Admin → Users: Filter by platform", { timeout: 30_000 }, () => {
  it("shows All · App users · Web users · Unknown, each with the count of the WHOLE list", async () => {
    render(<AdminUsers user={null} />);
    expect(await screen.findByText(/Filter by platform/i)).toBeTruthy();
    await waitFor(() => expect(platformChips()).toEqual(["All (250)", "App users (63)", "Web users (125)", "Unknown (62)"]));
  });

  it("'Web users' lists only web members, across both pages, filtered on the server", async () => {
    render(<AdminUsers user={null} />);
    await waitFor(() => expect(platformChips()).toContain("Web users (125)"));
    fireEvent.click(screen.getByTestId("platform-tab-web"));

    await waitFor(() => expect(lastCall("admin_search_users_v3")).toMatchObject({ _platform: "web", _offset: 0 }));
    await screen.findByText(/Page 1 of 2 — 125 members/);
    const seen = new Set(rowIds());
    expect(seen.size).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(lastCall("admin_search_users_v3")).toMatchObject({ _platform: "web", _offset: 100 }));
    await screen.findByText(/Page 2 of 2 — 125 members/);
    for (const id of rowIds()) seen.add(id);

    const web = MEMBERS.filter((m) => m.last_platform === "web").map((m) => m.id);
    expect([...seen].sort()).toEqual(web.sort());
    // every row on screen carries the Website chip, none App / Unknown
    expect(screen.queryAllByText("App", { exact: true })).toHaveLength(0);
    expect(screen.queryAllByText("Unknown", { exact: true })).toHaveLength(0);
  });

  it("'Unknown' lists the members with no recorded platform; combines with the role filter and recounts", async () => {
    render(<AdminUsers user={null} />);
    await waitFor(() => expect(platformChips()).toContain("Unknown (62)"));
    fireEvent.click(screen.getByTestId("platform-tab-unknown"));
    await screen.findByText(/^62 members$/);
    expect(screen.queryAllByText("Website", { exact: true })).toHaveLength(0);

    const roleRow = screen.getByText(/Filter by role/).parentElement as HTMLElement;
    fireEvent.click(within(roleRow).getByText(/Jury/));
    await waitFor(() => expect(lastCall("admin_search_users_v3")).toMatchObject({ _platform: "unknown", _role: "judge" }));
    await waitFor(() => expect(lastCall("admin_user_platform_counts")).toMatchObject({ _role: "judge" }));
    const judges = MEMBERS.filter((m) => m.roles.includes("judge"));
    const n = (p: Member["last_platform"]) => judges.filter((m) => m.last_platform === p).length;
    await waitFor(() => expect(platformChips()).toEqual([
      `All (${judges.length})`, `App users (${n("app")})`, `Web users (${n("web")})`, `Unknown (${n(null)})`,
    ]));
    await screen.findByText(new RegExp(`^${n(null)} members$`));
  });

  it("before 20261103_0101 is applied: falls back to v2, list still works, platform row hidden", async () => {
    v3Installed = false;
    render(<AdminUsers user={null} />);
    await screen.findByText(/Page 1 of 3 — 250 members/);
    expect(rpcCalls.some((c) => c.fn === "admin_search_users_v2")).toBe(true);
    expect(screen.queryByText(/Filter by platform/i)).toBeNull();
  });
});
