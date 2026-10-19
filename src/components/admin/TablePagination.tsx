import type { MouseEvent } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { pageItems } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export function TablePagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  // The links are anchors; keep them keyboard-usable but never navigate.
  const go = (target: number) => (e: MouseEvent) => {
    e.preventDefault();
    if (target >= 1 && target <= pageCount && target !== page) onPageChange(target);
  };
  const disabled = "pointer-events-none opacity-50";

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={go(page - 1)}
            aria-disabled={page === 1}
            className={cn(page === 1 && disabled)}
          />
        </PaginationItem>
        {pageItems(page, pageCount).map((item, i) =>
          item === "ellipsis" ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <PaginationLink
                href="#"
                onClick={go(item)}
                isActive={item === page}
                aria-label={`Page ${item}`}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={go(page + 1)}
            aria-disabled={page === pageCount}
            className={cn(page === pageCount && disabled)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
