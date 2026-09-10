import { solutionProfileMissingRequirements } from "../app/solution-profile-policy.ts";
import { behavioralProjectProfileMissingRequirements, type BehavioralProjectFocus } from "./behavioral-project-deep-dive-policy.ts";
import { behavioralPracticeScenariosSchema, behavioralPracticeScenariosFingerprint, type BehavioralPracticeScenario } from "./behavioral-practice-scenario.ts";
import type { SolutionProfile, Specialty } from "./solution-profile-types.ts";

export type SolutionProfileProjectBinding = {
  state: string;
  projectId: string;
  currentRevision: number;
  focus: BehavioralProjectFocus;
  sourceClaimId: string | null;
};

export function normalizedTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9+#.:]+/g, "-")).filter(Boolean))]
    .slice(0, 256);
}

export function validateSolutionProfile(
  specialty: Specialty,
  payload: SolutionProfile | undefined,
  projectBinding: SolutionProfileProjectBinding | null = null,
  questionId?: string,
  canonicalProblemUrl?: string | null,
) {
  if (!payload) throw new Error("A complete finalization needs a reusable Solution Profile.");
  if (specialty !== "behavioral" && payload.projectDeepDive) {
    throw new Error("Project Deep Dive metadata is supported only for behavioral Solution Profiles.");
  }
  if (specialty !== "leetcode" && payload.editorialResearch) {
    throw new Error("Editorial research metadata is supported only for LeetCode Solution Profiles.");
  }
  const problemSlug = canonicalProblemUrl
    ? /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?(?:[?#].*)?$/.exec(canonicalProblemUrl)?.[1]
    : questionId;
  if (specialty === "leetcode" && questionId && payload.editorialResearch
      && (!problemSlug || payload.editorialResearch.url !== `https://leetcode.com/problems/${problemSlug}/editorial/`)) {
    throw new Error("Editorial research must use the canonical URL for the finalized LeetCode question.");
  }
  validatePracticeScenariosForSpecialty(specialty, payload.practiceScenarios);
  const missing = [
    ...solutionProfileMissingRequirements(specialty, payload),
    ...(specialty === "behavioral" ? behavioralProjectProfileMissingRequirements(payload, projectBinding?.state === "active" ? {
      projectId: projectBinding.projectId,
      bindingRevision: projectBinding.currentRevision,
      focus: projectBinding.focus,
      ...(projectBinding.sourceClaimId ? { sourceClaimId: projectBinding.sourceClaimId } : {}),
    } : null) : []),
  ];
  if (missing.length) throw new Error(`A complete finalization needs a reusable Solution Profile; missing: ${missing.join(", ")}.`);
}

export function validatePracticeScenariosForSpecialty(
  specialty: Specialty,
  scenarios: BehavioralPracticeScenario[] | undefined,
) {
  if (!scenarios) return;
  if (specialty !== "behavioral") {
    throw new Error("Practice scenarios are supported only for behavioral Solution Profiles.");
  }
  behavioralPracticeScenariosSchema.parse(scenarios);
}

export function normalizedSolutionProfile(
  payload: SolutionProfile,
  fallbackReferences: SolutionProfile["references"],
) {
  return {
    ...payload,
    tags: normalizedTags(payload.tags),
    references: payload.references.length ? payload.references : fallbackReferences,
  };
}

export function profileFingerprint(payload: SolutionProfile) {
  return JSON.stringify({
    summary: payload.summary.trim(),
    sections: payload.sections.map((section) => ({
      ...(section.sectionKey ? { sectionKey: section.sectionKey.trim() } : {}),
      title: section.title.trim(),
      body: section.body.trim(),
    })),
    tags: normalizedTags(payload.tags).sort(),
    references: payload.references.map((reference) => ({ title: reference.title.trim(), url: reference.url.trim() }))
      .sort((left, right) => left.url.localeCompare(right.url)),
    behavioralAnswer: payload.behavioralAnswer,
    practiceScenarios: behavioralPracticeScenariosFingerprint(payload.practiceScenarios),
    questionsAndAnswers: payload.questionsAndAnswers,
    editorialResearch: payload.editorialResearch,
    projectDeepDive: payload.projectDeepDive,
  });
}
