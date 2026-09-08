"use client";

import { createPortal } from "react-dom";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { acquireDocumentScrollLock } from "./document-scroll-policy";

const CODE_KEYWORDS = new Set([
  "abstract", "async", "await", "boolean", "break", "case", "catch", "class", "const", "continue", "def", "do", "else", "enum", "extends", "false", "final", "finally", "float", "for", "from", "if", "implements", "import", "in", "instanceof", "int", "interface", "let", "list", "long", "map", "new", "none", "null", "private", "protected", "public", "raise", "return", "self", "static", "string", "super", "switch", "this", "throw", "true", "try", "var", "void", "while", "yield",
]);

function highlightedCode(code: string, language: string) {
  if (language.toLowerCase() === "text") return code;
  const tokenPattern = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm;
  return code.split(tokenPattern).filter(Boolean).map((token, index) => {
    const kind = token.startsWith("//") || token.startsWith("#")
      ? "comment"
      : token.startsWith('"') || token.startsWith("'")
        ? "string"
        : /^\d/.test(token)
          ? "number"
          : CODE_KEYWORDS.has(token.toLowerCase())
            ? "keyword"
            : "plain";
    return kind === "plain" ? token : <span className={`syntax-${kind}`} key={`${index}-${token.slice(0, 8)}`}>{token}</span>;
  });
}

export default function CodeBlock({ language, code, title, meta }: {
  language: string;
  code: string;
  title?: string;
  meta?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [placeholderStyle, setPlaceholderStyle] = useState({ height: 260, margin: "0px" });
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const displayTitle = title || language || "Code";
  const closeFullscreen = useCallback(() => {
    restoreFocusRef.current = true;
    setExpanded(false);
  }, []);

  useEffect(() => {
    if (!expanded) {
      if (!restoreFocusRef.current) return;
      const focusFrame = window.requestAnimationFrame(() => {
        restoreFocusRef.current = false;
        expandRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(focusFrame);
    }
    const releaseScrollLock = acquireDocumentScrollLock();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeFullscreen();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown, true);
      releaseScrollLock();
    };
  }, [closeFullscreen, expanded]);

  const stage = (fullscreen: boolean) => <figure className={`code-stage ${fullscreen ? "fullscreen" : ""} ${wrapped ? "code-wrapped" : ""}`} role="group" aria-label={`${displayTitle} viewer`}>
    <figcaption>
      <span className="code-stage-heading"><strong>{displayTitle}</strong>{title ? <small>{language || "code"}</small> : null}</span>
      {meta ? <span className="code-stage-caption-meta">{meta}</span> : null}
      <span className="code-stage-actions">
        <button type="button" onClick={() => setWrapped(value => !value)} aria-pressed={wrapped} aria-label={`Wrap ${displayTitle} lines`}>Wrap</button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(code)} aria-label={`Copy ${displayTitle}`}>Copy</button>
        <button type="button" ref={fullscreen ? closeRef : expandRef} onClick={fullscreen ? closeFullscreen : (event) => {
          const figure = event.currentTarget.closest("figure");
          if (figure) setPlaceholderStyle({ height: figure.getBoundingClientRect().height, margin: getComputedStyle(figure).margin });
          setExpanded(true);
        }} aria-label={fullscreen ? `Close full-screen ${displayTitle}` : `Expand ${displayTitle}`}>{fullscreen ? "Close" : "Expand"}</button>
      </span>
    </figcaption>
    <pre tabIndex={0} aria-label={`${displayTitle} code`}><code>{highlightedCode(code, language)}</code></pre>
  </figure>;

  if (!expanded || typeof document === "undefined") return stage(false);

  return <>
    <div className="code-stage-placeholder" style={{ ...placeholderStyle, minHeight: 0 }} aria-hidden="true" />
    {createPortal(<div className="code-stage-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeFullscreen();
    }}>
      <div className="code-stage-dialog" role="dialog" aria-modal="true" aria-label={`${displayTitle} full-screen viewer`} ref={dialogRef} tabIndex={-1}>
        {stage(true)}
      </div>
    </div>, document.body)}
  </>;
}
