"use client";

import { type ReactNode, useCallback, useState } from "react";
import MobileSheet from "./mobile-sheet";
import { MobileNavIcon } from "./mobile-navigation";

/** One shared row for coding, mocks and standalone practice. */
export default function TodayActivityRow({ title, mark, metadata, details, controls }: {
  title: string;
  mark: ReactNode;
  metadata: string;
  details: ReactNode;
  controls: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <article className="today-activity-row">
    {mark}
    <div className="today-activity-copy"><strong title={title}>{title}</strong><small>{metadata}</small></div>
    <div className="today-activity-controls">{!open && controls}</div>
    <button type="button" className="today-activity-more" aria-label={`More actions for ${title}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}><MobileNavIcon label="More" /></button>
    {open && <MobileSheet title={title} open onClose={close} maxWidth={null}>
      <div className="today-activity-details">{details}{controls}</div>
    </MobileSheet>}
  </article>;
}
