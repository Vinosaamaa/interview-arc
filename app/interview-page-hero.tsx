import type { ReactNode } from "react";

import HeroQuote from "./hero-quote";

export type InterviewPageTone = "today" | "loops" | "reviews" | "past" | "banks" | "journey" | "materials";

type HeroMetric = {
  value: ReactNode;
  label: string;
};

type InterviewPageHeroProps = {
  tone: InterviewPageTone;
  eyebrow: string;
  title: ReactNode;
  quote: ReactNode;
  description?: ReactNode;
  metrics?: HeroMetric[];
  footer?: ReactNode;
};

function BotanicalArtwork({ tone }: { tone: InterviewPageTone }) {
  if (tone === "past") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M312 49h129v157H312zM329 71h86M329 90h66M329 109h79M329 128h59"/><path d="M438 66l78 18-27 127-78-18M460 98l35 8M455 119l31 7M450 140l24 6"/><path d="M297 59h-41c-21 0-36 17-36 38v103h92"/><path d="M248 113c29-9 45-1 56 20-30 9-48 2-56-20Zm12 56c27-15 48-11 64 7-28 15-50 11-64-7Z"/></g></svg>;
  if (tone === "banks") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M214 63h114v145H214zM233 86h72M233 106h56M233 126h65"/><path d="M331 50h150v159H331zM352 75h107M352 98h80"/><path d="M390 181c5-57 39-85 103-93-4 57-38 88-103 93Z"/><path d="M414 162c16-35 44-54 83-64M438 140l-4-25M463 121l11-23M475 145l29-6"/></g></svg>;
  if (tone === "journey") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path className="art-dash" d="M82 196c61-8 66-71 129-64 69 8 74-69 142-55 76 16 92-24 166-41"/><circle cx="82" cy="196" r="8"/><circle cx="211" cy="132" r="8"/><circle cx="353" cy="77" r="8"/><circle cx="519" cy="36" r="8"/><path d="M118 185c-19-25-18-50 3-75 22 24 21 49-3 75Zm53-71c6-34 27-52 62-55-5 34-25 54-62 55Zm246 40c15-42 45-61 90-55-13 40-43 61-90 55Z"/><path d="M419 154c25 8 44 22 58 43M446 166l8-27M471 188l28-10"/></g></svg>;
  if (tone === "materials") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M184 61h122v150H184zM207 91h76M207 112h57M207 133h65M334 79h104v132H334zM356 105h60M356 126h47"/><path d="M462 63h101v148H462zM462 63l50 38 51-38"/><path d="M165 189c-29-37-22-76 19-112 28 38 22 75-19 112ZM153 154l-34-15M165 129l13-34"/></g></svg>;
  if (tone === "today") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M170 64c47-22 93-16 137 17v139c-44-32-90-38-137-16V64Zm137 17c47-33 94-39 141-17v140c-47-22-94-16-141 16V81Z"/><path d="M193 92c34-13 65-8 91 10M193 117c34-13 65-8 91 10M330 101c29-14 60-18 92-8M330 126c29-14 60-18 92-8"/><path d="M473 182c-10-52 10-91 60-115 11 52-9 90-60 115ZM490 147l-29-17M509 119l4-31"/></g></svg>;
  if (tone === "reviews") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M184 186c47-18 83-56 107-115 29 41 24 78-15 111-28 24-59 26-92 4Z"/><path d="M275 181c19-56 54-92 105-108M306 137c-24-25-30-52-17-82 27 23 33 50 17 82ZM343 107c28-22 58-25 88-9-27 23-57 26-88 9Z"/><circle cx="452" cy="69" r="35"/><path d="M437 69h30M452 54v30M491 155l44 44M535 155l-44 44"/></g></svg>;
  if (tone === "loops") return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path className="art-dash" d="M105 196c58-35 53-82 113-91 54-8 78 30 127 2 42-24 41-67 110-74"/><circle cx="105" cy="196" r="8"/><circle cx="218" cy="105" r="8"/><circle cx="345" cy="107" r="8"/><circle cx="455" cy="33" r="8"/><path d="M146 169c-18-29-16-56 7-82 23 28 21 55-7 82ZM263 111c20-32 48-45 84-37-19 32-47 45-84 37ZM390 83c3-36 22-58 57-68-2 35-21 58-57 68Z"/></g></svg>;
  return <svg viewBox="0 0 620 250" aria-hidden="true"><g className="art-line"><path d="M210 191c23-32 39-68 48-109M258 111c-29-12-46-31-50-57 30 10 47 29 50 57ZM251 139c34-9 60-3 79 20-34 10-61 3-79-20ZM304 181c22-31 52-46 89-44-21 31-51 46-89 44Z"/><path d="M338 69c55 12 105 45 151 99M369 76c2-29 16-49 42-60 0 29-14 49-42 60ZM410 101c27-19 54-21 81-7-27 20-54 22-81 7ZM454 139c29-10 54-4 73 19-30 10-54 4-73-19Z"/><circle cx="338" cy="69" r="7"/><circle cx="410" cy="101" r="7"/><circle cx="489" cy="168" r="7"/></g></svg>;
}

export default function InterviewPageHero({ tone, eyebrow, title, quote, description, metrics, footer }: InterviewPageHeroProps) {
  return <header className={`interview-page-hero tone-${tone}`}>
    <div className="page-hero-narrative">
      <div className="page-hero-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><HeroQuote className="page-hero-quote">{quote}</HeroQuote>{description ? <p className="page-hero-lede">{description}</p> : null}</div>
      <div className="page-hero-art" aria-hidden="true"><BotanicalArtwork tone={tone} /></div>
      <span className="page-hero-pulse" aria-hidden="true" />
      <span className="page-hero-light-band" aria-hidden="true" />
    </div>
    <div className={`page-hero-summary ${footer ? "interactive" : ""}`}>
      {footer ?? metrics?.map((metric, index) => <div className="page-hero-metric" key={`${metric.label}-${index}`}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}
    </div>
  </header>;
}
