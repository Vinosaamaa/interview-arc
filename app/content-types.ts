// Stable content types shared by the D1 loader (`db/content.ts`), the client UI
// (`app/home-client.tsx`), and the Git-to-D1 import script.

import type { BehavioralPracticeScenario } from "../db/behavioral-practice-scenario";

export type JournalActivity = {
  schemaVersion: number;
  id: string;
  questionId?: string;
  date: string;
  source: "daily" | "extra";
  type: "leetcode" | "system_design" | "behavioral";
  recordKind?: "attempt" | "walkthrough";
  title: string;
  url?: string;
  prompt?: string;
  allocatedSeconds: number;
  sessionId?: string;
  timerGroupId?: string;
  timingSource: "website" | "manual" | "unknown";
  startedAt?: string;
  endedAt?: string;
  elapsedSeconds?: number;
  status: "planned" | "running" | "completed";
  outcome?: "solved" | "solved_after_reviewing_approach" | "failed";
  artifactPath?: string;
  notes?: string;
  reviewDates?: string[];
  reviewOfActivityId?: string;
  reviewReason?: "failed" | "full_walkthrough" | "approach_review" | "manual" | "successful_recall";
  vocabularyPackIds?: string[];
  speechTerms?: string[];
};

export type TimerGroup = {
  id: string;
  label: string;
  allocatedSeconds: number;
  activityIds: string[];
};

export type PracticeSession = {
  id: string;
  date?: string;
  label: string;
  source: "daily" | "extra";
  allocatedSeconds: number;
  activityIds: string[];
};

// Exact owner-private payloads accepted by the practice-state command Module.
// Keep them beside the durable activity/session shapes so the browser and D1
// adapters share one compile-time contract without a client runtime import.
export type PracticeStateExtraActivity = JournalActivity & {
  timerGroupId: string;
  workbenchId?: string;
};

export type PracticeStateSession = PracticeSession & {
  source: "extra";
  date: string;
  workbenchId?: string;
};

export type DailyJournal = {
  schemaVersion: number;
  date: string;
  focus: string;
  note?: string;
  sessions: PracticeSession[];
  timerGroups: TimerGroup[];
  activities: JournalActivity[];
};

export type QuestionBankItem = {
  id: string;
  problemNumber?: number;
  title: string;
  prompt?: string;
  url?: string;
  difficulty?: "easy" | "medium" | "hard";
  complexity?: "very_easy" | "easy" | "medium" | "hard" | "very_hard";
  acceptanceRate?: number;
  source?: string;
  solutionReference?: boolean;
  solutionPath?: string;
  solutionProfile?: {
    schemaVersion: 1;
    summary: string;
    sections: Array<{ title: string; body: string }>;
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
  };
  frequency?: "low" | "medium" | "high";
  answerFormat?: "SIMPLE" | "STAR" | "STARL" | "PPF" | "IFV";
  referenceAccess?: "public" | "may_require_sign_in";
  companyTags?: string[];
  companySignals?: { company: string; window: string; frequencyScore: number; frequencyScale: number; capturedAt: string }[];
  topics: string[];
  tags?: string[];
  vocabularyPackIds?: string[];
  speechTerms?: string[];
  priority?: number;
  targetMinutes: number;
  active: boolean;
};

export type QuestionBanks = {
  leetcode: QuestionBankItem[];
  systemDesign: QuestionBankItem[];
  behavioral: QuestionBankItem[];
};

export type ContentSection = { title: string; body: string };
export type ContentArtifact = {
  path: string;
  type: string;
  title: string;
  date: string;
  activityId: string;
  status: string;
  audioFile: string;
  audioAvailability: string;
  sections: ContentSection[];
};

export type StoryProject = ContentArtifact & { projectId: string };
export type ContentIndex = {
  journals: DailyJournal[];
  artifacts: ContentArtifact[];
  stories: StoryProject[];
  questionBanks: QuestionBanks;
};
