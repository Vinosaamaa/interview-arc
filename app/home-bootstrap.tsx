"use client";

import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import type HomeClient from "./home-client";
import type { EngineeringJournalIndex } from "../engineering-journal/index";

type HomeProps = ComponentProps<typeof HomeClient>;
type BootstrapProps = Pick<HomeProps, "today" | "initialLocation">;
type LoadedHome = {
  Component: ComponentType<HomeProps>;
  content: HomeProps["content"];
  engineering: EngineeringJournalIndex;
};

export default function HomeBootstrap(props: BootstrapProps) {
  const [loaded, setLoaded] = useState<LoadedHome | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.all([
      import("./home-client"),
      import("../engineering-journal/generated/index.json"),
      fetch("/api/content-index", { signal: controller.signal, cache: "no-store" }).then(async response => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("Content unavailable");
        }
        return response.json() as Promise<HomeProps["content"]>;
      }),
    ]).then(([home, journal, content]) => {
      if (active) setLoaded({ Component: home.default, engineering: journal.default as EngineeringJournalIndex, content });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  if (loaded) return <loaded.Component {...props} content={loaded.content} engineering={loaded.engineering} />;
  return <main className="home-bootstrap" aria-busy={!failed}>
    <span className="brand-mark" aria-hidden="true" />
    <h1>Interview Arc</h1>
    <p role={failed ? "alert" : "status"}>{failed ? "Your workspace could not load. Try again, or reload to sign in again." : "Opening your workspace…"}</p>
    {failed && <button type="button" className="primary-action" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>}
    <noscript>Enable JavaScript to open your private workspace.</noscript>
  </main>;
}
