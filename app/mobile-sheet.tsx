"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { acquireDocumentScrollLock } from "./document-scroll-policy";

/** Native modal semantics keep focus and pointer input inside the phone sheet. */
export default function MobileSheet({ title, open, onClose, children }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
    const release = acquireDocumentScrollLock();
    const media = window.matchMedia("(max-width: 600px)");
    const resize = () => { if (!media.matches) onClose(); };
    media.addEventListener("change", resize);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null;
      element.close();
      element.classList.remove("closing");
      release();
      media.removeEventListener("change", resize);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  return <dialog ref={dialog} className="phone-sheet" aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="phone-sheet-content">
      <header><h2 id={titleId}>{title}</h2><button type="button" className="phone-sheet-close" onClick={close}>Close</button></header>
      {open ? children : null}
    </section>
  </dialog>;
}
