// @vitest-environment jsdom
import "@/test/setupDom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { pageItems, paginate } from "@/lib/pagination";
import { TablePagination } from "./TablePagination";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("splits 144 rows into pages of 25", () => {
    expect(paginate(rows(144), 1, 25)).toMatchObject({ page: 1, pageCount: 6, start: 1, end: 25 });
    const last = paginate(rows(144), 6, 25);
    expect(last).toMatchObject({ page: 6, start: 126, end: 144 });
    expect(last.rows).toHaveLength(19);
  });

  it("falls back to the last page when the list shrinks", () => {
    expect(paginate(rows(30), 6, 25)).toMatchObject({ page: 2, pageCount: 2, start: 26, end: 30 });
  });

  it("handles an empty list", () => {
    expect(paginate([], 1, 25)).toEqual({ rows: [], page: 1, pageCount: 1, start: 0, end: 0 });
  });
});

describe("pageItems", () => {
  it("lists every page up to 7", () => {
    expect(pageItems(1, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("shortens long ranges around the current page", () => {
    expect(pageItems(1, 10)).toEqual([1, 2, "ellipsis", 10]);
    expect(pageItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
    expect(pageItems(10, 10)).toEqual([1, "ellipsis", 9, 10]);
  });
});

describe("TablePagination", () => {
  it("shows nothing for a single page", () => {
    const { container } = render(<TablePagination page={1} pageCount={1} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("moves between pages and marks the current one", () => {
    const onPageChange = vi.fn();
    render(<TablePagination page={2} pageCount={6} onPageChange={onPageChange} />);
    expect(screen.getByLabelText("Page 2")).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByLabelText("Go to next page"));
    fireEvent.click(screen.getByLabelText("Go to previous page"));
    fireEvent.click(screen.getByLabelText("Page 5"));
    expect(onPageChange.mock.calls).toEqual([[3], [1], [5]]);
  });

  it("does nothing past either end or on the current page", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<TablePagination page={1} pageCount={6} onPageChange={onPageChange} />);
    expect(screen.getByLabelText("Go to previous page")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByLabelText("Go to previous page"));
    fireEvent.click(screen.getByLabelText("Page 1"));

    rerender(<TablePagination page={6} pageCount={6} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByLabelText("Go to next page"));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
