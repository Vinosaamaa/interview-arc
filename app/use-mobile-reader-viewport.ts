"use client";

import { useLayoutEffect } from "react";

// iOS browser bars and keyboards change the visible viewport independently
// of the document. Keep the focused reader in that viewport and restore its
// originating page only when the last nested reader closes.
export function useMobileReaderViewport(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const phone = window.matchMedia("(max-width: 600px)");
    const viewport = window.visualViewport;
    const root = document.documentElement.style;
    let release: (() => void) | undefined;
    const update = () => {
      if (phone.matches && !release) {
        const { scrollX, scrollY } = window;
        const style = document.body.style;
        const original = { position: style.position, top: style.top, left: style.left, width: style.width };
        const oldHeight = root.getPropertyValue("--mobile-reader-height");
        const oldTop = root.getPropertyValue("--mobile-reader-top");
        Object.assign(style, { position: "fixed", top: `${-scrollY}px`, left: `${-scrollX}px`, width: "100%" });
        release = () => {
          Object.assign(style, original);
          root.setProperty("--mobile-reader-height", oldHeight);
          root.setProperty("--mobile-reader-top", oldTop);
          window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
        };
      } else if (!phone.matches && release) {
        release();
        release = undefined;
      }
      // Let native pinch zoom magnify the document without reflowing it.
      if (phone.matches && (!viewport || viewport.scale === 1)) {
        root.setProperty("--mobile-reader-height", `${viewport?.height ?? window.innerHeight}px`);
        root.setProperty("--mobile-reader-top", `${viewport?.offsetTop ?? 0}px`);
      }
    };
    update();
    phone.addEventListener("change", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      phone.removeEventListener("change", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      release?.();
    };
  }, [active]);
}
