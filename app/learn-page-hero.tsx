"use client";
import type { ReactNode } from "react";
import HeroQuote from "./hero-quote";
import WorkspaceHeroMetrics from "./workspace-hero-metrics";
import "./learn-workspace.css";
function LearnAnimalSketch({ destination }: { destination: string }) {
  if (destination === "courses") return <svg viewBox="0 0 260 210" role="img" aria-label="An owl watching over an evolving syllabus"><path d="M72 72c8-34 31-51 58-37 28-14 51 3 59 37 13 53-8 99-59 111-51-12-72-58-58-111Z" /><path d="M86 54 69 30l38 16M174 54l17-24-38 16M94 89a22 22 0 1 0 44 0 22 22 0 0 0-44 0Zm28 0h16m28 0a22 22 0 1 1-44 0M122 113l8 11 8-11M106 147c15 8 33 8 49 0M92 181h76" /></svg>;
  if (destination === "history") return <svg viewBox="0 0 260 210" role="img" aria-label="An elephant carrying a private learning history"><path d="M66 83c7-36 35-56 75-50 36 5 59 31 57 68-1 28-16 48-40 58H91c-30-13-38-44-25-76Z" /><path d="M189 78c23 10 31 31 23 62-5 21-18 30-39 27M173 167c15 8 27 6 36-7M88 154v33M154 158v29M70 82 48 64l8 38M112 71a5 5 0 1 0 0 .1M137 32c-8 21-6 39 8 55" /></svg>;
  if (destination === "analytics") return <svg viewBox="0 0 260 210" role="img" aria-label="A honeybee tracing measured learning signals"><path d="M86 105c0-31 20-52 48-52s48 21 48 52-20 51-48 51-48-20-48-51Z" /><path d="M103 66c-24-25-51-23-62 5 17 21 38 27 63 18M164 67c23-26 50-24 62 4-17 21-39 27-64 18M97 86h73M88 109h92M100 135h69M134 53V29M122 29l12-13 12 13M87 154l-24 23M180 153l23 24" /></svg>;
  return <svg viewBox="0 0 260 210" role="img" aria-label="A fox picking up the current learning thread"><path d="M68 88 52 35l48 25c18-13 42-13 60 0l48-25-16 53c12 20 10 45-7 65-15 18-34 27-55 27s-40-9-55-27c-17-20-19-45-7-65Z" /><path d="M83 65 63 49l12 35M177 65l20-16-12 35M94 108a6 6 0 1 0 0 .1M166 108a6 6 0 1 0 0 .1M113 132c11 8 23 8 34 0M130 128v17M94 147c24 12 48 12 72 0" /></svg>;
}

export default function LearnPageHero({ destination, eyebrow, title, quote, description, metrics, action }: {
  destination: string; eyebrow: string; title: ReactNode; quote: string; description: string;
  metrics: Array<{ label: string; value: string | number }>; action?: ReactNode;
}) {
  return <header className={`learn-frame learn-hero learn-hero-${destination}`}>
    <div className="learn-hero-copy"><span className="learn-eyebrow">{eyebrow}</span><h1>{title}</h1>
      <HeroQuote className="learn-hero-quote">{quote}</HeroQuote><p className="learn-hero-lede">{description}</p>
      {action ?? <a href="/resources">Study resource library</a>}
    </div>
    <div className="learn-animal-sketch"><LearnAnimalSketch destination={destination === "materials" || destination === "library" ? "courses" : destination}/></div>
    <span className="learn-hero-pulse" aria-hidden="true"/><span className="learn-hero-light-band" aria-hidden="true"/>
    <WorkspaceHeroMetrics className="learn-hero-metrics" metrics={metrics}/>
  </header>;
}
