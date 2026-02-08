"use client";

import React, { useRef, useCallback, useEffect } from "react";

interface TableBlockProps {
  rows: string[][];
  onChange: (rows: string[][]) => void;
}

export default function TableBlock({ rows, onChange }: TableBlockProps) {
  const tableRef = useRef<HTMLTableElement>(null);

  /* Ensure at least 1 header + 1 data row, 2 cols */
  const safeRows = rows.length >= 2 ? rows : [["", ""], ["", ""]];
  const colCount = safeRows[0]?.length ?? 2;

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = safeRows.map((r) => [...r]);
      next[rowIdx][colIdx] = value;
      onChange(next);
    },
    [safeRows, onChange]
  );

  const addRow = useCallback(() => {
    const next = [...safeRows, new Array(colCount).fill("")];
    onChange(next);
  }, [safeRows, colCount, onChange]);

  const addColumn = useCallback(() => {
    const next = safeRows.map((r) => [...r, ""]);
    onChange(next);
  }, [safeRows, onChange]);

  const deleteRow = useCallback(
    (rowIdx: number) => {
      if (safeRows.length <= 2) return; // keep header + 1 row
      const next = safeRows.filter((_, i) => i !== rowIdx);
      onChange(next);
    },
    [safeRows, onChange]
  );

  const deleteColumn = useCallback(
    (colIdx: number) => {
      if (colCount <= 1) return;
      const next = safeRows.map((r) => r.filter((_, i) => i !== colIdx));
      onChange(next);
    },
    [safeRows, colCount, onChange]
  );

  /* Tab navigation between cells */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const table = tableRef.current;
        if (!table) return;

        let nextRow = rowIdx;
        let nextCol = colIdx;

        if (e.shiftKey) {
          nextCol--;
          if (nextCol < 0) { nextCol = colCount - 1; nextRow--; }
        } else {
          nextCol++;
          if (nextCol >= colCount) { nextCol = 0; nextRow++; }
        }

        if (nextRow < 0 || nextRow >= safeRows.length) return;

        const cells = table.querySelectorAll("[data-cell]");
        const target = Array.from(cells).find(
          (c) =>
            c.getAttribute("data-row") === String(nextRow) &&
            c.getAttribute("data-col") === String(nextCol)
        ) as HTMLElement | undefined;
        target?.focus();
      }
    },
    [safeRows.length, colCount]
  );

  /* Paste: strip HTML */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }, []);

  return (
    <div className="canvas-table-wrapper">
      <table ref={tableRef} className="canvas-table">
        <thead>
          <tr>
            {safeRows[0].map((cell, colIdx) => (
              <th key={colIdx}>
                <CellEditor
                  value={cell}
                  rowIdx={0}
                  colIdx={colIdx}
                  onInput={(v) => updateCell(0, colIdx, v)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Header"
                />
                {colCount > 1 && (
                  <button
                    className="canvas-table-delete-col"
                    onClick={() => deleteColumn(colIdx)}
                    title="Delete column"
                  >
                    ×
                  </button>
                )}
              </th>
            ))}
            <th className="canvas-table-add-col-cell">
              <button className="canvas-table-add-col" onClick={addColumn} title="Add column">+</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {safeRows.slice(1).map((row, rIdx) => {
            const rowIdx = rIdx + 1;
            return (
              <tr key={rowIdx}>
                {row.map((cell, colIdx) => (
                  <td key={colIdx}>
                    <CellEditor
                      value={cell}
                      rowIdx={rowIdx}
                      colIdx={colIdx}
                      onInput={(v) => updateCell(rowIdx, colIdx, v)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder=""
                    />
                  </td>
                ))}
                <td className="canvas-table-row-actions">
                  {safeRows.length > 2 && (
                    <button
                      className="canvas-table-delete-row"
                      onClick={() => deleteRow(rowIdx)}
                      title="Delete row"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="canvas-table-add-row" onClick={addRow}>
        + Add row
      </button>
    </div>
  );
}

/* ── Cell editor ── */
function CellEditor({
  value,
  rowIdx,
  colIdx,
  onInput,
  onKeyDown,
  onPaste,
  placeholder,
}: {
  value: string;
  rowIdx: number;
  colIdx: number;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      className="canvas-table-cell-input"
      contentEditable
      suppressContentEditableWarning
      data-cell
      data-row={rowIdx}
      data-col={colIdx}
      data-placeholder={placeholder}
      onInput={() => { if (ref.current) onInput(ref.current.textContent ?? ""); }}
      onKeyDown={(e) => onKeyDown(e, rowIdx, colIdx)}
      onPaste={onPaste}
    />
  );
}
