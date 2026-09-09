"use client";

import { useCallback, useState } from "react";
import MobileSheet from "./mobile-sheet";

type Destination = { id: string; label: string; select: () => void };
const paths: Record<string, string> = {
  Today: "M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16",
  Reviews: "M20 10a8 8 0 1 0-2 8 M20 4v6h-6 M12 8v5l3 2",
  Banks: "M4 4h6v16H4z M14 4h6v16h-6z",
  Past: "M12 8v5l3 2 M4 5v5h5 M4 10a8 8 0 1 1 0 5",
  More: "M4 12h.01 M12 12h.01 M20 12h.01",
  Loops: "M9 8H6a4 4 0 0 0 0 8h3 M15 8h3a4 4 0 0 1 0 8h-3 M8 12h8",
  Journey: "M4 20V10 M10 20V4 M16 20v-7 M22 20V7",
  Journal: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5",
  Capabilities: "M12 3l3 5 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z",
  Decisions: "M12 3v7 M5 21v-6l7-5 7 5v6 M2 18l3 3 3-3 M16 18l3 3 3-3",
  Incidents: "M12 3 2 21h20z M12 9v5 M12 17h.01",
  History: "M12 8v5l3 2 M4 5v5h5 M4 10a8 8 0 1 1 0 5",
  Statistics: "M4 20V10 M10 20V4 M16 20v-7 M22 20V7",
};

export function MobileNavIcon({ label }: { label: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[label] ?? "M4 4h7l1 2 1-2h7v15h-7l-1 2-1-2H4z M12 6v15"} /></svg>;
}

function DestinationButton({ item, selected, onSelect }: { item: Destination; selected: string; onSelect?: () => void }) {
  return <button type="button" aria-current={selected === item.id ? "page" : undefined} onClick={() => { onSelect?.(); item.select(); }}><MobileNavIcon label={item.label} /><span>{item.label}</span>{onSelect && <span aria-hidden="true">→</span>}</button>;
}

export default function MobileNavigation({ workspace, selected, items }: {
  workspace: string;
  selected: string;
  items: Destination[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const close = useCallback(() => setMoreOpen(false), []);
  const primary = items.slice(0, 4);
  const secondary = items.slice(4);
  return <>
    <nav className="phone-navigation" aria-label={`${workspace} phone navigation`}>
      {primary.map((item) => <DestinationButton key={item.id} item={item} selected={selected} />)}
      {secondary.length > 0 && <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={secondary.some((item) => item.id === selected) ? "page" : undefined} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setMoreOpen(true); }}><MobileNavIcon label="More" /><span>More</span></button>}
    </nav>
    <MobileSheet title={`${workspace} pages`} open={moreOpen} onClose={close}>
      <nav className="phone-more-destinations" aria-label={`More ${workspace} pages`}>
        {secondary.map((item) => <DestinationButton key={item.id} item={item} selected={selected} onSelect={close} />)}
      </nav>
    </MobileSheet>
  </>;
}
