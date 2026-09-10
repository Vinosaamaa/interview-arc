import type { BehavioralPracticeScenario } from "./behavioral-practice-scenario.ts";
import type { BehavioralProjectFocus } from "./behavioral-project-deep-dive-policy.ts";

// Shared data contracts depend only on specialty policies, never persistence.
export type Specialty = "leetcode" | "system_design" | "behavioral";

export type SolutionProfile = {
  schemaVersion: 1;
  summary: string;
  sections: Array<{ sectionKey?: string; title: string; body: string }>;
  tags: string[];
  references: Array<{ title: string; url: string; accessedAt: string }>;
  behavioralAnswer?: {
    preferred: {
      label: string;
      answer: string;
      evidence: string[];
      evidenceGaps: string[];
    };
    alternatives: Array<{
      label: string;
      answer: string;
      whenToUse?: string;
      evidence: string[];
      evidenceGaps: string[];
    }>;
  };
  practiceScenarios?: BehavioralPracticeScenario[];
  questionsAndAnswers?: {
    status: "included" | "not_applicable";
    reason: string;
    items: Array<{
      question: string;
      answer: string;
      classification: "current_implementation" | "target_design" | "fictional_practice_scenario";
      turnIds: string[];
    }>;
  };
  editorialResearch?: {
    source: "leetcode_playwright_controller" | "leetcode_mcp";
    status: "available" | "premium_locked" | "unavailable";
    url: string;
    accessedAt: string;
    contentSha256?: string;
    reason?: string;
    approaches: Array<{ title: string }>;
  };
  projectDeepDive?: {
    projectId: string;
    bindingRevision: number;
    focus: BehavioralProjectFocus;
    sourceClaimId?: string;
  };
};
