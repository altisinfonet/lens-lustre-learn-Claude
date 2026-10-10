/**
 * VID-7 / R-103 · the Features page as an admin meets it: three words, Save only
 * when something changed, members as chips with ✕, search → Add, the copyright
 * check refused without the key, history. The server is faked; what is asserted
 * is which RPC is called with which arguments.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
let state: unknown[] = [];
let failWith: string | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "feature_admin_state") return { data: state, error: null };
      if (fn === "feature_member_search") return { data: [{ user_id: "u-new", full_name: "Asha Rao", username: "asha", avatar_url: "https://cdn.example.test/a/asha.jpg", email: "asha@example.com" }, { user_id: "u-in", full_name: "Already In", username: null, avatar_url: null, email: null }], error: null };
      if (failWith) return { data: null, error: { message: failWith } };
      return { data: true, error: null };
    },
    from: () => ({ select: () => ({ in: async () => ({ data: [{ id: "admin1", full_name: "Neil" }] }) }) }),
  },
}));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));
/*
 * F-AUD-6 (MASTER §3s R-103: results "with avatar + name + username"). Radix's
 * AvatarImage mounts its <img> only after the browser reports a load, which jsdom
 * never does, so the primitive is replaced by plain elements here. What is under
 * test is what AdminFeatures hands the avatar: this URL, this alt, these initials.
 */
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...p }: { children?: unknown } & Record<string, unknown>) => <span data-testid="member-avatar" {...p}>{children as never}</span>,
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (src ? <img data-testid="member-avatar-img" src={src} alt={alt} /> : null),
  AvatarFallback: ({ children }: { children?: unknown }) => <span data-testid="member-avatar-fallback">{children as never}</span>,
}));

import AdminFeatures from "../AdminFeatures";

const card = (feature: string, over: Record<string, unknown> = {}) => ({
  feature, mode: "off", note: null, updated_at: null, key_configured: feature === "copyright_music_check" ? false : null,
  members: [], history: [], ...over,
});

beforeEach(() => {
  calls.length = 0; failWith = null;
  state = [card("copyright_music_check"), card("video_ads"), card("video_posts", {
    mode: "selected", note: "beta",
    members: [{ user_id: "u-in", full_name: "Already In", username: null, avatar_url: null, added_at: "2026-10-10T00:00:00Z", note: null }],
    history: [{ at: "2026-10-10T01:00:00Z", actor: "admin1", action: "mode", old: "off", new: "selected", user_id: null, note: "start" }],
  })];
});

const posts = () => screen.findByTestId("feature-video_posts");

describe("Admin → Features", () => {
  it("shows the Owner's three words on every feature", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    expect(within(c).getByLabelText("Off")).toBeTruthy();
    expect(within(c).getByLabelText("Selected members")).toBeTruthy();
    expect(within(c).getByLabelText("All members")).toBeTruthy();
    expect(screen.getAllByLabelText("All members")).toHaveLength(3);
  });
  it("Save is off until something changes, then writes mode + note in ONE RPC", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    const save = within(c).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(c).getByLabelText("All members"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((x) => x.fn === "feature_set_mode")).toBe(true));
    expect(calls.find((x) => x.fn === "feature_set_mode")!.args).toEqual({ _feature: "video_posts", _mode: "everyone", _note: "beta" });
  });
  it("the member list is shown as chips only in Selected members mode; ✕ removes", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.click(within(c).getByRole("button", { name: "Remove Already In" }));
    await waitFor(() => expect(calls.some((x) => x.fn === "feature_remove_member")).toBe(true));
    expect(calls.find((x) => x.fn === "feature_remove_member")!.args).toEqual({ _feature: "video_posts", _user: "u-in", _note: null });
    fireEvent.click(within(c).getByLabelText("All members"));
    expect(within(c).queryByRole("button", { name: "Remove Already In" })).toBeNull();
    expect(within(c).getByText(/kept for when you choose/)).toBeTruthy();
  });
  it("search → Add calls feature_add_member; someone already added shows 'Added', not Add", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.change(within(c).getByLabelText(/Search members/), { target: { value: "asha" } });
    fireEvent.click(within(c).getByRole("button", { name: /Search/ }));
    await within(c).findByText(/Asha Rao/);
    expect(within(c).getByText("Added")).toBeTruthy();
    fireEvent.click(within(c).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.some((x) => x.fn === "feature_add_member")).toBe(true));
    expect(calls.find((x) => x.fn === "feature_add_member")!.args).toEqual({ _feature: "video_posts", _user: "u-new", _note: null });
  });
  it("F-AUD-6: every search result shows an avatar — the photo when there is one, initials when not", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.change(within(c).getByLabelText(/Search members/), { target: { value: "asha" } });
    fireEvent.click(within(c).getByRole("button", { name: /Search/ }));
    const results = within(await within(c).findByRole("list", { name: "Search results" })).getAllByRole("listitem");
    expect(results).toHaveLength(2);
    for (const row of results) expect(within(row).getByTestId("member-avatar")).toBeTruthy();
    const img = within(results[0]).getByTestId("member-avatar-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://cdn.example.test/a/asha.jpg");
    expect(img.getAttribute("alt")).toBe("");
    expect(within(results[0]).getByTestId("member-avatar-fallback").textContent).toBe("AR");
    expect(within(results[1]).queryByTestId("member-avatar-img")).toBeNull();
    expect(within(results[1]).getByTestId("member-avatar-fallback").textContent).toBe("AI");
    expect(within(results[0]).getByText(/Asha Rao/).textContent).toMatch(/@asha/);
  });
  it("F-AUD-6: each selected-member chip shows the same avatar", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    const chips = within(within(c).getByRole("list", { name: "Members added" })).getAllByRole("listitem");
    expect(chips).toHaveLength(1);
    expect(within(chips[0]).getByTestId("member-avatar-fallback").textContent).toBe("AI");
  });
  it("a one-letter search asks the server nothing", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.change(within(c).getByLabelText(/Search members/), { target: { value: "a" } });
    fireEvent.click(within(c).getByRole("button", { name: /Search/ }));
    expect(calls.some((x) => x.fn === "feature_member_search")).toBe(false);
  });
  it("the copyright check cannot be switched on without the key", async () => {
    render(<AdminFeatures />);
    const c = await screen.findByTestId("feature-copyright_music_check");
    expect((within(c).getByLabelText("All members") as HTMLInputElement).disabled).toBe(true);
    expect((within(c).getByLabelText("Selected members") as HTMLInputElement).disabled).toBe(true);
    expect((within(c).getByLabelText("Off") as HTMLInputElement).disabled).toBe(false);
    expect(within(c).getByRole("note").textContent).toMatch(/key isn't set/);
  });
  it("…and is open once the key is configured", async () => {
    state = [card("copyright_music_check", { key_configured: true })];
    render(<AdminFeatures />);
    const c = await screen.findByTestId("feature-copyright_music_check");
    expect((within(c).getByLabelText("All members") as HTMLInputElement).disabled).toBe(false);
  });
  it("a server refusal is shown in words, and nothing pretends it saved", async () => {
    failWith = "FEATURE-003: the copyright music check cannot be turned on — key";
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.click(within(c).getByLabelText("Off"));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    expect((await within(c).findByRole("alert")).textContent).toMatch(/music-API key/);
  });
  it("history reads in plain words with the actor's name", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    fireEvent.click(within(c).getByText(/History \(1\)/));
    expect(await within(c).findByText(/Neil changed it from Off to Selected members/)).toBeTruthy();
    expect(within(c).getByText(/“start”/)).toBeTruthy();
  });
  it("a note over 500 characters cannot be typed", async () => {
    render(<AdminFeatures />);
    const c = await posts();
    expect((within(c).getByLabelText(/Note/) as HTMLTextAreaElement).maxLength).toBe(500);
  });
  it("a load failure says so", async () => {
    failWith = "FEATURE-001: only an admin";
    state = null as unknown as unknown[];
    // the state RPC returns an error for non-admins
    const { supabase } = await import("@/integrations/supabase/client");
    const orig = supabase.rpc;
    (supabase as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { message: "FEATURE-001: only an admin can read" } });
    render(<AdminFeatures />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only an admin/);
    (supabase as unknown as { rpc: unknown }).rpc = orig;
  });
});
