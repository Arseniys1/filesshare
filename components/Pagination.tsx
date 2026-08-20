"use client";

export interface PaginationLabels {
  ariaLabel: string;
  shown: string;
  previousPage: string;
  nextPage: string;
  back: string;
  forward: string;
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  labels: PaginationLabels;
  onPageChange: (page: number) => void;
}

function getPaginationPages(
  totalPages: number,
  currentPage: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages: Array<number | "ellipsis"> = [1];
  if (currentPage > 3) pages.push("ellipsis");
  for (
    let pageNumber = Math.max(2, currentPage - 1);
    pageNumber <= Math.min(totalPages - 1, currentPage + 1);
    pageNumber += 1
  ) {
    pages.push(pageNumber);
  }
  if (currentPage < totalPages - 2) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

export default function Pagination({
  page,
  totalPages,
  labels,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={labels.ariaLabel}
      className="flex flex-col items-center justify-between gap-3 sm:flex-row"
    >
      <p className="text-sm text-gray-500">{labels.shown}</p>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:justify-end">
        <button
          type="button"
          aria-label={labels.previousPage}
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(page - 1, 1))}
          className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {labels.back}
        </button>
        <div className="flex items-center gap-1" aria-label={labels.ariaLabel}>
          {getPaginationPages(totalPages, page).map((pageNumber, index) =>
            pageNumber === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
                aria-hidden="true"
                className="px-1 text-gray-500"
              >
                …
              </span>
            ) : (
              <button
                key={pageNumber}
                type="button"
                aria-label={`${pageNumber}`}
                aria-current={pageNumber === page ? "page" : undefined}
                onClick={() => onPageChange(pageNumber)}
                className={`h-9 min-w-9 rounded-xl px-2 text-sm transition-colors ${pageNumber === page ? "bg-accent text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
              >
                {pageNumber}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          aria-label={labels.nextPage}
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(page + 1, totalPages))}
          className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {labels.forward}
        </button>
      </div>
    </nav>
  );
}
