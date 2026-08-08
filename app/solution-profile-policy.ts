export type SolutionProfileLike = {
  summary: string;
  sections: Array<{ title: string; body: string }>;
  tags: string[];
  references: Array<{ title: string; url: string }>;
  behavioralAnswer?: { preferred?: { answer?: string } };
};

export type SolutionProfileSpecialty = "leetcode" | "system_design" | "behavioral";

export function solutionProfileMissingRequirements(specialty: SolutionProfileSpecialty, profile?: SolutionProfileLike | null) {
  if (!profile?.summary.trim() || !profile.sections.length) return ["summary and sections"];
  if (specialty === "behavioral") {
    const missing: string[] = [];
    if (profile.sections.some((section) => /transcript|conversation|raw exchange|verbatim/i.test(section.title))) missing.push("transcript-free sections");
    if (!profile.behavioralAnswer?.preferred?.answer?.trim()) missing.push("preferred personal answer");
    return missing;
  }
  if (specialty !== "leetcode") return [];
  const text = profile.sections.map((section) => `${section.title}\n${section.body}`).join("\n").toLowerCase();
  const hasReferenceImplementation = profile.sections.some((section) => (
    /reference implementation|complete reference|implementation|solution/i.test(section.title)
    && /```[^\n]*\n[\s\S]+?```/.test(section.body)
  ));
  const requirements: Array<[string, RegExp, boolean?]> = [
    ["pattern recognition and constraints", /pattern|constraint|problem framing|problem summary/],
    ["best approach", /best approach|approach|algorithm/],
    ["reference implementation", /reference implementation|complete reference|implementation|solution/, hasReferenceImplementation],
    ["correctness reasoning", /correctness|invariant|proof/],
    ["time and space complexity", /complexity|time[^\n]{0,80}space|space[^\n]{0,80}time/],
    ["edge cases", /edge case/],
    ["alternatives", /alternative/],
    ["common mistakes or recall cues", /common mistake|mistake|recall cue/],
  ];
  const missing = requirements.filter(([, matcher, additional = true]) => !additional || !matcher.test(text)).map(([label]) => label);
  if (!profile.references.length || profile.references.some((reference) => !reference.title.trim() || !reference.url.trim())) missing.push("references");
  return missing;
}

export function isReusableSolutionProfile(specialty: SolutionProfileSpecialty, profile?: SolutionProfileLike | null) {
  return solutionProfileMissingRequirements(specialty, profile).length === 0;
}

export function effectiveProfileTags(canonical?: SolutionProfileLike | null, owner?: SolutionProfileLike | null) {
  return [...new Set([...(canonical?.tags ?? []), ...(owner?.tags ?? [])].map((tag) => tag.trim()).filter(Boolean))];
}
