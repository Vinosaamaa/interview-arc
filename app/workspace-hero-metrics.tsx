import type { ReactNode } from "react";

export type WorkspaceHeroMetric = {
  value: ReactNode;
  label: string;
};

type WorkspaceHeroMetricsProps = {
  metrics: readonly WorkspaceHeroMetric[];
  className?: string;
};

export default function WorkspaceHeroMetrics({ metrics, className = "" }: WorkspaceHeroMetricsProps) {
  return <dl className={`workspace-hero-metrics ${className}`.trim()}>
    {metrics.map((metric, index) => <div key={`${metric.label}-${index}`}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
  </dl>;
}
