"use client";

import React from "react";

interface CrmPaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  label?: string;
}

export default function CrmPagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [50, 100],
  label = "total",
}: CrmPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers with ellipsis
  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis")[] = [1];

    if (currentPage > 3) {
      pages.push("ellipsis");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push("ellipsis");
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  if (totalItems <= pageSizeOptions[0]) {
    // Still show the count even if everything fits on one page
    return (
      <div className="crm-pagination">
        <div className="crm-pagination-info">
          <span className="crm-pagination-total">
            {totalItems.toLocaleString()} {label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-pagination">
      <div className="crm-pagination-info">
        <span className="crm-pagination-total">
          {totalItems.toLocaleString()} {label}
        </span>
        <span className="crm-pagination-range">
          Showing {startItem.toLocaleString()}&ndash;{endItem.toLocaleString()}
        </span>
      </div>

      <div className="crm-pagination-controls">
        <button
          className="crm-pagination-btn"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        {getPageNumbers().map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} className="crm-pagination-ellipsis">
              &hellip;
            </span>
          ) : (
            <button
              key={p}
              className={`crm-pagination-btn crm-pagination-num ${
                p === currentPage ? "crm-pagination-num-active" : ""
              }`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="crm-pagination-btn"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>

      <div className="crm-pagination-size">
        <label className="crm-pagination-size-label">Per page:</label>
        <select
          className="crm-pagination-size-select"
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
