export interface ReportPaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  isLoading: boolean;
  onPageChange: (nextPage: number) => void;
}

export function ReportPagination({
  page,
  pageSize,
  totalItems,
  isLoading,
  onPageChange,
}: ReportPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="catalog-pagination">
      <span>
        Page {page + 1} of {totalPages}
      </span>
      <div className="catalog-pagination__controls">
        <button
          type="button"
          className="btn-secondary"
          disabled={page === 0 || isLoading}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={page + 1 >= totalPages || isLoading}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
