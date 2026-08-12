export type DocumentScrollView =
  | "today"
  | "loops"
  | "journey"
  | "reviews"
  | "library"
  | "banks"
  | "materials";

type DocumentScrollLockInput = {
  arrivalState: "show" | "leaving" | "entered";
  view: DocumentScrollView;
  pastReaderOpen: boolean;
  bankReaderOpen: boolean;
  journeyReaderOpen: boolean;
  reviewReaderOpen: boolean;
};

type OverflowStyle = { overflow: string };
type OverflowLockState = { original: string; leases: Set<symbol> };
const overflowLocks = new WeakMap<OverflowStyle, OverflowLockState>();

export function documentScrollLockRequired({
  arrivalState,
  view,
  pastReaderOpen,
  bankReaderOpen,
  journeyReaderOpen,
  reviewReaderOpen,
}: DocumentScrollLockInput) {
  if (arrivalState !== "entered") return true;
  if (view === "library") return pastReaderOpen;
  if (view === "banks") return bankReaderOpen;
  if (view === "journey") return journeyReaderOpen;
  if (view === "reviews") return reviewReaderOpen;
  return false;
}

export function acquireDocumentScrollLock(style: OverflowStyle = document.body.style) {
  let state = overflowLocks.get(style);
  if (!state) {
    state = { original: style.overflow, leases: new Set() };
    overflowLocks.set(style, state);
    style.overflow = "hidden";
  }

  const lease = Symbol("document-scroll-lock");
  state.leases.add(lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = overflowLocks.get(style);
    if (!current) return;
    current.leases.delete(lease);
    if (current.leases.size > 0) return;
    style.overflow = current.original;
    overflowLocks.delete(style);
  };
}
