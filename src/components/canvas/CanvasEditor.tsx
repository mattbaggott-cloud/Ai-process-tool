"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { CanvasBlock, CanvasBlockType, ListItem, BlockAlign } from "@/lib/types/database";
import SlashCommandMenu from "./SlashCommandMenu";
import ListBlock from "./blocks/ListBlock";
import ChecklistBlock from "./blocks/ChecklistBlock";
import TableBlock from "./blocks/TableBlock";
import CodeBlock from "./blocks/CodeBlock";
import ChartBlock from "./blocks/ChartBlock";

/* ── Helpers ────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function blankBlock(type: CanvasBlockType = "text", level?: 1 | 2 | 3): CanvasBlock {
  const base: CanvasBlock = { id: uid(), type };
  if (type === "text") base.content = "";
  if (type === "heading") { base.content = ""; base.level = level ?? 2; }
  if (type === "image") { base.url = ""; base.alt = ""; }
  if (type === "bullet_list" || type === "numbered_list") base.items = [{ id: uid(), text: "" }];
  if (type === "checklist") base.items = [{ id: uid(), text: "", checked: false }];
  if (type === "table") base.rows = [["", "", ""], ["", "", ""]];
  if (type === "code") { base.content = ""; base.language = ""; }
  if (type === "chart") { base.chartType = "bar"; base.chartData = []; base.chartConfig = { title: "", xKey: "", yKeys: [], colors: [] }; }
  if (type === "column_group") base.columns = [[blankBlock("text")], [blankBlock("text")]];
  return base;
}

type DropZone = "top" | "bottom" | "left" | "right" | null;

/* Drag payload key for dataTransfer */
const DRAG_KEY = "application/x-canvas-block-id";

/* ═══════════════════════════════════════════════════════════
   Locate a block by ID anywhere in the tree.
   Returns { blockIdx, colGroupIdx?, colIdx? } or null.
   ═══════════════════════════════════════════════════════════ */
type BlockLocation =
  | { kind: "top"; blockIdx: number }
  | { kind: "column"; blockIdx: number; colGroupIdx: number; colIdx: number };

function findBlock(blocks: CanvasBlock[], blockId: string): BlockLocation | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === blockId) return { kind: "top", blockIdx: i };
    if (blocks[i].type === "column_group" && blocks[i].columns) {
      const cols = blocks[i].columns!;
      for (let ci = 0; ci < cols.length; ci++) {
        for (let bi = 0; bi < cols[ci].length; bi++) {
          if (cols[ci][bi].id === blockId)
            return { kind: "column", blockIdx: bi, colGroupIdx: i, colIdx: ci };
        }
      }
    }
  }
  return null;
}

/* Remove a block from anywhere in the tree, returning [block, newBlocks].
   Cleans up empty columns and unwraps single-column groups. */
function removeBlockFromTree(blocks: CanvasBlock[], blockId: string): [CanvasBlock | null, CanvasBlock[]] {
  const loc = findBlock(blocks, blockId);
  if (!loc) return [null, blocks];

  const next = blocks.map((b) =>
    b.type === "column_group" && b.columns
      ? { ...b, columns: b.columns.map((col) => [...col]) }
      : { ...b }
  );

  if (loc.kind === "top") {
    const [removed] = next.splice(loc.blockIdx, 1);
    return [removed, next];
  }

  // Column block
  const cg = next[loc.colGroupIdx];
  const cols = cg.columns!;
  const [removed] = cols[loc.colIdx].splice(loc.blockIdx, 1);

  // If column is now empty, remove it
  const liveCols = cols.filter((c) => c.length > 0);

  if (liveCols.length === 0) {
    // Entire column group is empty — remove it
    next.splice(loc.colGroupIdx, 1);
  } else if (liveCols.length === 1) {
    // Only 1 column left — unwrap back to top-level blocks
    next.splice(loc.colGroupIdx, 1, ...liveCols[0]);
  } else {
    next[loc.colGroupIdx] = { ...cg, columns: liveCols };
  }

  return [removed, next];
}

/* ══════════════════════════════════════════════════════════
   RICH TEXT BLOCK
   ══════════════════════════════════════════════════════════ */

interface RichTextBlockProps {
  content: string;
  blockId: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onChange: (html: string) => void;
  onDelete?: () => void;
  onSlashOpen?: (blockId: string, position: { top: number; left: number }) => void;
  onSlashFilter?: (filter: string) => void;
  onSlashDismiss?: () => void;
}

function RichTextBlock({ content, blockId, placeholder, className, style, onChange, onDelete, onSlashOpen, onSlashFilter, onSlashDismiss }: RichTextBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const slashActive = useRef(false);

  const localHtml = useRef(content); // tracks what WE last set via typing
  useEffect(() => { if (ref.current) { ref.current.innerHTML = content; localHtml.current = content; } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ref.current) return;
    // Only sync from props if the content changed externally (undo/redo/AI), not from our own typing
    if (content !== localHtml.current) {
      ref.current.innerHTML = content;
      localHtml.current = content;
    }
  }, [content]);

  const handleInput = useCallback(() => {
    if (isComposing.current || !ref.current) return;
    const text = ref.current.textContent ?? "";
    if (text.trim() === "" && ref.current.innerHTML !== "") ref.current.innerHTML = "";
    const html = ref.current.innerHTML;
    localHtml.current = html; // track local typing so useEffect doesn't clobber DOM
    if (text.startsWith("/")) {
      if (!slashActive.current && onSlashOpen) { slashActive.current = true; const rect = ref.current.getBoundingClientRect(); onSlashOpen(blockId, { top: rect.bottom + 4, left: rect.left }); }
      if (onSlashFilter) onSlashFilter(text.slice(1));
    } else if (slashActive.current) { slashActive.current = false; onSlashDismiss?.(); }
    onChange(html);
  }, [onChange, blockId, onSlashOpen, onSlashFilter, onSlashDismiss]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
    if (mod && e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
    if (mod && e.key === "u") { e.preventDefault(); document.execCommand("underline"); }
    // Backspace on empty block → delete the block
    if (e.key === "Backspace" && onDelete && ref.current) {
      const text = ref.current.textContent ?? "";
      if (text.trim() === "") {
        e.preventDefault();
        onDelete();
      }
    }
  }, [onDelete]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }, []);

  return (
    <div ref={ref} className={className || "canvas-text-input"} contentEditable suppressContentEditableWarning
      data-placeholder={placeholder || "Type '/' for commands\u2026"} style={style}
      onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste}
      onCompositionStart={() => { isComposing.current = true; }}
      onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   ALIGN TOOLBAR — small bar for left/center/right + width
   ══════════════════════════════════════════════════════════ */

const ALIGN_ICONS: Record<BlockAlign, React.ReactNode> = {
  left: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="1" y1="2" x2="13" y2="2"/><line x1="1" y1="5.5" x2="9" y2="5.5"/><line x1="1" y1="9" x2="13" y2="9"/><line x1="1" y1="12.5" x2="9" y2="12.5"/>
    </svg>
  ),
  center: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="1" y1="2" x2="13" y2="2"/><line x1="3" y1="5.5" x2="11" y2="5.5"/><line x1="1" y1="9" x2="13" y2="9"/><line x1="3" y1="12.5" x2="11" y2="12.5"/>
    </svg>
  ),
  right: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="1" y1="2" x2="13" y2="2"/><line x1="5" y1="5.5" x2="13" y2="5.5"/><line x1="1" y1="9" x2="13" y2="9"/><line x1="5" y1="12.5" x2="13" y2="12.5"/>
    </svg>
  ),
};

function AlignToolbar({ align, onAlign, showWidth, width, onWidth }: {
  align: BlockAlign;
  onAlign: (a: BlockAlign) => void;
  showWidth?: boolean;
  width?: number;
  onWidth?: (w: number) => void;
}) {
  return (
    <div className="canvas-align-toolbar">
      {(["left", "center", "right"] as BlockAlign[]).map((a) => (
        <button key={a} className={`canvas-align-btn${align === a ? " active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAlign(a); }}
          title={`Align ${a}`}>
          {ALIGN_ICONS[a]}
        </button>
      ))}
      {showWidth && onWidth && (
        <>
          <span className="canvas-align-sep" />
          <div className="canvas-width-control">
            <input type="range" min="25" max="100" step="5" value={width ?? 100}
              onChange={(e) => onWidth(Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              className="canvas-width-slider" />
            <span className="canvas-width-label">{width ?? 100}%</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   IMAGE BLOCK — with resize handle
   ══════════════════════════════════════════════════════════ */

function ImageBlock({ block, updateBlock }: { block: CanvasBlock; updateBlock: (id: string, patch: Partial<CanvasBlock>) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = block.width ?? 100;
    const parentWidth = containerRef.current?.parentElement?.getBoundingClientRect().width ?? 600;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX;
      const deltaPercent = (delta / parentWidth) * 100;
      const newWidth = Math.max(20, Math.min(100, startWidth + deltaPercent));
      updateBlock(block.id, { width: Math.round(newWidth) });
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [block.id, block.width, updateBlock]);

  if (!block.url) {
    return (
      <div className="canvas-image-block">
        <input className="input" placeholder="Paste an image URL\u2026" value={block.url ?? ""}
          onChange={(e) => updateBlock(block.id, { url: e.target.value })} />
      </div>
    );
  }

  const widthPct = block.width ?? 100;

  return (
    <div className="canvas-image-block" ref={containerRef}
      style={{ width: `${widthPct}%` }}>
      <img src={block.url} alt={block.alt || ""} style={{ width: "100%", borderRadius: 8 }} />
      <div className="canvas-image-resize-handle" onMouseDown={handleResizeStart}
        title="Drag to resize" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BLOCK RENDERER
   ══════════════════════════════════════════════════════════ */

/* Block types that support alignment */
const ALIGNABLE_TYPES: CanvasBlockType[] = ["text", "heading", "image", "chart", "code", "table"];

interface BlockRendererProps {
  block: CanvasBlock;
  updateBlock: (id: string, patch: Partial<CanvasBlock>) => void;
  deleteBlock: (id: string, replacements?: CanvasBlock[]) => void;
  handleSlashOpen: (blockId: string, pos: { top: number; left: number }) => void;
  setSlashFilter: (f: string) => void;
  handleSlashDismiss: () => void;
  /* Unified drag */
  onGlobalDragStart: (e: React.DragEvent, blockId: string) => void;
  onGlobalDragOver: (e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => void;
  onGlobalDrop: (e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => void;
  onGlobalDragEnd: () => void;
  dragBlockId: string | null;
  dropTarget: { targetId: string; zone: DropZone } | null;
}

function BlockRenderer({
  block, updateBlock, deleteBlock,
  handleSlashOpen, setSlashFilter, handleSlashDismiss,
  onGlobalDragStart, onGlobalDragOver, onGlobalDrop, onGlobalDragEnd,
  dragBlockId, dropTarget,
}: BlockRendererProps) {
  const alignable = ALIGNABLE_TYPES.includes(block.type);
  const align = block.align ?? "left";
  const isImage = block.type === "image" && !!block.url;

  /* Alignment wrapper style */
  const alignStyle: React.CSSProperties | undefined = align !== "left" ? {
    display: "flex",
    justifyContent: align === "center" ? "center" : "flex-end",
  } : undefined;

  /* For text/heading blocks, use text-align instead of flex */
  const textAlignStyle: React.CSSProperties | undefined =
    (block.type === "text" || block.type === "heading") && align !== "left"
      ? { textAlign: align }
      : undefined;

  return (
    <>
      {/* Alignment toolbar — shown on hover via CSS */}
      {alignable && (
        <AlignToolbar
          align={align}
          onAlign={(a) => updateBlock(block.id, { align: a })}
          showWidth={isImage}
          width={block.width}
          onWidth={isImage ? (w) => updateBlock(block.id, { width: w }) : undefined}
        />
      )}

      {block.type === "text" && (
        <RichTextBlock content={block.content ?? ""} blockId={block.id}
          style={textAlignStyle}
          onChange={(html) => updateBlock(block.id, { content: html })}
          onDelete={() => deleteBlock(block.id)}
          onSlashOpen={handleSlashOpen} onSlashFilter={setSlashFilter} onSlashDismiss={handleSlashDismiss} />
      )}
      {block.type === "heading" && (
        <RichTextBlock content={block.content ?? ""} blockId={block.id}
          className={`canvas-heading canvas-heading-${block.level ?? 2}`}
          placeholder={`Heading ${block.level ?? 2}`}
          style={textAlignStyle}
          onChange={(html) => updateBlock(block.id, { content: html })}
          onDelete={() => deleteBlock(block.id)}
          onSlashOpen={handleSlashOpen} onSlashFilter={setSlashFilter} onSlashDismiss={handleSlashDismiss} />
      )}
      {block.type === "divider" && <hr className="canvas-divider" />}
      {block.type === "image" && (
        <div style={alignStyle}>
          <ImageBlock block={block} updateBlock={updateBlock} />
        </div>
      )}
      {block.type === "bullet_list" && <ListBlock items={block.items ?? []} ordered={false} onChange={(items: ListItem[]) => updateBlock(block.id, { items })} />}
      {block.type === "numbered_list" && <ListBlock items={block.items ?? []} ordered={true} onChange={(items: ListItem[]) => updateBlock(block.id, { items })} />}
      {block.type === "checklist" && <ChecklistBlock items={block.items ?? []} onChange={(items: ListItem[]) => updateBlock(block.id, { items })} />}
      {block.type === "table" && (
        <div style={alignStyle}>
          <TableBlock rows={block.rows ?? [["", ""], ["", ""]]} onChange={(rows: string[][]) => updateBlock(block.id, { rows })} />
        </div>
      )}
      {block.type === "code" && (
        <div style={alignStyle}>
          <CodeBlock content={block.content ?? ""} language={block.language ?? ""} onChange={(content: string, language: string) => updateBlock(block.id, { content, language })} />
        </div>
      )}
      {block.type === "chart" && (
        <div style={alignStyle}>
          <ChartBlock chartType={block.chartType ?? "bar"} chartData={block.chartData ?? []} chartConfig={block.chartConfig ?? {}} onChange={(patch) => updateBlock(block.id, patch)} />
        </div>
      )}
      {block.type === "column_group" && (
        <ColumnGroup
          colGroupId={block.id}
          columns={block.columns ?? []}
          onChange={(columns) => updateBlock(block.id, { columns })}
          onUnwrap={(flatBlocks) => deleteBlock(block.id, flatBlocks)}
          parentSlashOpen={handleSlashOpen} parentSlashFilter={setSlashFilter} parentSlashDismiss={handleSlashDismiss}
          updateBlock={updateBlock} deleteBlock={deleteBlock}
          onGlobalDragStart={onGlobalDragStart} onGlobalDragOver={onGlobalDragOver} onGlobalDrop={onGlobalDrop} onGlobalDragEnd={onGlobalDragEnd}
          dragBlockId={dragBlockId} dropTarget={dropTarget}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   COLUMN GROUP
   ══════════════════════════════════════════════════════════ */

interface ColumnGroupProps {
  colGroupId: string;
  columns: CanvasBlock[][];
  onChange: (columns: CanvasBlock[][]) => void;
  onUnwrap: (flatBlocks: CanvasBlock[]) => void;
  parentSlashOpen: (blockId: string, pos: { top: number; left: number }) => void;
  parentSlashFilter: (f: string) => void;
  parentSlashDismiss: () => void;
  updateBlock: (id: string, patch: Partial<CanvasBlock>) => void;
  deleteBlock: (id: string, replacements?: CanvasBlock[]) => void;
  /* Unified drag from parent */
  onGlobalDragStart: (e: React.DragEvent, blockId: string) => void;
  onGlobalDragOver: (e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => void;
  onGlobalDrop: (e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => void;
  onGlobalDragEnd: () => void;
  dragBlockId: string | null;
  dropTarget: { targetId: string; zone: DropZone } | null;
}

function ColumnGroup({
  colGroupId, columns, onChange, onUnwrap,
  parentSlashOpen, parentSlashFilter, parentSlashDismiss,
  updateBlock: parentUpdateBlock, deleteBlock: parentDeleteBlock,
  onGlobalDragStart, onGlobalDragOver, onGlobalDrop, onGlobalDragEnd,
  dragBlockId, dropTarget,
}: ColumnGroupProps) {

  const updateColBlock = useCallback(
    (colIdx: number, blockId: string, patch: Partial<CanvasBlock>) => {
      onChange(columns.map((col, ci) => ci === colIdx ? col.map((b) => b.id === blockId ? { ...b, ...patch } : b) : col));
    }, [columns, onChange]);

  const deleteColBlock = useCallback(
    (colIdx: number, blockId: string) => {
      onChange(columns.map((col, ci) => {
        if (ci !== colIdx) return col;
        const f = col.filter((b) => b.id !== blockId);
        return f.length === 0 ? [blankBlock("text")] : f;
      }));
    }, [columns, onChange]);

  const insertInCol = useCallback(
    (colIdx: number, afterIdx: number) => {
      onChange(columns.map((col, ci) => {
        if (ci !== colIdx) return col;
        const u = [...col]; u.splice(afterIdx + 1, 0, blankBlock("text")); return u;
      }));
    }, [columns, onChange]);

  const addColumn = useCallback(() => { onChange([...columns, [blankBlock("text")]]); }, [columns, onChange]);

  const removeColumn = useCallback((colIdx: number) => {
    const next = columns.filter((_, ci) => ci !== colIdx);
    if (next.length <= 1) {
      onUnwrap(next.length === 1 ? next[0] : [blankBlock("text")]);
    } else { onChange(next); }
  }, [columns, onChange, onUnwrap]);

  return (
    <div className="canvas-column-group">
      {columns.map((col, colIdx) => (
        <div key={colIdx} className="canvas-column"
          onDragOver={(e) => {
            // Allow dropping on the empty area of a column
            e.preventDefault(); e.stopPropagation();
          }}
          onDrop={(e) => {
            e.stopPropagation();
            // If dropped on the column itself (not a block), treat as drop at end
            const lastBlock = col[col.length - 1];
            if (lastBlock) onGlobalDrop(e, lastBlock.id, { colGroupId, colIdx });
          }}
        >
          <div className="canvas-column-header">
            <button className="canvas-column-delete" onClick={() => removeColumn(colIdx)} title="Remove column">&times;</button>
          </div>
          {col.map((block, blockIdx) => {
            const isTarget = dropTarget?.targetId === block.id && dragBlockId !== null && dragBlockId !== block.id;
            const zone = isTarget ? dropTarget.zone : null;
            return (
              <React.Fragment key={block.id}>
                {blockIdx > 0 && (
                  <div className="canvas-insert-line" onClick={() => insertInCol(colIdx, blockIdx - 1)}>
                    <span className="canvas-insert-line-plus">+</span>
                  </div>
                )}
                <div
                  className={
                    "canvas-block canvas-block-in-column" +
                    (zone === "top" ? " canvas-drop-top" : "") +
                    (zone === "bottom" ? " canvas-drop-bottom" : "") +
                    (zone === "left" ? " canvas-drop-left" : "") +
                    (zone === "right" ? " canvas-drop-right" : "") +
                    (dragBlockId === block.id ? " canvas-block-dragging" : "")
                  }
                  onDragStart={(e) => { e.stopPropagation(); onGlobalDragStart(e, block.id); }}
                  onDragOver={(e) => { e.stopPropagation(); onGlobalDragOver(e, block.id, { colGroupId, colIdx }); }}
                  onDrop={(e) => { e.stopPropagation(); onGlobalDrop(e, block.id, { colGroupId, colIdx }); }}
                  onDragEnd={(e) => { (e.currentTarget as HTMLElement).draggable = false; onGlobalDragEnd(); }}
                  onDragLeave={(e) => { e.stopPropagation(); }}
                >
                  <div className="canvas-block-controls">
                    <button className="canvas-control-btn canvas-control-add" onClick={() => insertInCol(colIdx, blockIdx)} title="Add block below">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/></svg>
                    </button>
                    <div className="canvas-control-btn canvas-control-grip" title="Drag to reorder"
                      onMouseDown={(e) => {
                        const blockEl = (e.currentTarget as HTMLElement).closest(".canvas-block") as HTMLElement;
                        if (blockEl) blockEl.draggable = true;
                      }}>
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                        <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
                        <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
                        <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
                      </svg>
                    </div>
                  </div>
                  <div className="canvas-block-content">
                    <BlockRenderer block={block}
                      updateBlock={(id, patch) => updateColBlock(colIdx, id, patch)}
                      deleteBlock={(id) => deleteColBlock(colIdx, id)}
                      handleSlashOpen={parentSlashOpen} setSlashFilter={parentSlashFilter} handleSlashDismiss={parentSlashDismiss}
                      onGlobalDragStart={onGlobalDragStart} onGlobalDragOver={onGlobalDragOver} onGlobalDrop={onGlobalDrop} onGlobalDragEnd={onGlobalDragEnd}
                      dragBlockId={dragBlockId} dropTarget={dropTarget}
                    />
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          <div className="canvas-trailing-add" onClick={() => insertInCol(colIdx, col.length - 1)}>+</div>
        </div>
      ))}
      <button className="canvas-column-add" onClick={addColumn} title="Add column">+</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   UNDO / REDO HOOK — tracks block snapshots
   ══════════════════════════════════════════════════════════ */

const MAX_HISTORY = 100;

function useUndoRedo(blocks: CanvasBlock[], onChange: (blocks: CanvasBlock[]) => void) {
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushed = useRef<string>(""); // avoid duplicate consecutive snapshots
  const isUndoRedo = useRef(false);      // flag to skip pushing during undo/redo
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Snapshot the current blocks into the undo stack (debounced for typing) */
  const pushSnapshot = useCallback((snapshot: string, immediate?: boolean) => {
    if (isUndoRedo.current) return;
    if (snapshot === lastPushed.current) return;

    const doPush = () => {
      undoStack.current.push(snapshot);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      lastPushed.current = snapshot;
    };

    if (immediate) {
      if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
      doPush();
    } else {
      // Debounce text changes — push after 500ms of inactivity
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(doPush, 500);
    }
  }, []);

  /* Wrap onChange: snapshot before change, then call parent */
  const trackedOnChange = useCallback((newBlocks: CanvasBlock[], immediate?: boolean) => {
    // Push the CURRENT state (before the change) onto undo stack
    const currentSnap = JSON.stringify(blocks);
    pushSnapshot(currentSnap, immediate);
    onChange(newBlocks);
  }, [blocks, onChange, pushSnapshot]);

  /* Undo: pop last snapshot, push current to redo */
  const undo = useCallback(() => {
    // Flush any pending debounced push
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }

    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    const currentSnap = JSON.stringify(blocks);
    redoStack.current.push(currentSnap);
    lastPushed.current = prev;
    isUndoRedo.current = true;
    onChange(JSON.parse(prev));
    // Reset flag after React processes the update
    requestAnimationFrame(() => { isUndoRedo.current = false; });
  }, [blocks, onChange]);

  /* Redo: pop from redo stack, push current to undo */
  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    const currentSnap = JSON.stringify(blocks);
    undoStack.current.push(currentSnap);
    lastPushed.current = next;
    isUndoRedo.current = true;
    onChange(JSON.parse(next));
    requestAnimationFrame(() => { isUndoRedo.current = false; });
  }, [blocks, onChange]);

  return { trackedOnChange, undo, redo };
}

/* ══════════════════════════════════════════════════════════
   CANVAS EDITOR — unified drag system + undo/redo
   ══════════════════════════════════════════════════════════ */

interface CanvasEditorProps {
  blocks: CanvasBlock[];
  onChange: (blocks: CanvasBlock[]) => void;
}

export default function CanvasEditor({ blocks, onChange }: CanvasEditorProps) {
  const { trackedOnChange, undo, redo } = useUndoRedo(blocks, onChange);
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ targetId: string; zone: DropZone; colTarget?: { colGroupId: string; colIdx: number } } | null>(null);

  /* Slash command state */
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [slashPosition, setSlashPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [slashFilter, setSlashFilter] = useState("");

  /* ── Global keyboard: Cmd+Z / Cmd+Shift+Z ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo]);

  /* ── Block CRUD ── */
  const updateBlock = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      // Text content changes are debounced; structural changes (like updating columns) are immediate
      const isTextOnly = Object.keys(patch).length === 1 && "content" in patch;
      trackedOnChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)), !isTextOnly);
    }, [blocks, trackedOnChange]);

  const deleteBlock = useCallback(
    (id: string, replacements?: CanvasBlock[]) => {
      if (replacements && replacements.length > 0) {
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx === -1) return;
        const next = [...blocks]; next.splice(idx, 1, ...replacements); trackedOnChange(next, true);
      } else {
        const next = blocks.filter((b) => b.id !== id);
        trackedOnChange(next.length === 0 ? [blankBlock("text")] : next, true);
      }
    }, [blocks, trackedOnChange]);

  const insertBlockAt = useCallback(
    (afterIdx: number) => {
      const next = [...blocks]; next.splice(afterIdx + 1, 0, blankBlock("text")); trackedOnChange(next, true);
    }, [blocks, trackedOnChange]);

  /* ── Transform (slash commands) ── */
  const transformBlock = useCallback(
    (blockId: string, newType: CanvasBlockType, level?: 1 | 2 | 3) => {
      for (const pb of blocks) {
        if (pb.type === "column_group" && pb.columns) {
          for (let ci = 0; ci < pb.columns.length; ci++) {
            if (pb.columns[ci].some((b) => b.id === blockId)) {
              const fresh = blankBlock(newType, level);
              const newCols = pb.columns.map((c, idx) => idx === ci ? c.map((b) => b.id === blockId ? { ...fresh, id: b.id } : b) : c);
              trackedOnChange(blocks.map((b) => b.id === pb.id ? { ...b, columns: newCols } : b), true);
              return;
            }
          }
        }
      }
      const fresh = blankBlock(newType, level);
      trackedOnChange(blocks.map((b) => b.id === blockId ? { ...fresh, id: b.id } : b), true);
    }, [blocks, trackedOnChange]);

  const handleSlashOpen = useCallback((blockId: string, pos: { top: number; left: number }) => { setSlashBlockId(blockId); setSlashPosition(pos); setSlashFilter(""); }, []);
  const handleSlashSelect = useCallback((type: CanvasBlockType, level?: 1 | 2 | 3) => { if (slashBlockId) transformBlock(slashBlockId, type, level); setSlashBlockId(null); setSlashFilter(""); }, [slashBlockId, transformBlock]);
  const handleSlashDismiss = useCallback(() => { setSlashBlockId(null); setSlashFilter(""); }, []);

  /* ══════════════════════════════════════════════════════
     UNIFIED DRAG SYSTEM — works across main canvas + columns
     ══════════════════════════════════════════════════════ */

  const onGlobalDragStart = useCallback((e: React.DragEvent, blockId: string) => {
    setDragBlockId(blockId);
    e.dataTransfer.setData(DRAG_KEY, blockId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onGlobalDragOver = useCallback((e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const xRatio = w > 0 ? x / w : 0.5;
    const yRatio = h > 0 ? y / h : 0.5;

    let zone: DropZone;
    if (colTarget) {
      // Inside a column:
      // - left/right edges = move to adjacent column
      // - top/bottom = reorder within the same column
      if (xRatio < 0.25) zone = "left";
      else if (xRatio > 0.75) zone = "right";
      else zone = yRatio < 0.5 ? "top" : "bottom";
    } else {
      // Top-level — full directional detection
      if (xRatio < 0.22) zone = "left";
      else if (xRatio > 0.78) zone = "right";
      else zone = yRatio < 0.5 ? "top" : "bottom";
    }
    setDropTarget({ targetId, zone, colTarget });
  }, []);

  const onGlobalDrop = useCallback((e: React.DragEvent, targetId: string, colTarget?: { colGroupId: string; colIdx: number }) => {
    e.preventDefault();
    const srcId = e.dataTransfer.getData(DRAG_KEY) || dragBlockId;
    if (!srcId || srcId === targetId) { setDragBlockId(null); setDropTarget(null); return; }

    const zone = dropTarget?.zone ?? "top";

    // 1. Remove the dragged block from wherever it is
    const [movedBlock, afterRemove] = removeBlockFromTree(blocks, srcId);
    if (!movedBlock) { setDragBlockId(null); setDropTarget(null); return; }

    // 2. Find the target in the post-removal tree
    const tgtLoc = findBlock(afterRemove, targetId);
    if (!tgtLoc) {
      // Target disappeared (e.g. column cleaned up) — just put block back at end
      afterRemove.push(movedBlock);
      trackedOnChange(afterRemove, true);
      setDragBlockId(null); setDropTarget(null);
      return;
    }

    let result = [...afterRemove];

    if (colTarget && (zone === "top" || zone === "bottom") && tgtLoc.kind === "column") {
      // Column block with top/bottom → reorder WITHIN the same column
      const cg = result[tgtLoc.colGroupIdx];
      const cols = cg.columns!.map((c) => [...c]);
      const insertAt = zone === "top" ? tgtLoc.blockIdx : tgtLoc.blockIdx + 1;
      cols[tgtLoc.colIdx].splice(insertAt, 0, movedBlock);
      result[tgtLoc.colGroupIdx] = { ...cg, columns: cols };
    } else if (colTarget && (zone === "top" || zone === "bottom") && tgtLoc.kind === "top") {
      // Target was in a column but column group was cleaned up after removal
      // (e.g. removing the block emptied the column group) — insert at top level
      const insertAt = zone === "bottom" ? tgtLoc.blockIdx + 1 : tgtLoc.blockIdx;
      result.splice(Math.min(insertAt, result.length), 0, movedBlock);
    } else if (colTarget && (zone === "left" || zone === "right") && tgtLoc.kind === "column") {
      // Column block with left/right → move to adjacent column
      const cg = result[tgtLoc.colGroupIdx];
      const cols = cg.columns!.map((c) => [...c]);
      const targetColIdx = zone === "left"
        ? Math.max(0, tgtLoc.colIdx - 1)
        : Math.min(cols.length - 1, tgtLoc.colIdx + 1);

      if (targetColIdx === tgtLoc.colIdx) {
        // No adjacent column in that direction — create a new column
        const newCol = [movedBlock];
        if (zone === "left") {
          cols.splice(tgtLoc.colIdx, 0, newCol);
        } else {
          cols.splice(tgtLoc.colIdx + 1, 0, newCol);
        }
      } else {
        // Insert into adjacent column (at end)
        cols[targetColIdx].push(movedBlock);
      }
      result[tgtLoc.colGroupIdx] = { ...cg, columns: cols };
    } else if (colTarget) {
      // Fallback for column targets — insert into the column
      if (tgtLoc.kind === "column") {
        const cg = result[tgtLoc.colGroupIdx];
        const cols = cg.columns!.map((c) => [...c]);
        cols[tgtLoc.colIdx].push(movedBlock);
        result[tgtLoc.colGroupIdx] = { ...cg, columns: cols };
      } else {
        result.splice(tgtLoc.blockIdx + 1, 0, movedBlock);
      }
    } else if (tgtLoc.kind === "top") {
      // Top-level target
      if (zone === "left" || zone === "right") {
        const tgtBlock = result[tgtLoc.blockIdx];
        if (tgtBlock.type === "column_group" || movedBlock.type === "column_group") {
          // Can't nest — just insert above
          result.splice(tgtLoc.blockIdx, 0, movedBlock);
        } else {
          const colGroup: CanvasBlock = {
            id: uid(),
            type: "column_group",
            columns: zone === "left" ? [[movedBlock], [tgtBlock]] : [[tgtBlock], [movedBlock]],
          };
          result.splice(tgtLoc.blockIdx, 1, colGroup);
        }
      } else {
        const insertAt = zone === "bottom" ? tgtLoc.blockIdx + 1 : tgtLoc.blockIdx;
        result.splice(insertAt, 0, movedBlock);
      }
    }

    // Ensure we never have an empty canvas
    if (result.length === 0) result = [blankBlock("text")];

    trackedOnChange(result, true);
    setDragBlockId(null);
    setDropTarget(null);
  }, [dragBlockId, dropTarget, blocks, trackedOnChange]);

  const onGlobalDragEnd = useCallback(() => {
    setDragBlockId(null);
    setDropTarget(null);
  }, []);

  /* ── Empty state ── */
  useEffect(() => { if (blocks.length === 0) onChange([blankBlock("text")]); }, [blocks.length, onChange]); // eslint-disable-line react-hooks/exhaustive-deps
  if (blocks.length === 0) return null;

  return (
    <div className="canvas-editor">
      {blocks.map((block, idx) => {
        const isTarget = dropTarget?.targetId === block.id && dragBlockId !== null && dragBlockId !== block.id && !dropTarget?.colTarget;
        const zone = isTarget ? dropTarget.zone : null;

        return (
          <React.Fragment key={block.id}>
            {idx > 0 && (
              <div className="canvas-insert-line" onClick={() => insertBlockAt(idx - 1)}>
                <span className="canvas-insert-line-plus">+</span>
              </div>
            )}
            <div
              className={
                "canvas-block" +
                (zone === "top" ? " canvas-drop-top" : "") +
                (zone === "bottom" ? " canvas-drop-bottom" : "") +
                (zone === "left" ? " canvas-drop-left" : "") +
                (zone === "right" ? " canvas-drop-right" : "") +
                (dragBlockId === block.id ? " canvas-block-dragging" : "")
              }
              onDragStart={(e) => onGlobalDragStart(e, block.id)}
              onDragOver={(e) => onGlobalDragOver(e, block.id)}
              onDrop={(e) => onGlobalDrop(e, block.id)}
              onDragEnd={(e) => { (e.currentTarget as HTMLElement).draggable = false; onGlobalDragEnd(); }}
              onDragLeave={() => { if (dropTarget?.targetId === block.id) setDropTarget(null); }}
            >
              <div className="canvas-block-controls">
                <button className="canvas-control-btn canvas-control-add" onClick={() => insertBlockAt(idx)} title="Add block below">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/></svg>
                </button>
                <div className="canvas-control-btn canvas-control-grip" title="Drag to reorder"
                  onMouseDown={(e) => {
                    /* Enable draggable on the block only when grabbing the grip */
                    const blockEl = (e.currentTarget as HTMLElement).closest(".canvas-block") as HTMLElement;
                    if (blockEl) blockEl.draggable = true;
                  }}>
                  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                    <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
                    <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
                    <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
                  </svg>
                </div>
              </div>
              <div className="canvas-block-content">
                <BlockRenderer block={block} updateBlock={updateBlock} deleteBlock={deleteBlock}
                  handleSlashOpen={handleSlashOpen} setSlashFilter={setSlashFilter} handleSlashDismiss={handleSlashDismiss}
                  onGlobalDragStart={onGlobalDragStart} onGlobalDragOver={onGlobalDragOver} onGlobalDrop={onGlobalDrop} onGlobalDragEnd={onGlobalDragEnd}
                  dragBlockId={dragBlockId} dropTarget={dropTarget}
                />
              </div>
            </div>
          </React.Fragment>
        );
      })}

      <div className="canvas-trailing-add" onClick={() => insertBlockAt(blocks.length - 1)}>
        <span className="canvas-trailing-add-label">+ Add a block</span>
      </div>

      {slashBlockId && <SlashCommandMenu position={slashPosition} filter={slashFilter} onSelect={handleSlashSelect} onClose={handleSlashDismiss} />}
    </div>
  );
}
