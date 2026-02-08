"use client";

import React, { useRef, useCallback, useEffect } from "react";

interface CodeBlockProps {
  content: string;
  language: string;
  onChange: (content: string, language: string) => void;
}

export default function CodeBlock({ content, language, onChange }: CodeBlockProps) {
  const codeRef = useRef<HTMLPreElement>(null);
  const isComposing = useRef(false);

  /* Sync content when not focused */
  useEffect(() => {
    if (codeRef.current && document.activeElement !== codeRef.current) {
      codeRef.current.textContent = content;
    }
  }, [content]);

  const handleInput = useCallback(() => {
    if (isComposing.current || !codeRef.current) return;
    onChange(codeRef.current.textContent ?? "", language);
  }, [onChange, language]);

  /* Tab inserts 2 spaces */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
      }
    },
    []
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }, []);

  return (
    <div className="canvas-code-block">
      <input
        className="canvas-code-language"
        value={language}
        onChange={(e) => onChange(content, e.target.value)}
        placeholder="language"
      />
      <pre
        ref={codeRef}
        className="canvas-code-content"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write code…"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
      />
    </div>
  );
}
