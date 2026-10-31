/**
 * P23 S10a-3 (B): <Progress value> used to stop at the wrapper — the Radix root
 * never received `value`, so every progress bar was announced as
 * "indeterminate" (data-state="indeterminate", no aria-valuenow) however full
 * it looked. A screen reader must hear the number the bar shows.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("tells assistive tech its value", () => {
    const { getByRole } = render(<Progress value={60} aria-label="Profile completion" />);
    const bar = getByRole("progressbar", { name: "Profile completion" });
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(bar.getAttribute("data-state")).not.toBe("indeterminate");
  });
});
