/**
 * N7 · quiet hours (20261104_0180). A member sets hours when phone alerts
 * stay silent; notifications still land in the bell. Own row only, saved
 * through notif_quiet_hours_set; the zone is the phone's own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k }));

import QuietHoursSetting, { canonicalZone } from "@/components/notifications/QuietHoursSetting";

const zone = canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

describe("QuietHoursSetting", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("off when nothing is saved; says what it does", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<QuietHoursSetting />);
    const sw = await screen.findByRole("switch", { name: "Quiet hours" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText(/No phone alerts between these times\. They still appear in your notifications\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("turning on saves 22:00–07:00 in the phone's zone and shows the times", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "notif_quiet_hours_get" ? { data: [], error: null } : { data: true, error: null }));
    render(<QuietHoursSetting />);
    const sw = await screen.findByRole("switch", { name: "Quiet hours" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("notif_quiet_hours_set", { _starts: "22:00", _ends: "07:00", _tz: zone }));
    expect(screen.getByLabelText("From")).toHaveValue("22:00");
    expect(screen.getByLabelText("To")).toHaveValue("07:00");
  });

  it("shows saved hours, saves a changed time, and turning off clears them", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "notif_quiet_hours_get"
        ? { data: [{ starts: "23:00:00", ends: "06:30:00", tz: "Asia/Kolkata" }], error: null }
        : { data: true, error: null });
    render(<QuietHoursSetting />);
    const from = await screen.findByLabelText("From");
    expect(from).toHaveValue("23:00");
    expect(screen.getByLabelText("To")).toHaveValue("06:30");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "07:15" } });
    // typing alone saves nothing (no save per keystroke, no lost focus)
    expect(rpc).not.toHaveBeenCalledWith("notif_quiet_hours_set", expect.anything());
    fireEvent.blur(screen.getByLabelText("To"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("notif_quiet_hours_set", { _starts: "23:00", _ends: "07:15", _tz: zone }));
    fireEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("notif_quiet_hours_set", { _starts: null, _ends: null, _tz: null }));
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("says so when saving fails, and does not pretend it saved", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "notif_quiet_hours_get" ? { data: [], error: null } : { data: null, error: { message: "choose a start and an end time that differ" } });
    render(<QuietHoursSetting />);
    const sw = await screen.findByRole("switch", { name: "Quiet hours" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save quiet hours. Try again.");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("a failed load says so and offers no switch to press (never overwrites saved hours)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    render(<QuietHoursSetting />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load quiet hours.");
    expect(screen.getByRole("switch", { name: "Quiet hours" })).toBeDisabled();
  });

  it("names the time zone the times are in", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<QuietHoursSetting />);
    expect(await screen.findByText(new RegExp(`Times are in your phone's time zone \\(${zone.replace(/[/+]/g, (c) => "\\" + c)}\\)`))).toBeInTheDocument();
  });
});

describe("canonicalZone", () => {
  it("maps old zone names phones still report to today's names", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalZone("Asia/Katmandu")).toBe("Asia/Kathmandu");
    expect(canonicalZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(canonicalZone("")).toBe("UTC");
  });
});
