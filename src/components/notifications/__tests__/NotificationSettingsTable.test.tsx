/**
 * N7 · the settings table (behind notif_centre_ui): one row per kind of
 * notification × Bell / Phone / E-mail, "Always on" where a member cannot
 * opt out, and ONE phone master switch that covers every push.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import NotificationSettingsTable from "@/components/notifications/NotificationSettingsTable";

vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k }));

const prefs = {
  email_reactions: true, email_comments: true, email_friend_requests: true, email_new_followers: true,
  email_competition_updates: true, email_gift_credits: true, email_certificates: true, email_course_updates: true,
  inapp_reactions: true, inapp_comments: false, inapp_social: true, inapp_competitions: true,
  email_weekly_digest: true, email_reengagement: true,
  push_enabled: true, push_reactions: true, push_comments: true, push_friend_requests: true,
  push_new_followers: true, push_competition_updates: true, push_new_posts: true, push_announcements: true,
};

describe("NotificationSettingsTable", () => {
  it("is a real table with Bell / Phone / E-mail column headers", () => {
    render(<NotificationSettingsTable preferences={prefs} onChange={vi.fn()} />);
    const table = screen.getByRole("table", { name: /notification settings/i });
    for (const h of ["Bell", "Phone", "E-mail"]) expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
  });

  it("each switch is named by its row and column, and shows the saved value", () => {
    render(<NotificationSettingsTable preferences={prefs} onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Comments and replies — Bell" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Likes on your photos — Phone" })).toHaveAttribute("aria-checked", "true");
  });

  it("a click saves exactly that column", () => {
    const onChange = vi.fn();
    render(<NotificationSettingsTable preferences={prefs} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Comments and replies — Bell" }));
    expect(onChange).toHaveBeenCalledWith("inapp_comments", true);
    fireEvent.click(screen.getByRole("switch", { name: "Competitions — E-mail" }));
    expect(onChange).toHaveBeenCalledWith("email_competition_updates", false);
  });

  it("offers the new-posts phone switch the push trigger reads (push_new_posts), as today's page does", () => {
    const onChange = vi.fn();
    render(<NotificationSettingsTable preferences={{ ...prefs, push_new_posts: true }} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "New photos from people you follow — Phone" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith("push_new_posts", false);
    // no e-mail exists for this type; its bell setting is the followers one
    expect(screen.queryByRole("switch", { name: "New photos from people you follow — E-mail" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "New photos from people you follow — Bell" })).toBeNull();
  });

  it("offers the weekly summary e-mail (sent by SQL 0200) as an e-mail-only row", () => {
    const onChange = vi.fn();
    render(<NotificationSettingsTable preferences={{ ...prefs, email_weekly_digest: true }} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Weekly summary — E-mail" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith("email_weekly_digest", false);
    expect(screen.queryByRole("switch", { name: "Weekly summary — Phone" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Weekly summary — Bell" })).toBeNull();
  });

  it("the phone master switch greys out EVERY phone switch, not just one", () => {
    render(<NotificationSettingsTable preferences={{ ...prefs, push_enabled: false }} onChange={vi.fn()} />);
    const phone = screen.getAllByRole("switch").filter((s) => / — Phone$/.test(s.getAttribute("aria-label") || ""));
    expect(phone.length).toBe(7);   // incl. new photos from people you follow (push_new_posts)
    for (const s of phone) expect(s).toBeDisabled();
    expect(screen.getByRole("switch", { name: /All phone notifications/ })).not.toBeDisabled();
  });

  it("with phone notifications off, no Phone cell claims 'Always on' (nothing is pushed at all)", () => {
    render(<NotificationSettingsTable preferences={{ ...prefs, push_enabled: false }} onChange={vi.fn()} />);
    const row = screen.getByRole("rowheader", { name: /Account and security/ }).closest("tr")!;
    const phoneCell = row.querySelectorAll("td")[1];
    expect(phoneCell.textContent).toBe("Off");
  });

  it("the master switch saves push_enabled", () => {
    const onChange = vi.fn();
    render(<NotificationSettingsTable preferences={prefs} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /All phone notifications/ }));
    expect(onChange).toHaveBeenCalledWith("push_enabled", false);
  });

  it("a 'not sent here' cell is announced as text, not a bare dash", () => {
    render(<NotificationSettingsTable preferences={prefs} onChange={vi.fn()} />);
    const row = screen.getByRole("rowheader", { name: /Reminders/ }).closest("tr")!;
    expect(within(row).getAllByText("Not sent here").length).toBe(2);
  });

  it("safety rows say Always on and offer no switch", () => {
    render(<NotificationSettingsTable preferences={prefs} onChange={vi.fn()} />);
    const row = screen.getByRole("rowheader", { name: /Account and security/ }).closest("tr")!;
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).getAllByText("Always on").length).toBeGreaterThan(0);
  });

  it("friend requests share the Bell setting with new followers (one column in the database), and says so", () => {
    render(<NotificationSettingsTable preferences={prefs} onChange={vi.fn()} />);
    const row = screen.getByRole("rowheader", { name: /Friend requests/ }).closest("tr")!;
    expect(within(row).getByText(/Same as New followers/)).toBeInTheDocument();
  });

});
