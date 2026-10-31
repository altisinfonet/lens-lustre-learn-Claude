/**
 * Admin → Video Feature → Video Conversion (CONVERTER-DESIGN.md v2 §8):
 *   • shows what is SAVED (site_settings read by its key, fresh) and what each
 *     choice means in plain words;
 *   • Save writes through the admin settings path — an upsert of
 *     site_settings 'video_conversion' = "device" | "server" with who did it
 *     (RLS: admins only; the table's audit trigger records it) — and drops
 *     this device's cached copy;
 *   • a refused write (not an admin) is said, nothing changes;
 *   • the history comes from the audit trail (db_audit_logs);
 *   • only full admins reach the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

type Q = { table: string; select?: string; filters: Array<[string, string, unknown]>; order?: string; limit?: number };
const reads: Q[] = [];
const upserts: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
let stored: { value: unknown; updated_at: string | null; updated_by: string | null } | null = { value: "device", updated_at: "2026-10-12T09:00:00Z", updated_by: "admin1" };
let upsertError: { message: string } | null = null;
let audit: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: Q = { table, filters: [] };
      const chain = {
        select(s: string) { q.select = s; reads.push(q); return chain; },
        eq(c: string, v: unknown) { q.filters.push(["eq", c, v]); return chain; },
        in(c: string, v: unknown) { q.filters.push(["in", c, v]); return Promise.resolve({ data: [{ id: "admin1", full_name: "Neil" }], error: null }); },
        order(c: string) { q.order = c; return chain; },
        limit(n: number) { q.limit = n; return Promise.resolve({ data: audit, error: null }); },
        maybeSingle() { return Promise.resolve({ data: stored, error: null }); },
        upsert(row: Record<string, unknown>, opts: unknown) {
          upserts.push({ row, opts });
          if (!upsertError && stored) stored = { ...stored, value: row.value, updated_by: String(row.updated_by), updated_at: String(row.updated_at) };
          return Promise.resolve({ data: null, error: upsertError });
        },
      };
      return chain;
    },
  },
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "admin1" } }) }));
const toast = vi.fn();
vi.mock("@/hooks/core/use-toast", () => ({ toast: (a: unknown) => toast(a) }));
const invalidated: string[] = [];
vi.mock("@/lib/siteSettingsCache", () => ({ invalidateSiteSetting: (k: string) => { invalidated.push(k); }, getSiteSetting: async () => null }));

import AdminVideoConversion from "../AdminVideoConversion";
import { canAccessTab, resolveAdminSubRoles } from "@/lib/adminRoleAccess";

beforeEach(() => {
  reads.length = 0; upserts.length = 0; invalidated.length = 0; toast.mockClear(); upsertError = null; audit = [];
  stored = { value: "device", updated_at: "2026-10-12T09:00:00Z", updated_by: "admin1" };
});

const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const saveBtn = () => screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;

describe("Admin → Video Conversion", () => {
  it("shows what is saved — read by its key — and what each choice means", async () => {
    render(<AdminVideoConversion />);
    expect(await screen.findByTestId("conversion-status")).toHaveTextContent("On the member's device");
    expect(reads.find((r) => r.table === "site_settings")).toMatchObject({ select: "value, updated_at, updated_by", filters: [["eq", "key", "video_conversion"]] });
    expect(radio(/On the member's device/).checked).toBe(true);
    expect(radio(/On our server \(Oracle\)/).checked).toBe(false);
    expect(screen.getByText(/the page must stay open and in front/)).toBeTruthy();
    expect(screen.getByText(/They can close the page once the upload reaches 100%/)).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(/Last changed .* by Neil/)).toBeTruthy();
  });

  it("choosing the server warns when to use it; Save upserts video_conversion = \"server\" with who did it", async () => {
    render(<AdminVideoConversion />);
    await screen.findByTestId("conversion-status");
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(radio(/On our server \(Oracle\)/));
    expect(screen.getByRole("note")).toHaveTextContent("only while the converter is running");
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upserts).toHaveLength(1));
    const { row, opts } = upserts[0];
    expect(row).toMatchObject({ key: "video_conversion", value: "server", updated_by: "admin1" });
    expect(Date.parse(String(row.updated_at))).not.toBeNaN();
    expect(opts).toEqual({ onConflict: "key" });
    expect(invalidated).toEqual(["video_conversion"]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Video conversion: On our server (Oracle)" }));
    await waitFor(() => expect(screen.getByTestId("conversion-status")).toHaveTextContent("On our server"));
    expect(saveBtn().disabled).toBe(true);
  });

  it("back to the device is the same write with \"device\"", async () => {
    stored = { value: "server", updated_at: null, updated_by: null };
    render(<AdminVideoConversion />);
    expect(await screen.findByTestId("conversion-status")).toHaveTextContent("On our server");
    fireEvent.click(radio(/On the member's device/));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upserts[0]?.row).toMatchObject({ key: "video_conversion", value: "device" }));
  });

  it("a refused write (not an admin: RLS) is said, and nothing changes", async () => {
    upsertError = { message: "new row violates row-level security policy for table \"site_settings\"" };
    render(<AdminVideoConversion />);
    await screen.findByTestId("conversion-status");
    fireEvent.click(radio(/On our server/));
    fireEvent.click(saveBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("row-level security");
    expect(toast).not.toHaveBeenCalled();
    expect(screen.getByTestId("conversion-status")).toHaveTextContent("On the member's device");
  });

  it("the history comes from the audit trail, newest first, without saves that changed nothing", async () => {
    audit = [
      { created_at: "2026-10-12T10:00:00Z", changed_by: "admin1", old_data: { value: "server" }, new_data: { value: "device" } },
      { created_at: "2026-10-12T09:30:00Z", changed_by: "admin1", old_data: { value: "server" }, new_data: { value: "server" } },
      { created_at: "2026-10-12T09:00:00Z", changed_by: "admin1", old_data: { value: "device" }, new_data: { value: "server" } },
      { created_at: "2026-10-12T08:00:00Z", changed_by: null, old_data: null, new_data: { value: "device" } },
    ];
    render(<AdminVideoConversion />);
    await screen.findByTestId("conversion-status");
    expect(reads.find((r) => r.table === "db_audit_logs")).toMatchObject({
      filters: [["eq", "table_name", "site_settings"], ["eq", "row_id", "video_conversion"]], order: "created_at", limit: 10,
    });
    const summary = await screen.findByText("History (3)");
    const items = within(summary.closest("details")!).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/Neil chose On the member's device \(was On our server \(Oracle\)\)/);
    expect(items[1]).toMatch(/Neil chose On our server \(Oracle\) \(was On the member's device\)/);
    expect(items[2]).toMatch(/system chose On the member's device$/);
  });

  it("review #423: Save is a 44px target, like every other control", async () => {
    render(<AdminVideoConversion />);
    await screen.findByTestId("conversion-status");
    expect(saveBtn().className).toMatch(/min-h-11/);
    expect(saveBtn().className).not.toMatch(/(^|\s)h-9(\s|$)/); // the 36px height it had
  });

  it("only a full admin reaches the page", () => {
    expect(canAccessTab(resolveAdminSubRoles(["admin"]), "video_conversion")).toBe(true);
    for (const role of ["moderator", "finance", "content_editor", "judge"]) {
      expect(canAccessTab(resolveAdminSubRoles([role]), "video_conversion")).toBe(false);
    }
  });
});
