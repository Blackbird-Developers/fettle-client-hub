// Splitting a sorted, filtered list into pages for the admin tables.

export interface Page<T> {
  rows: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row shown (0 when empty). */
  start: number;
  end: number;
}

// Cuts one page out of a sorted, filtered list. A page past the end (the list
// shrank after a refresh) falls back to the last page instead of showing none.
export function paginate<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * pageSize;
  const pageRows = rows.slice(from, from + pageSize);
  return {
    rows: pageRows,
    page: current,
    pageCount,
    start: pageRows.length > 0 ? from + 1 : 0,
    end: from + pageRows.length,
  };
}

// Page numbers to show: all of them up to 7, otherwise the first, the last
// and the current one with its neighbours, with gaps as "ellipsis".
export function pageItems(page: number, pageCount: number): (number | "ellipsis")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items: (number | "ellipsis")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);
  if (from > 2) items.push("ellipsis");
  for (let p = from; p <= to; p++) items.push(p);
  if (to < pageCount - 1) items.push("ellipsis");
  items.push(pageCount);
  return items;
}
