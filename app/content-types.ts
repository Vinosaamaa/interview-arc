// Stable content types shared by the D1 loader (`db/content.ts`), the client UI
// (`app/home-client.tsx`), and the Git-to-D1 import script.

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
  };
  frequency?: "low" | "medium" | "high";
  answerFormat?: "SIMPLE" | "STAR" | "STARL" | "PPF" | "IFV";
  referenceAccess?: "public" | "may_require_sign_in";
  companyTags?: string[];
  companySignals?: { company: string; window: string; frequencyScore: number; frequencyScale: number; capturedAt: string }[];
  topics: string[];
  tags?: string[];
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
