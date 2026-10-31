/**
 * Admin → Notification Centre (N6). The switches are the Owner's rollout
 * buttons (N8), so the tests pin exactly what each click sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import AdminNotificationCentre from "@/components/admin/AdminNotificationCentre";

const SWITCHES = [
  { key: "notif_centre_ui", label: "New notification screens", mode: "off", members: 0 },
  { key: "notif_centre_likes_comments", label: "Likes and comments", mode: "off", members: 0 },
  { key: "notif_centre_admin_alerts", label: "Admin alerts", mode: "off", members: 0 },
];
const TYPES = [
  { type: "post_reaction", audience: "member", group_key: "likes_comments", icon: "heart", channels: ["in_app", "push", "email"],
    default_on: true, member_can_disable: true, enabled: true, wording_en: null, rows_24h: 12, rows_7d: 80,
    centre_sent_24h: 0, centre_skipped_24h: 0, centre_sent_7d: 0, centre_skipped_7d: 0 },
];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "admin_notif_switches") return { data: SWITCHES, error: null };
    if (fn === "admin_notif_types") return { data: TYPES, error: null };
    if (fn === "admin_notif_history") return { data: [{ changed_at: "2026-10-31T12:00:00Z", changed_by_name: "Neil", subject: "post_reaction", field: "enabled", old_value: true, new_value: false }], error: null };
    return { data: null, error: null };
  });
});

describe("Admin → Notification Centre", () => {
  it("shows every switch Off and the four choices", async () => {
    render(<AdminNotificationCentre />);
    const group = await screen.findByRole("group", { name: /Likes and comments: who gets it/ });
    for (const n of ["Off", "Only me", "Chosen members", "Everyone"]) expect(within(group).getByRole("button", { name: n })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Only me sends mode me for that switch", async () => {
    render(<AdminNotificationCentre />);
    const group = await screen.findByRole("group", { name: /Likes and comments: who gets it/ });
    fireEvent.click(within(group).getByRole("button", { name: "Only me" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_notif_switch_set",
      { _key: "notif_centre_likes_comments", _mode: "me", _users: null }));
  });

  it("Chosen members stays disabled until every id is a valid member id, then sends the list", async () => {
    render(<AdminNotificationCentre />);
    const group = await screen.findByRole("group", { name: /Likes and comments: who gets it/ });
    const btn = within(group).getByRole("button", { name: "Chosen members" });
    expect(btn).toBeDisabled();
    const inputs = screen.getAllByLabelText(/Chosen members \(their member ids/);
    fireEvent.change(inputs[1], { target: { value: "not-an-id" } });
    expect(btn).toBeDisabled();
    fireEvent.change(inputs[1], { target: { value: "aaaaaaaa-0000-0000-0000-000000000001, bbbbbbbb-0000-0000-0000-000000000002" } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_notif_switch_set", {
      _key: "notif_centre_likes_comments", _mode: "members",
      _users: ["aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"] }));
  });

  it("admin alerts offer only Off and Everyone", async () => {
    render(<AdminNotificationCentre />);
    const group = await screen.findByRole("group", { name: /Admin alerts: who gets it/ });
    expect(within(group).queryByRole("button", { name: "Only me" })).toBeNull();
    expect(within(group).getByRole("button", { name: "Everyone" })).toBeInTheDocument();
  });

  it("lists types with numbers; Edit shows a wording preview, test send and history", async () => {
    render(<AdminNotificationCentre />);
    const row = (await screen.findByRole("rowheader", { name: "post_reaction" })).closest("tr")!;
    expect(row).toHaveTextContent("12 / 80");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/Wording \(English/), { target: { value: "liked your photo" } });
    expect(screen.getByText(/Preview:/)).toHaveTextContent("Anindita liked your photo");
    fireEvent.click(screen.getByRole("button", { name: /Send a test to me/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("notification_centre_send_test", { _type: "post_reaction" }));
    fireEvent.click(screen.getByRole("button", { name: /Change history/ }));
    expect(await screen.findByText(/Neil changed/)).toBeInTheDocument();
  });

  it("unticking On turns the type off for everyone", async () => {
    render(<AdminNotificationCentre />);
    const box = await screen.findByRole("checkbox", { name: "post_reaction on for everyone" });
    fireEvent.click(box);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_notif_type_update", { _type: "post_reaction", _patch: { enabled: false } }));
  });

  it("the member id field is named by its label only (the button is outside it)", async () => {
    render(<AdminNotificationCentre />);
    expect(await screen.findByRole("textbox", { name: "Member id" })).toBeInTheDocument();
  });

  it("a refusal from the server is shown, not swallowed", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "admin only" } }));
    render(<AdminNotificationCentre />);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin only");
  });
});
