"use client";

import { Children, type ReactNode, useCallback, useState } from "react";
import MobileSheet from "./mobile-sheet";
import { MobileNavIcon } from "./mobile-navigation";

/** Keep the original controls on desktop; expose secondary controls in a sheet on phones. */
export default function MobileRowActions({ title, children, primaryIndex = -1 }: {
  title: string;
  children: ReactNode;
  primaryIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const actions = Children.toArray(children);
  const primary = primaryIndex < 0 ? actions.length - 1 : primaryIndex;
  return <>
    <div className="desktop-row-actions">{children}</div>
    <div className="phone-row-actions">
      {actions[primary]}
      <button type="button" className="phone-row-more" aria-label={`More actions for ${title}`} aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}><MobileNavIcon label="More" /></button>
    </div>
    {open && <MobileSheet title={title} open onClose={close}>
      <div className="phone-secondary-actions" onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest("button:not(:disabled)") : null;
        if (target) close();
      }}>{actions.filter((_, index) => index !== primary)}</div>
    </MobileSheet>}
  </>;
}
