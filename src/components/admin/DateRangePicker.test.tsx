// @vitest-environment jsdom
import "@/test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";

// Thursday 19 November 2026
const TODAY = "2026-11-19";
const LAST_30: DateRangeValue = {
  preset: "last30",
  range: { from: "2026-10-21", to: "2026-11-19" },
  compare: null,
};

function setup(value: DateRangeValue = LAST_30, props: Partial<Parameters<typeof DateRangePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(<DateRangePicker value={value} onChange={onChange} today={TODAY} {...props} />);
  return { onChange, user: userEvent.setup() };
}

const dayButton = (name: RegExp | string) => screen.getAllByRole("gridcell", { name }).find((el) => !el.hasAttribute("disabled"))!;

describe("DateRangePicker", () => {
  it("shows the preset and its dates on the button", () => {
    setup();
    const trigger = screen.getByRole("button", { name: /last 30 days/i });
    expect(trigger).toHaveTextContent("21 Oct – 19 Nov 2026");
  });

  it("applies a preset only when Apply is pressed", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("button", { name: "Last month" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "lastMonth",
      range: { from: "2026-10-01", to: "2026-10-31" },
      compare: null,
    });
  });

  it("Cancel throws the changes away", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("button", { name: "Last month" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("compare defaults to the previous period and follows preset changes", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "last7",
      range: { from: "2026-11-13", to: "2026-11-19" },
      compare: { preset: "previous", range: { from: "2026-11-06", to: "2026-11-12" } },
    });
  });

  it("offers same period last year", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Same period last year" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange.mock.calls[0][0].compare).toEqual({
      preset: "previousYear",
      range: { from: "2025-10-21", to: "2025-11-19" },
    });
  });

  it("picks a custom range with two calendar clicks, in either order", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(dayButton("12"));
    expect(screen.getByText("Now pick an end date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.click(dayButton("3"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    // The calendar opens on October and November; the clicks land in October.
    expect(onChange).toHaveBeenCalledWith({
      preset: "custom",
      range: { from: "2026-10-03", to: "2026-10-12" },
      compare: null,
    });
  });

  it("custom compare: the calendar then sets the compare period", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    await user.click(screen.getByRole("switch"));
    const compareGroup = screen.getByRole("group", { name: "Compare with" });
    await user.click(within(compareGroup).getByRole("button", { name: "Custom" }));
    await user.click(dayButton("1"));
    await user.click(dayButton("5"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "last30",
      range: { from: "2026-10-21", to: "2026-11-19" },
      compare: { preset: "custom", range: { from: "2026-10-01", to: "2026-10-05" } },
    });
  });

  it("hides presets that reach before the earliest day, and compare when not allowed", async () => {
    const { user } = setup(LAST_30, { min: "2026-10-01", allowCompare: false });
    await user.click(screen.getByRole("button", { name: /last 30 days/i }));
    expect(screen.getByRole("button", { name: "Last month" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Last 90 days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
