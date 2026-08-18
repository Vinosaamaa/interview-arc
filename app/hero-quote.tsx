import type { ReactNode } from "react";

export default function HeroQuote({ className, children }: { className: string; children: ReactNode }) {
  return <p className={className}>{`\u201C`}{children}{`\u201D`}</p>;
}
