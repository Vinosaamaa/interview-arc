"use client";

import { useEffect, useRef } from "react";

/** Phone lists scroll with the document; desktop keeps its list scroll handler. */
export default function BankProgressiveStatus({ mounted, total, onLoadMore }: { mounted: number; total: number; onLoadMore: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const media = window.matchMedia("(max-width: 600px)");
    const observer = new IntersectionObserver(entries => {
      if (media.matches && entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onLoadMore]);
  return <div ref={sentinel} className="bank-progressive-status" role="status">Showing {mounted} of {total} matching questions. Scroll for more.</div>;
}
