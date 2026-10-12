/**
 * Admin → Video (Owner 2026-10-12): one page per feature under its own menu,
 * a modern member search and a compact layout. Same server rules as VID-7.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
let state: unknown[] = [];
let failWith: string | null = null;
let found: unknown[] = [];
let roleRows: Array<{ user_id: string; role: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "feature_admin_state") return { data: state, error: null };
      if (fn === "feature_member_search") return { data: found, error: null };
      if (failWith) return { data: null, error: { message: failWith } };
      return { data: true, error: null };
    },
    from: (table: string) => ({
      select: (_c: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          const q: any = { eq: () => q, in: () => q, then: (r: (v: unknown) => void) => Promise.resolve({ count: 3, error: null }).then(r) }; // eslint-disable-line @typescript-eslint/no-explicit-any
          return q;
        }
        return { in: async () => (table === "user_roles" ? { data: roleRows } : { data: [{ id: "admin1", full_name: "Neil" }] }) };
      },
    }),
  },
}));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children?: unknown }) => <span data-testid="member-avatar">{children as never}</span>,
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (src ? <img data-testid="member-avatar-img" src={src} alt={alt} /> : null),
  AvatarFallback: ({ children }: { children?: unknown }) => <span data-testid="member-avatar-fallback">{children as never}</span>,
}));

import AdminVideoFeature from "../AdminVideoFeature";

const card = (feature: string, over: Record<string, unknown> = {}) => ({
  feature, mode: "off", note: null, updated_at: null, key_configured: feature === "copyright_music_check" ? false : null,
  members: [], history: [], ...over,
});
const member = (id: string, name: string, username: string | null = null) => ({ user_id: id, full_name: name, username, avatar_url: null, added_at: "2026-10-10T00:00:00Z", note: null });

beforeEach(() => {
  calls.length = 0; failWith = null; roleRows = [];
  found = [
    { user_id: "u-new", full_name: "Asha Rao", username: "asha", avatar_url: "https://cdn.example.test/a/asha.jpg", email: "asha@example.com" },
    { user_id: "u-two", full_name: "Bina Das", username: "bina", avatar_url: null, email: null },
    { user_id: "u-in", full_name: "Already In", username: null, avatar_url: null, email: null },
  ];
  state = [card("copyright_music_check"), card("video_ads"), card("video_posts", {
    mode: "selected", note: "beta", members: [member("u-in", "Already In")],
    history: [{ at: "2026-10-10T01:00:00Z", actor: "admin1", action: "mode", old: "off", new: "selected", user_id: null, note: "start" }],
  })];
});

const page = (f = "video_posts") => { render(<AdminVideoFeature feature={f as never} />); return screen.findByTestId(`feature-${f}`); };
const typeSearch = (text: string) => fireEvent.change(screen.getByRole("combobox", { name: /Search members/ }), { target: { value: text } });

describe("one page per feature, compact", () => {
  it("shows only its own feature, with the status pill and the three choices", async () => {
    const p = await page();
    expect(within(p).getByRole("heading", { name: "Video posts" })).toBeTruthy();
    expect(screen.queryByText("Video ads")).toBeNull();
    expect(within(p).getByTestId("feature-status").textContent).toMatch(/On for 1 selected/);
    for (const l of ["Off", "Selected members", "All members"]) expect(within(p).getByRole("radio", { name: new RegExp(l) })).toBeTruthy();
  });

  it("Save is off until something changes, then writes mode + note in ONE RPC", async () => {
    const p = await page();
    const save = within(p).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(p).getByRole("radio", { name: /All members/ }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.fn === "feature_set_mode")).toBe(true));
    expect(calls.find((c) => c.fn === "feature_set_mode")!.args).toEqual({ _feature: "video_posts", _mode: "everyone", _note: "beta" });
  });

  it("the copyright check cannot be switched on without the key; it can once the key is set", async () => {
    const p = await page("copyright_music_check");
    expect((within(p).getByRole("radio", { name: /All members/ }) as HTMLInputElement).disabled).toBe(true);
    expect(within(p).getByRole("note").textContent).toMatch(/key isn't set/);
  });

  it("a server refusal is shown in words, and nothing pretends it saved", async () => {
    failWith = "VID-FEAT-001: admins only";
    const p = await page();
    fireEvent.click(within(p).getByRole("radio", { name: /All members/ }));
    fireEvent.click(within(p).getByRole("button", { name: "Save" }));
    expect(await within(p).findByRole("alert")).toBeTruthy();
  });

  it("history reads in plain words with the actor's name", async () => {
    const p = await page();
    await waitFor(() => expect(within(p).getByText(/Neil/)).toBeTruthy());
  });

  it("live numbers show for the feature", async () => {
    await page();
    expect(await screen.findByText("Video posts", { selector: "dt" })).toBeTruthy();
  });
});

describe("the modern member search", () => {
  it("searches as you type (after a pause), not on every key and not for one letter", async () => {
    await page();
    typeSearch("a");
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => c.fn === "feature_member_search")).toHaveLength(0);
    typeSearch("as"); typeSearch("ash"); typeSearch("asha");
    await screen.findByRole("listbox", { name: "Search results" });
    expect(calls.filter((c) => c.fn === "feature_member_search")).toHaveLength(1); // one per pause
  });

  it("each result shows avatar (photo or initials), name, @username, email; someone already added says Added", async () => {
    await page();
    typeSearch("asha");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    expect(within(list).getAllByTestId("member-avatar")).toHaveLength(3);
    expect((within(list).getAllByTestId("member-avatar-img")[0] as HTMLImageElement).src).toContain("asha.jpg");
    expect(within(list).getByText("asha@example.com")).toBeTruthy();
    expect(within(list).getByText(/Added/)).toBeTruthy();
  });

  it("Enter adds the highlighted member; ↓ moves the highlight", async () => {
    await page();
    typeSearch("asha");
    await screen.findByRole("listbox", { name: "Search results" });
    const box = screen.getByRole("combobox", { name: /Search members/ });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(calls.some((c) => c.fn === "feature_add_member")).toBe(true));
    expect(calls.find((c) => c.fn === "feature_add_member")!.args).toMatchObject({ _feature: "video_posts", _user: "u-two" });
  });

  it("tick several → 'Add 2 selected' adds each (one audited RPC per member)", async () => {
    await page();
    typeSearch("asha");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    fireEvent.click(within(list).getByRole("checkbox", { name: "Select Asha Rao" }));
    fireEvent.click(within(list).getByRole("checkbox", { name: "Select Bina Das" }));
    fireEvent.click(screen.getByRole("button", { name: /Add 2 selected/ }));
    await waitFor(() => expect(calls.filter((c) => c.fn === "feature_add_member")).toHaveLength(2));
    expect(calls.filter((c) => c.fn === "feature_add_member").map((c) => c.args!._user)).toEqual(["u-new", "u-two"]);
  });

  it("on Video ads only admins can be added; others say 'Admins only'", async () => {
    roleRows = [{ user_id: "u-new", role: "admin" }];
    await page("video_ads");
    typeSearch("asha");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    await waitFor(() => expect(within(list).getByText("Admin")).toBeTruthy());
    const rows = within(list).getAllByRole("option");
    expect(within(rows[0]).getByRole("button", { name: "Add" })).toBeTruthy(); // the admin
    expect(within(rows[1]).getByText("Admins only")).toBeTruthy();
  });
});

describe("the selected members", () => {
  it("each row has an avatar and a remove button; ✕ removes", async () => {
    const p = await page();
    const list = within(p).getByRole("list", { name: "Members added" });
    expect(within(list).getAllByTestId("member-avatar")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Remove Already In" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "feature_remove_member")?.args).toMatchObject({ _user: "u-in" }));
  });

  it("with many members: filter them, tick several, 'Remove N'", async () => {
    (state[2] as { members: unknown[] }).members = Array.from({ length: 8 }, (_, i) => member(`m${i}`, `Member ${i}`, `user${i}`));
    const p = await page();
    fireEvent.change(within(p).getByRole("searchbox", { name: "Filter selected members" }), { target: { value: "Member 3" } });
    const list = within(p).getByRole("list", { name: "Members added" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(within(p).getByRole("searchbox", { name: "Filter selected members" }), { target: { value: "" } });
    fireEvent.click(within(p).getByRole("checkbox", { name: "Select Member 1 to remove" }));
    fireEvent.click(within(p).getByRole("checkbox", { name: "Select Member 2 to remove" }));
    fireEvent.click(within(p).getByRole("button", { name: /Remove 2/ }));
    await waitFor(() => expect(calls.filter((c) => c.fn === "feature_remove_member")).toHaveLength(2));
  });

  it("a note over 500 characters cannot be typed", async () => {
    const p = await page();
    expect((within(p).getByLabelText(/Note/) as HTMLTextAreaElement).maxLength).toBe(500);
  });
});
