/**
 * Admin → Ads, the website box (review fix round, 17 Oct 2026, "the same as Meta").
 *
 *   · it takes https://, http:// and a bare site.com (saved as https://site.com/);
 *   · it refuses plain text with a clear message, and does not save it;
 *   · NO SILENT LOSS: an ad already saved with a link that fails the rule says
 *     on its row "This ad has no valid website, so no button shows — add a link".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AdLinkInput } from "@/components/admin/ads/AdLinkInput";

const WARNING = "This ad has no valid website, so no button shows — add a link";
afterEach(() => cleanup());

const box = () => screen.getByPlaceholderText("Website to open when clicked (optional)") as HTMLInputElement;

describe("AdLinkInput", () => {
  it("an existing ad saved with plain text shows the warning on its row", () => {
    render(<AdLinkInput value="Hideaway Resort and Hotel" onSave={() => {}} />);
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it("no warning for a valid saved link, or for no link at all", () => {
    render(<AdLinkInput value="https://hideaway.com/" onSave={() => {}} />);
    render(<AdLinkInput value="" onSave={() => {}} />);
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it.each([
    ["www.hideaway.com", "https://www.hideaway.com/"],
    ["hideaway.com", "https://hideaway.com/"],
    ["http://hideaway.com", "http://hideaway.com/"],
    ["https://hideaway.com/rooms", "https://hideaway.com/rooms"],
  ])("accepts %s and saves %s", (typed, saved) => {
    const onSave = vi.fn();
    render(<AdLinkInput value="" onSave={onSave} />);
    fireEvent.change(box(), { target: { value: typed } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(box());
    expect(onSave).toHaveBeenCalledWith(saved);
  });

  it("refuses plain text with a clear message and does not save it", () => {
    const onSave = vi.fn();
    render(<AdLinkInput value="" onSave={onSave} />);
    fireEvent.change(box(), { target: { value: "Hideaway Resort and Hotel" } });
    expect(screen.getByRole("alert").textContent).toMatch(/web address/i);
    fireEvent.blur(box());
    expect(onSave).not.toHaveBeenCalled();
  });
});
