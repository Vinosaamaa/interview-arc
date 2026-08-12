import type { BehavioralProjectProfileBinding } from "../db/behavioral-project-deep-dive-policy";

type SolutionProfileSection = { sectionKey?: string; title: string; body: string };

type BehavioralAnswer = {
  preferred?: {
    answer?: string;
    evidence?: string[];
    evidenceGaps?: string[];
  };
  alternatives?: Array<{
    answer?: string;
    whenToUse?: string;
    evidence?: string[];
    evidenceGaps?: string[];
  }>;
};

export type SolutionProfileLike = {
  summary: string;
  sections: SolutionProfileSection[];
  tags: string[];
  references: Array<{ title: string; url: string }>;
  behavioralAnswer?: BehavioralAnswer;
  projectDeepDive?: BehavioralProjectProfileBinding;
};

export type SolutionProfileSpecialty = "leetcode" | "system_design" | "behavioral";

const PROJECT_OVERVIEW_SECTION_KEYS = [
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
const RESUME_CLAIM_SECTION_KEYS = [
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
const FOCUSED_PROJECT_SECTION_KEYS = [
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

export function solutionProfileProjectSectionKeys(focus: BehavioralProjectProfileBinding["focus"]): readonly string[] {
  if (focus === "project_overview") return PROJECT_OVERVIEW_SECTION_KEYS;
  if (focus === "resume_claim") return RESUME_CLAIM_SECTION_KEYS;
  return FOCUSED_PROJECT_SECTION_KEYS;
}

const words = (value: string) => value.match(/[\p{L}\p{N}]+/gu) ?? [];
const hasWords = (value: string | undefined, minimum: number) => words(value ?? "").length >= minimum;
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const listItemCount = (value: string) => (value.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm) ?? []).length;
const codeBlocks = (value: string) => [...value.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)].map((match) => ({
  language: match[1].trim().toLowerCase(),
  code: match[2].trim(),
}));

function findSection(sections: SolutionProfileSection[], matcher: RegExp) {
  return sections.find((section) => matcher.test(section.title));
}

function requireDetailedSection(
  missing: string[],
  sections: SolutionProfileSection[],
  label: string,
  titleMatcher: RegExp,
  minimumWords: number,
) {
  const section = findSection(sections, titleMatcher);
  if (!section || !hasWords(section.body, minimumWords)) missing.push(`detailed ${label} section`);
  return section;
}

function hasValidReferences(profile: SolutionProfileLike) {
  return profile.references.every((reference) => reference.title.trim() && reference.url.trim());
}

function sharedMissingRequirements(profile: SolutionProfileLike) {
  const missing: string[] = [];
  if (!hasWords(profile.summary, 14)) missing.push("substantive summary");
  if (!profile.sections.length) return [...missing, "sections"];
  if (profile.sections.some((section) => !section.title.trim() || !hasWords(section.body, 12))) {
    missing.push("substantive content in every section");
  }
  const normalizedBodies = profile.sections.map((section) => normalize(section.body)).filter(Boolean);
  if (new Set(normalizedBodies).size !== normalizedBodies.length) missing.push("distinct section content");
  if (!profile.tags.some((tag) => tag.trim())) missing.push("normalized tags");
  if (!hasValidReferences(profile)) missing.push("valid references");
  return missing;
}

function alternativeBlocks(body: string) {
  const headings = [...body.matchAll(/^#{3,6}\s+Alternative(?:\s+\d+)?\s*:\s*(.+)$/gim)];
  return headings.map((heading, index) => ({
    title: heading[1].trim(),
    body: body.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? body.length).trim(),
  }));
}

function labeledSubsection(body: string, matcher: RegExp) {
  const headings = [...body.matchAll(/^#{4,6}\s+(.+)$/gm)];
  const index = headings.findIndex((heading) => matcher.test(heading[1].trim()));
  if (index < 0) return null;
  const heading = headings[index];
  return body.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? body.length).trim();
}

function leetcodeMissingRequirements(profile: SolutionProfileLike) {
  const missing: string[] = [];
  const sections = profile.sections;
  requireDetailedSection(missing, sections, "pattern recognition and constraints", /pattern|problem framing|constraints/i, 30);
  requireDetailedSection(missing, sections, "preferred algorithm", /best approach|preferred approach|preferred algorithm/i, 60);
  const implementation = requireDetailedSection(missing, sections, "reference implementations", /reference implementations?|complete reference|preferred implementations?/i, 30);
  const correctness = requireDetailedSection(missing, sections, "correctness reasoning", /correctness|proof and invariant|invariant and proof/i, 45);
  const complexity = requireDetailedSection(missing, sections, "time and space complexity", /time and space complexity|complexity analysis/i, 20);
  const edgeCases = requireDetailedSection(missing, sections, "edge cases", /edge cases?/i, 24);
  const alternatives = requireDetailedSection(missing, sections, "meaningful alternatives", /meaningful alternatives?|alternative approaches?/i, 100);
  requireDetailedSection(missing, sections, "common mistakes and recall cues", /common mistakes?|recall cues?/i, 30);
  requireDetailedSection(missing, sections, "interview walkthrough", /interview walkthrough|interview answer/i, 35);

  const primaryBlocks = codeBlocks(implementation?.body ?? "");
  const java = primaryBlocks.find((block) => block.language === "java");
  const python = primaryBlocks.find((block) => block.language === "python" || block.language === "py");
  if (!java || java.code.length < 120 || !/\bclass\s+Solution\b/.test(java.code)) {
    missing.push("complete runnable Java preferred implementation");
  }
  if (!python || python.code.length < 100 || !/(?:\bclass\s+Solution\b|\bdef\s+\w+\s*\()/.test(python.code)) {
    missing.push("complete runnable Python preferred implementation");
  }
  if (correctness && (!/\binvariant\b/i.test(correctness.body) || !/\b(?:proof|induction|preserv|therefore|thus|correct)\w*\b/i.test(correctness.body))) {
    missing.push("explicit invariant and proof");
  }
  if (complexity && (!/\btime\b[^\n]{0,100}\bO\s*\(/i.test(complexity.body) || !/\bspace\b[^\n]{0,100}\bO\s*\(/i.test(complexity.body))) {
    missing.push("explicit Big-O time and space complexity");
  }
  if (edgeCases && listItemCount(edgeCases.body) < 3) missing.push("at least three concrete edge cases");

  const blocks = alternativeBlocks(alternatives?.body ?? "");
  if (blocks.length < 1 || blocks.length > 2) missing.push("one or two structured meaningful alternatives");
  blocks.forEach((block, index) => {
    const prefix = `alternative ${index + 1}`;
    const alternativeProse = block.body.replace(/```[^\n]*\n[\s\S]*?```/g, "");
    if (!block.title || !hasWords(alternativeProse, 100)) missing.push(`${prefix} substantive explanation`);
    const labels: Array<[string, RegExp, number]> = [
      ["when and why to choose it", /^when(?:\s+and\s+why)?\s+to\s+(?:use|choose)/i, 18],
      ["complete algorithm", /^algorithm/i, 28],
      ["invariant and correctness", /^invariant(?:\s+and\s+correctness)?/i, 28],
      ["complexity", /^complexity/i, 14],
      ["edge cases", /^edge cases?/i, 12],
      ["tradeoffs versus preferred", /^tradeoffs?(?:\s+versus\s+preferred)?/i, 20],
      ["reference implementation", /^reference implementation/i, 0],
    ];
    for (const [label, matcher, minimumWords] of labels) {
      const subsection = labeledSubsection(block.body, matcher);
      if (subsection === null || (minimumWords && !hasWords(subsection.replace(/```[^\n]*\n[\s\S]*?```/g, ""), minimumWords))) {
        missing.push(`${prefix} detailed ${label}`);
      }
    }
    if (!/\btime\b[^\n]{0,100}\bO\s*\(/i.test(block.body) || !/\bspace\b[^\n]{0,100}\bO\s*\(/i.test(block.body)) {
      missing.push(`${prefix} explicit Big-O time and space complexity`);
    }
    const alternativeJava = codeBlocks(block.body).find((candidate) => candidate.language === "java");
    if (!alternativeJava || alternativeJava.code.length < 120 || !/\bclass\s+Solution\b/.test(alternativeJava.code)) {
      missing.push(`${prefix} complete runnable Java reference code`);
    }
  });
  if (!profile.references.length) missing.push("references");
  return missing;
}

function systemDesignMissingRequirements(profile: SolutionProfileLike) {
  const missing: string[] = [];
  const sections = profile.sections;
  requireDetailedSection(missing, sections, "problem framing and assumptions", /problem framing|scope and assumptions|assumptions and scope/i, 40);
  requireDetailedSection(missing, sections, "functional requirements", /^functional requirements?$/i, 25);
  requireDetailedSection(missing, sections, "non-functional requirements", /^non[- ]functional requirements?$/i, 25);
  const estimates = requireDetailedSection(missing, sections, "capacity estimates", /capacity estimates?|back[- ]of[- ]the[- ]envelope|scale estimates?/i, 30);
  const api = requireDetailedSection(missing, sections, "API contracts", /api contracts?|api design/i, 35);
  const data = requireDetailedSection(missing, sections, "data model", /data model|storage schema/i, 40);
  const architecture = requireDetailedSection(missing, sections, "architecture", /architecture|high[- ]level design/i, 80);
  requireDetailedSection(missing, sections, "end-to-end flows", /end[- ]to[- ]end flows?|key flows?/i, 60);
  requireDetailedSection(missing, sections, "scaling and performance", /scaling and performance|performance and scaling/i, 55);
  requireDetailedSection(missing, sections, "reliability and failure recovery", /reliability and failure|failure recovery|reliability, consistency/i, 60);
  requireDetailedSection(missing, sections, "security and privacy", /security and privacy/i, 45);
  requireDetailedSection(missing, sections, "observability and operations", /observability and operations|operations and observability/i, 45);
  requireDetailedSection(missing, sections, "tradeoffs and alternatives", /tradeoffs and alternatives|alternatives and tradeoffs/i, 55);
  requireDetailedSection(missing, sections, "interview walkthrough", /interview walkthrough|interview answer/i, 60);
  requireDetailedSection(missing, sections, "likely follow-ups", /likely follow[- ]ups?|common follow[- ]ups?/i, 30);

  if (!estimates || !/\b\d+(?:\.\d+)?\s*(?:k|m|b|million|billion|rps|qps|req\/s|kb|mb|gb|tb|ms|s|%)\b/i.test(estimates.body)) {
    missing.push("quantified capacity assumptions");
  }
  if (!api || !/```http\n[\s\S]+?```/i.test(api.body) || !/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/{}/?&=.-]*/.test(api.body)) {
    missing.push("complete fenced HTTP API contracts");
  }
  if (!data || !(/```(?:sql|json|text|typescript|protobuf|proto)\n[\s\S]+?```/i.test(data.body) || /^\s*\|[^\n]+\|\s*\n\s*\|\s*:?-+/m.test(data.body))) {
    missing.push("structured data model records");
  }
  if (!architecture || !/!\[[^\]]*\]\([^)]+\.svg(?:[?#][^)]*)?\)/i.test(architecture.body)) {
    missing.push("versioned SVG architecture diagram");
  }
  return missing;
}

function behavioralMissingRequirements(profile: SolutionProfileLike) {
  const missing: string[] = [];
  if (profile.sections.some((section) => /transcript|conversation|raw exchange|verbatim/i.test(section.title))) {
    missing.push("transcript-free sections");
  }
  const preferred = profile.behavioralAnswer?.preferred;
  if (!hasWords(preferred?.answer, 80)) missing.push("detailed preferred personal answer");
  if (!(preferred?.evidence?.length || preferred?.evidenceGaps?.length)) missing.push("preferred-answer evidence or explicit evidence gaps");

  if (profile.projectDeepDive) {
    const expectedKeys = solutionProfileProjectSectionKeys(profile.projectDeepDive.focus);
    const actualKeys = profile.sections.map((section) => section.sectionKey);
    if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key, index) => actualKeys[index] !== key)) {
      missing.push("exact ordered Project Deep Dive section keys");
    }
    for (const key of expectedKeys) {
      const section = profile.sections.find((candidate) => candidate.sectionKey === key);
      if (!section || !hasWords(section.body, 65)) missing.push(`detailed Project Deep Dive section: ${key}`);
    }
  } else {
    const sections = profile.sections;
    requireDetailedSection(missing, sections, "interview signal", /interview signal|what the prompt is testing/i, 30);
    requireDetailedSection(missing, sections, "truthful situation", /^truthful situation$|^situation$/i, 35);
    requireDetailedSection(missing, sections, "truthful task", /^truthful task$|^task$/i, 30);
    requireDetailedSection(missing, sections, "truthful actions and ownership", /truthful actions|actions and ownership|personal actions/i, 60);
    requireDetailedSection(missing, sections, "verified result and gaps", /verified result|results? and evidence gaps?/i, 35);
    requireDetailedSection(missing, sections, "learning", /^learning$|lessons? learned/i, 30);
    requireDetailedSection(missing, sections, "likely follow-ups and evidence gaps", /likely follow[- ]ups? and evidence gaps?|follow[- ]ups? and gaps?/i, 30);
    requireDetailedSection(missing, sections, "reference answer patterns", /reference answer patterns?|answer structure and sources/i, 30);
  }

  const alternativeAnswerMinimumWords = profile.projectDeepDive ? 60 : 80;
  for (const [index, alternative] of (profile.behavioralAnswer?.alternatives ?? []).entries()) {
    if (!hasWords(alternative.answer, alternativeAnswerMinimumWords)) missing.push(`behavioral alternative ${index + 1} detailed answer`);
    if (!hasWords(alternative.whenToUse, 12)) missing.push(`behavioral alternative ${index + 1} when to use`);
    if (!(alternative.evidence?.length || alternative.evidenceGaps?.length)) {
      missing.push(`behavioral alternative ${index + 1} evidence or explicit gaps`);
    }
  }
  return missing;
}

export function solutionProfileMissingRequirements(specialty: SolutionProfileSpecialty, profile?: SolutionProfileLike | null) {
  if (!profile?.summary.trim() || !profile.sections.length) return ["summary and sections"];
  const missing = sharedMissingRequirements(profile);
  if (specialty === "leetcode") missing.push(...leetcodeMissingRequirements(profile));
  if (specialty === "system_design") missing.push(...systemDesignMissingRequirements(profile));
  if (specialty === "behavioral") missing.push(...behavioralMissingRequirements(profile));
  return [...new Set(missing)];
}

export function isReusableSolutionProfile(specialty: SolutionProfileSpecialty, profile?: SolutionProfileLike | null) {
  return solutionProfileMissingRequirements(specialty, profile).length === 0;
}

export function effectiveProfileTags(canonical?: SolutionProfileLike | null, owner?: SolutionProfileLike | null) {
  return [...new Set([...(canonical?.tags ?? []), ...(owner?.tags ?? [])].map((tag) => tag.trim()).filter(Boolean))];
}
