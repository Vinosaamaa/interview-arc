import { z } from "zod";

export const behavioralProjectStableIdSchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");

export const BEHAVIORAL_PROJECT_FOCUS_VALUES = [
  "project_overview",
  "resume_claim",
  "architecture",
  "technical_decision",
  "challenge",
  "incident",
  "scale",
  "results",
] as const;

export const behavioralProjectFocusSchema = z.enum(BEHAVIORAL_PROJECT_FOCUS_VALUES);

function validateSourceClaimScope(
  input: { focus: z.infer<typeof behavioralProjectFocusSchema>; sourceClaimId?: string },
  context: z.RefinementCtx,
) {
  if (input.focus === "resume_claim" && !input.sourceClaimId) {
    context.addIssue({
      code: "custom",
      path: ["sourceClaimId"],
      message: "A resume-claim deep dive requires one exact source claim ID.",
    });
  }
  if (input.focus !== "resume_claim" && input.sourceClaimId) {
    context.addIssue({
      code: "custom",
      path: ["sourceClaimId"],
      message: "Only a resume-claim deep dive may carry a source claim ID.",
    });
  }
}

export const behavioralProjectBindingWriteSchema = z.object({
  operationId: behavioralProjectStableIdSchema,
  questionId: behavioralProjectStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  projectId: behavioralProjectStableIdSchema,
  focus: behavioralProjectFocusSchema,
  sourceClaimId: behavioralProjectStableIdSchema.optional(),
  state: z.enum(["active", "archived"]).default("active"),
  reason: z.string().trim().min(1).max(1_000),
  authorization: z.literal("behavioral_specialist"),
}).strict().superRefine(validateSourceClaimScope);

export const behavioralProjectCompletedAttemptLinkSchema = z.object({
  operationId: behavioralProjectStableIdSchema,
  activityId: behavioralProjectStableIdSchema,
  questionId: behavioralProjectStableIdSchema,
  bindingRevision: z.number().int().positive(),
  authorization: z.literal("behavioral_specialist"),
}).strict();

export const behavioralProjectQuerySchema = z.object({
  projectId: behavioralProjectStableIdSchema.optional(),
  projectAfterId: behavioralProjectStableIdSchema.optional(),
  questionId: behavioralProjectStableIdSchema.optional(),
  includeArchived: z.boolean().optional(),
  includeMigrationReview: z.boolean().optional(),
  migrationAfterQuestionId: behavioralProjectStableIdSchema.optional(),
}).strict().superRefine((input, context) => {
  if (input.projectId && input.projectAfterId) {
    context.addIssue({
      code: "custom",
      path: ["projectAfterId"],
      message: "An exact project query cannot also use the project registry cursor.",
    });
  }
  if (input.migrationAfterQuestionId && !input.includeMigrationReview) {
    context.addIssue({
      code: "custom",
      path: ["migrationAfterQuestionId"],
      message: "The migration cursor requires includeMigrationReview.",
    });
  }
});

export const behavioralProjectProfileBindingSchema = z.object({
  projectId: behavioralProjectStableIdSchema,
  bindingRevision: z.number().int().positive(),
  focus: behavioralProjectFocusSchema,
  sourceClaimId: behavioralProjectStableIdSchema.optional(),
}).strict().superRefine(validateSourceClaimScope);

export const behavioralProjectSectionKeySchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_]*$/, "Use a stable snake_case section key.");

export const PROJECT_OVERVIEW_SECTION_KEYS = [
  "orientation",
  "architecture",
  "end_to_end_flows",
  "ownership_and_evidence",
  "decisions_and_tradeoffs",
  "operations_reliability_security",
  "results_and_gaps",
  "interview_walkthrough",
  "likely_follow_ups",
] as const;

export const RESUME_CLAIM_SECTION_KEYS = [
  "claim_and_evidence",
  "project_context",
  "problem_and_constraints",
  "implementation_mechanics",
  "ownership_and_decisions",
  "alternatives_and_tradeoffs",
  "operations_and_risks",
  "result_and_limitations",
  "interview_walkthrough",
  "likely_follow_ups",
] as const;

const FOCUSED_SECTION_KEYS = [
  "project_context",
  "problem_and_constraints",
  "implementation_mechanics",
  "ownership_and_evidence",
  "decisions_and_tradeoffs",
  "operations_reliability_security",
  "results_and_gaps",
  "interview_walkthrough",
  "likely_follow_ups",
] as const;

export type BehavioralProjectFocus = z.infer<typeof behavioralProjectFocusSchema>;
export type BehavioralProjectBindingWrite = z.infer<typeof behavioralProjectBindingWriteSchema>;
export type BehavioralProjectCompletedAttemptLink = z.infer<typeof behavioralProjectCompletedAttemptLinkSchema>;
export type BehavioralProjectProfileBinding = z.infer<typeof behavioralProjectProfileBindingSchema>;

export function behavioralProjectActivityLinkMatches(
  existing: {
    activityId: string;
    questionId: string;
    bindingRevision: number;
    projectId: string;
    focus: BehavioralProjectFocus;
    sourceClaimId: string | null;
    solutionRevision: number | null;
    source: "finalization" | "completed_attempt_backfill";
  },
  identity: {
    activityId: string;
    questionId: string;
    bindingRevision: number;
    projectId: string;
    focus: BehavioralProjectFocus;
    sourceClaimId?: string | null;
    solutionRevision: number;
    source: "finalization";
  },
) {
  return existing.activityId === identity.activityId
    && existing.questionId === identity.questionId
    && existing.bindingRevision === identity.bindingRevision
    && existing.projectId === identity.projectId
    && existing.focus === identity.focus
    && existing.sourceClaimId === (identity.sourceClaimId ?? null)
    && existing.solutionRevision === identity.solutionRevision
    && existing.source === identity.source;
}

export function requiredBehavioralProjectSectionKeys(focus: BehavioralProjectFocus): readonly string[] {
  if (focus === "project_overview") return PROJECT_OVERVIEW_SECTION_KEYS;
  if (focus === "resume_claim") return RESUME_CLAIM_SECTION_KEYS;
  return FOCUSED_SECTION_KEYS;
}

export function behavioralProjectProfileMissingRequirements(profile: {
  sections: Array<{ sectionKey?: string }>;
  projectDeepDive?: unknown;
}, expected?: BehavioralProjectProfileBinding | null) {
  if (!expected) {
    return profile.projectDeepDive ? ["an active Project Deep Dive question binding"] : [];
  }
  const parsed = behavioralProjectProfileBindingSchema.safeParse(profile.projectDeepDive);
  if (!parsed.success) return ["exact Project Deep Dive binding metadata"];
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    return ["current Project Deep Dive binding revision"];
  }
  const sectionKeys = profile.sections.map((section) => section.sectionKey).filter((key): key is string => Boolean(key));
  if (sectionKeys.length !== profile.sections.length) return ["stable sectionKey on every Project Deep Dive section"];
  if (new Set(sectionKeys).size !== sectionKeys.length) return ["unique Project Deep Dive section keys"];
  const required = requiredBehavioralProjectSectionKeys(expected.focus);
  const missing = required.filter((key) => !sectionKeys.includes(key));
  if (!missing.length && required.some((key, index) => sectionKeys[index] !== key)) {
    return ["required Project Deep Dive sections in contract order"];
  }
  return missing.length ? [`Project Deep Dive sections: ${missing.join(", ")}`] : [];
}
