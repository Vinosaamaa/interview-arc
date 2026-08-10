"use client";

import type { ActivityType } from "./live-types";

type Props = {
  type: Extract<ActivityType, "leetcode" | "system_design">;
  total: number;
  finished: number;
  dueNow: number;
  needsReview: number;
  reusableSolutions: number;
  starred: number;
  topicCount: number;
};

const COPY = {
  leetcode: {
    eyebrow: "CODING BANK · PRACTICE SIGNALS",
    title: "Build an intentional algorithm ladder.",
    description: "Completion, recall pressure, reusable solutions, and topic coverage come from the current owner-scoped practice record.",
    shelf: "Solution shelf",
    shelfNote: "Reusable coding profiles",
    coverage: "Topic coverage",
    coverageNote: "Distinct coding signals",
  },
  system_design: {
    eyebrow: "SYSTEM-DESIGN BANK · PRACTICE SIGNALS",
    title: "Practice architecture decisions, not diagram theater.",
    description: "Completion, recall pressure, reusable design profiles, and topic coverage come from the current owner-scoped practice record.",
    shelf: "Design shelf",
    shelfNote: "Reusable design profiles",
    coverage: "Topic coverage",
    coverageNote: "Distinct design signals",
  },
} as const;

export default function BankDomainOverview({
  type,
  total,
  finished,
  dueNow,
  needsReview,
  reusableSolutions,
  starred,
  topicCount,
}: Props) {
  const copy = COPY[type];
  const remaining = Math.max(0, total - finished);
  const metrics = [
    { key: "completed", label: "COMPLETED", value: finished, title: "Finished attempts", description: `${remaining} prompt${remaining === 1 ? "" : "s"} remain uncompleted.` },
    { key: "recall", label: "RECALL NOW", value: dueNow, title: "Due today", description: `${needsReview} prompt${needsReview === 1 ? " has" : "s have"} an open review signal.` },
    { key: "shelf", label: copy.shelf.toUpperCase(), value: reusableSolutions, title: copy.shelf, description: `${copy.shelfNote} available from the shared reader.` },
    { key: "coverage", label: copy.coverage.toUpperCase(), value: topicCount, title: copy.coverage, description: `${copy.coverageNote} across the current bank.` },
  ];

  return (
    <section className={`bank-domain-overview ${type}`} aria-labelledby={`bank-domain-${type}-title`}>
      <header className="bank-domain-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id={`bank-domain-${type}-title`}>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <small>{total} prompt{total === 1 ? "" : "s"} in this bank</small>
      </header>
      <div className="bank-domain-ledger">
        {metrics.map((metric) => <article key={metric.key}>
          <span className="bank-domain-index">{metric.label}</span>
          <strong>{metric.value}</strong>
          <h3>{metric.title}</h3>
          <p>{metric.description}</p>
        </article>)}
      </div>
      <footer><strong>{starred} starred</strong><span>These totals report saved state; they do not infer mastery.</span></footer>
    </section>
  );
}
