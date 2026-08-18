"use client";

import type { ReactNode } from "react";

import "./workspace-identity.css";

export type WorkspaceIdentityId = "interview" | "learn" | "engineering";

const WORKSPACE_IDENTITY: Record<WorkspaceIdentityId, { label: string; title: string }> = {
  interview: { label: "Interview", title: "Interview workspace" },
  learn: { label: "Learn", title: "Learn workspace" },
  engineering: { label: "Engineering", title: "Engineering workspace" },
};

function InterviewMotif() {
  return (
    <svg className="workspace-nameplate-motif" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.6 16.8a8.2 8.2 0 1 1 12.8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 7.2v4.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12.8" r="1.35" fill="currentColor" />
    </svg>
  );
}

function LearnMotif() {
  return (
    <svg className="workspace-nameplate-motif" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.8h8.1A2.1 2.1 0 0 1 18.2 7.9v10.3H10A2.1 2.1 0 0 1 7.9 16.1V5.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.9 8.1H6.6A1.7 1.7 0 0 0 4.9 9.8v8.4A2 2 0 0 0 6.9 20.2h9.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12.1 9.1v6.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EngineeringMotif() {
  return (
    <svg className="workspace-nameplate-motif" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8 19.4 12 12 20.2 4.6 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 3.8 12 20.2M4.6 12h14.8" fill="none" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

const MOTIFS: Record<WorkspaceIdentityId, ReactNode> = {
  interview: <InterviewMotif />,
  learn: <LearnMotif />,
  engineering: <EngineeringMotif />,
};

export function WorkspaceNameplate({ workspace }: { workspace: WorkspaceIdentityId }) {
  const { label, title } = WORKSPACE_IDENTITY[workspace];
  return (
    <p className={`workspace-nameplate workspace-nameplate-${workspace}`} aria-label={title}>
      <span className="workspace-nameplate-crest" aria-hidden="true">{MOTIFS[workspace]}</span>
      <strong>{label}</strong>
    </p>
  );
}
