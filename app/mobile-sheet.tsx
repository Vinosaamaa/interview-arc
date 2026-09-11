"use client";

import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { acquireDocumentScrollLock } from "./document-scroll-policy";

/** Native modal semantics keep focus and pointer input inside the phone sheet. */
export default function MobileSheet({ title, open, onClose, children, maxWidth = 600, fullScreen = false, closeLabel, bodyScrollMemoryRef }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number | null;
  fullScreen?: boolean;
  closeLabel?: string;
  bodyScrollMemoryRef?: RefObject<number>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const close = useCallback(() => {
    if (timeout.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    dialog.current?.classList.add("closing");
    timeout.current = setTimeout(() => { timeout.current = null; onClose(); }, 200);
  }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    if (body.current && bodyScrollMemoryRef) body.current.scrollTop = bodyScrollMemoryRef.current;
    const release = acquireDocumentScrollLock();
    const media = maxWidth === null ? null : window.matchMedia(`(max-width: ${maxWidth}px)`);
    const resize = () => { if (media && !media.matches) onClose(); };
    media?.addEventListener("change", resize);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null;
      element.close();
      element.classList.remove("closing");
      release();
      media?.removeEventListener("change", resize);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, onClose, maxWidth, bodyScrollMemoryRef]);

  // The native top layer changes painting, not CSS ancestry. Mount outside the
  // list so section heading styles and row containment cannot reach the sheet.
  if (!open || typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className={`phone-sheet${fullScreen ? " phone-sheet-fullscreen" : ""}`} aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <section className="phone-sheet-content">
      <header><h2 id={titleId}>{title}</h2><button type="button" className="phone-sheet-close" aria-label={closeLabel} onClick={close}>Close</button></header>
      {fullScreen ? <div className="phone-sheet-body" ref={body} onScroll={(event) => { if (bodyScrollMemoryRef) bodyScrollMemoryRef.current = event.currentTarget.scrollTop; }}>{children}</div> : children}
    </section>
  </dialog>, document.body);
}
