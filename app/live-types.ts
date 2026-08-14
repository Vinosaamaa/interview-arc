import type {
  JournalActivity,
  PracticeStateExtraActivity,
  PracticeStateSession,
} from "./content-types";
import type { FocusBlock } from "./career-work";
import type { CodeAttemptReviewDisplay } from "../db/code-attempt-review";
import type { InteractionModeRegistry } from "../db/interaction-mode-policy";
import type { InteractionModeSummary } from "../db/interaction-mode-store";
import type { InteractionModeClassification } from "../db/interaction-mode-classification";
import type { BehavioralPracticeScenario } from "../db/behavioral-practice-scenario";
import type { BehavioralProjectProfileBinding } from "../db/behavioral-project-deep-dive-policy";
import type { LeetCodeEditorialResearch } from "./solution-profile-policy";
export type { FocusBlock } from "./career-work";
export type { InteractionModeSummary } from "../db/interaction-mode-store";

export type ActivityType = JournalActivity["type"];
export type Outcome = "solved" | "solved_after_reviewing_approach" | "failed";
export type PublicationStatus = "draft" | "ready" | "published";
export type NoteKind = "remember" | "insight" | "mistake" | "pattern" | "question";
export type PracticeNote = {
  id: string;
  activityId: string;
  date: string;
  body: string;
  kind: NoteKind;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};
export type ReviewSchedule = {
  reviewKey: string;
  activityId: string;
  questionId: string | null;
  specialty: ActivityType;
  status: "scheduled" | "due" | "completed" | "dismissed";
  reason: "failed" | "full_walkthrough" | "approach_review" | "manual" | "successful_recall";
  dueDate: string;
  intervalDays: number;
  stage: number;
  reviewCount: number;
};
export type FinalizationSummary = {
  activityId: string;
  specialty: ActivityType;
  status: "draft" | "ready" | "published";
  finalizedAt: number | null;
  interactionModeClassification?: {
    snapshotRevision: number;
    classification: InteractionModeClassification;
  } | null;
};
export type InteractionModeTransitionProjection = {
  transitionId: string;
  fromInteractionModeId: string | null;
  toInteractionModeId: string;
  toRevision: number;
  triggerTurnId: string | null;
  source: "explicit_user_instruction" | "workflow_transition";
  reason: string;
  occurredAt: number;
};
export type TranscriptTurn = {
  activityId: string;
  turnId: string;
  specialty: ActivityType;
  speaker: "user" | "specialist";
  body: string;
  source: "codex" | "dictation" | "audio_transcript";
  sequence: number;
  occurredAt: number;
  updatedAt: number;
  interactionMode?: { interactionModeId: string; revision: number; turnOverride?: boolean } | null;
};
export type LeetCodeCodeAttempt = {
  id: string;
  activityId: string;
  originatingTurnId: string;
  sequence: number;
  language: string;
  code: string;
  lineCount: number;
  occurredAt: number;
  review: CodeAttemptReviewDisplay;
  reviewResponseTurnId: string | null;
  observedCorrectness: "not_verified" | "appears_correct" | "issues_found" | "incomplete";
  concreteFindings: string[];
  edgeCases: string[];
  complexity: { time?: string; space?: string } | null;
  finalDeclaration: string;
};
export type AudioClip = {
  id: string;
  activityId: string;
  transcriptTurnId: string | null;
  filename: string;
  mimeType: string;
  label: string;
  durationSeconds: number | null;
  status: "local_only" | "uploading" | "available" | "failed";
};
export type DeliveryAnalysisPayload = {
  schemaVersion: 1;
  summary: string;
  durationSeconds?: number;
  wordsPerMinute?: number;
  fillerWords?: Array<{ word: string; count: number }>;
  longPauses?: Array<{ startSeconds: number; durationSeconds: number }>;
  strengths: string[];
  improvements: string[];
  observations: Array<{
    dimension: "pace" | "pauses" | "fillers" | "clarity" | "organization" | "vocal_variation" | "perceived_confidence";
    evidence: string;
    coaching: string;
  }>;
};
export type DeliveryAnalysis = {
  id: string;
  activityId: string;
  audioClipId: string;
  transcriptTurnId: string;
  specialty: ActivityType;
  status: "queued" | "processing" | "available" | "failed";
  payload: DeliveryAnalysisPayload | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ProblemPreference = { specialty: ActivityType; questionId: string; starred: boolean; updatedAt: number };
export type SolutionProfilePayload = {
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
  editorialResearch?: LeetCodeEditorialResearch;
  projectDeepDive?: BehavioralProjectProfileBinding;
};
export type SolutionProfile = {
  specialty: ActivityType;
  questionId: string;
  title: string;
  currentRevision: number;
  tags: string[];
  payload: SolutionProfilePayload;
  updatedAt: number;
};
export type SolutionRevision = {
  specialty: ActivityType;
  questionId: string;
  revision: number;
  activityId: string;
  payload: SolutionProfilePayload;
  createdAt: number;
};
export type ActivitySolutionLink = { activityId: string; specialty: ActivityType; questionId: string; solutionRevision: number };
export type PersonalQuestion = {
  specialty: ActivityType;
  questionId: string;
  title: string;
  prompt: string | null;
  url: string | null;
  source: string;
  tags: string[];
  problemNumber: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  acceptanceRate: number | null;
  topics: string[];
  companyTags: string[];
  companySignals: Array<{
    company: string;
    window: string;
    frequencyScore: number;
    frequencyScale: number;
    capturedAt: string;
  }>;
  metadataReferences: Array<{ title: string; url: string; accessedAt: string }>;
  metadataCapturedAt: number | null;
  priority: number;
  targetMinutes: number;
  active: boolean;
};
export type TimerDraft = {
  elapsedSeconds: number;
  runningSince: number | null;
  completed: boolean;
  startedAt?: number | null;
  completedAt?: number | null;
  revision?: number;
};
export type Workbench = {
  id: string;
  status: "open" | "archived";
  openedPacificDate: string;
  openedAt: number;
  closedAt: number | null;
  revision: number;
};
export type ExtraActivity = PracticeStateExtraActivity;
export type LocalSession = PracticeStateSession;
export type LocalDraft = {
  workbench: Workbench | null;
  timers: Record<string, TimerDraft>;
  sessionTimers: Record<string, TimerDraft>;
  outcomes: Record<string, Outcome>;
  publicationStatuses: Record<string, PublicationStatus>;
  notes: Record<string, string>;
  structuredNotes: Record<string, PracticeNote[]>;
  reviews: Record<string, ReviewSchedule>;
  finalizations: Record<string, FinalizationSummary>;
  audioClips: Record<string, AudioClip[]>;
  deliveryAnalyses: Record<string, DeliveryAnalysis[]>;
  problemPreferences: ProblemPreference[];
  solutionProfiles: SolutionProfile[];
  solutionRevisions: SolutionRevision[];
  activitySolutionLinks: ActivitySolutionLink[];
  personalQuestions: PersonalQuestion[];
  extraActivities: ExtraActivity[];
  focusBlocks: FocusBlock[];
  sessions: LocalSession[];
  historyActivities: ExtraActivity[];
  historyFocusBlocks: FocusBlock[];
  historySessions: LocalSession[];
  interactionModeRegistry: InteractionModeRegistry | null;
  interactionModes: Record<string, InteractionModeSummary>;
  focusedActivityId: string | null;
  focusedSessionId: string | null;
  focusedAt: number | null;
};

export const CODING_SESSION_MINUTES = 40;
export const INTERVIEW_SESSION_MINUTES = 60;

export function sessionAllocationSeconds(coding: number, systemDesign: number, behavioral: number) {
  const safeCoding = Math.max(0, Math.floor(coding));
  const safeSystemDesign = Math.max(0, Math.floor(systemDesign));
  const safeBehavioral = Math.max(0, Math.floor(behavioral));
  return (
    safeCoding * CODING_SESSION_MINUTES +
    (safeSystemDesign + safeBehavioral) * INTERVIEW_SESSION_MINUTES
  ) * 60;
}

export const SESSION_SECONDS = sessionAllocationSeconds(6, 1, 1);
export const EMPTY_DRAFT: LocalDraft = {
  workbench: null,
  timers: {},
  sessionTimers: {},
  outcomes: {},
  publicationStatuses: {},
  notes: {},
  structuredNotes: {},
  reviews: {},
  finalizations: {},
  audioClips: {},
  deliveryAnalyses: {},
  problemPreferences: [],
  solutionProfiles: [],
  solutionRevisions: [],
  activitySolutionLinks: [],
  personalQuestions: [],
  extraActivities: [],
  focusBlocks: [],
  sessions: [],
  historyActivities: [],
  historyFocusBlocks: [],
  historySessions: [],
  interactionModeRegistry: null,
  interactionModes: {},
  focusedActivityId: null,
  focusedSessionId: null,
  focusedAt: null,
};

export function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

// Elapsed time is always derived from timestamps, never counted tick-by-tick,
// so refreshing, backgrounding, or moving between devices never loses time.
export function elapsed(timer: TimerDraft | undefined, now: number) {
  if (!timer) return 0;
  return (
    timer.elapsedSeconds +
    (timer.runningSince ? Math.max(0, Math.floor((now - timer.runningSince) / 1000)) : 0)
  );
}

export function remaining(timer: TimerDraft | undefined, now: number, allocatedSeconds = SESSION_SECONDS) {
  return Math.max(0, allocatedSeconds - elapsed(timer, now));
}

export function overtime(timer: TimerDraft | undefined, now: number, allocatedSeconds = SESSION_SECONDS) {
  return Math.max(0, elapsed(timer, now) - allocatedSeconds);
}
