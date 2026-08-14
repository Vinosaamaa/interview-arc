import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveProfileTags,
  isReusableSolutionProfile,
  solutionProfileMissingRequirements,
  solutionProfileProjectSectionKeys,
} from "../app/solution-profile-policy.ts";
import { requiredBehavioralProjectSectionKeys } from "../db/behavioral-project-deep-dive-policy.ts";

const prose = (topic, count = 70) => Array.from({ length: count }, (_, index) => `${topic}${index + 1}`).join(" ");
const javaCode = `class Solution {
  public int solve(int[] values) {
    int best = 0;
    for (int value : values) {
      best = Math.max(best, value);
    }
    return best;
  }
}`;
const pythonCode = `class Solution:
    def solve(self, values: list[int]) -> int:
        best = 0
        for value in values:
            best = max(best, value)
        return best`;

function approachBlock(kind, title, seed) {
  return `### ${kind}: ${title}

#### When and why to choose it
Choose this approach when its state model matches the constraints and the interviewer wants the tradeoff it optimizes. ${prose(`${seed}choice`, 20)}

#### Algorithm
Initialize the complete state, process each transition in its required order, and derive the result from the preserved state. ${prose(`${seed}algorithm`, 30)}

#### Invariant and correctness
The invariant is that every processed value has been incorporated exactly once and the stored optimum matches that processed prefix. ${prose(`${seed}correctness`, 30)} Therefore the returned state is correct.

#### Complexity
Time O(n) processes each value once. Space O(1) retains only the durable transition state. ${prose(`${seed}cost`, 15)}

#### Edge cases
- Minimum-size input follows the base case.
- Duplicate values preserve the invariant.
- Extreme values avoid overflow-producing arithmetic.

#### Tradeoffs versus preferred
This approach changes the state representation and explanation burden while preserving correctness. ${prose(`${seed}tradeoff`, 22)}

#### Reference implementation
\`\`\`java
${javaCode}
\`\`\``;
}

function approachAlgorithm(body) {
  return body.match(/#### Algorithm\n([\s\S]*?)(?=\n#### Invariant)/)?.[1].trim() ?? "";
}

function completeLeetcodeProfile() {
  return {
    summary: prose("summary", 20),
    sections: [
      { title: "Problem", body: `${prose("objective", 55)} Required API: solve(int[] values). Example: [1, 2] returns 2. Canonical problem: https://example.test/problem` },
      { title: "Pattern recognition and constraints", body: prose("pattern", 35) },
      { title: "Best approach", body: `#### Algorithm\n${prose("preferredalgorithm", 70)}` },
      { title: "Reference implementations", body: `${prose("implementation", 35)}\n\n\`\`\`java\n${javaCode}\n\`\`\`\n\n\`\`\`python\n${pythonCode}\n\`\`\`` },
      { title: "Correctness reasoning", body: `The invariant is preserved before and after every transition. ${prose("proof", 45)} Therefore the algorithm is correct.` },
      { title: "Time and space complexity", body: `Time O(n) visits every value once. Space O(1) keeps only the current optimum. ${prose("complexity", 20)}` },
      { title: "Edge cases", body: `- Empty or minimum input uses the contract default.\n- Duplicate values preserve the invariant.\n- Maximum values avoid overflow.\n${prose("edge", 25)}` },
      {
        title: "Editorial-first approach catalog",
        body: [
          approachBlock("Editorial approach", "Ordered scan", "scan"),
          approachBlock("Editorial approach", "Divide and conquer", "divide"),
        ].join("\n\n"),
      },
      { title: "Common mistakes and recall cues", body: prose("mistake", 35) },
      { title: "Interview walkthrough", body: prose("walkthrough", 40) },
    ],
    tags: ["array"],
    references: [
      { title: "Problem", url: "https://example.test/problem" },
      { title: "LeetCode Editorial", url: "https://leetcode.com/problems/example/editorial/" },
    ],
    editorialResearch: {
      source: "leetcode_playwright_controller",
      status: "available",
      url: "https://leetcode.com/problems/example/editorial/",
      accessedAt: "2026-08-14T15:00:00.000Z",
      contentSha256: "a".repeat(64),
      approaches: [{ title: "Ordered scan" }, { title: "Divide and conquer" }],
    },
  };
}

function completeSystemDesignProfile() {
  return {
    summary: prose("summary", 20),
    sections: [
      { title: "Problem framing and assumptions", body: prose("scope", 45) },
      { title: "Functional requirements", body: prose("function", 30) },
      { title: "Non-functional requirements", body: prose("quality", 30) },
      { title: "Capacity estimates", body: `Assume 10 million users, 50k requests per second, 5 TB retained data, and p99 latency below 200 ms. ${prose("estimate", 30)}` },
      { title: "API contracts", body: `${prose("contract", 40)}\n\n\`\`\`http\nPOST /v1/items\nContent-Type: application/json\n\n{"name":"example"}\n\nHTTP/1.1 201 Created\n{"id":"item-1"}\n\`\`\`` },
      { title: "Data model", body: `${prose("record", 45)}\n\n\`\`\`sql\nCREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version INTEGER NOT NULL);\n\`\`\`` },
      { title: "Architecture", body: `${prose("component", 90)}\n\n![Versioned architecture](design-example.svg)` },
      { title: "End-to-end flows", body: prose("flow", 70) },
      { title: "Scaling and performance", body: prose("scaling", 60) },
      { title: "Reliability and failure recovery", body: prose("recovery", 65) },
      { title: "Security and privacy", body: prose("security", 50) },
      { title: "Observability and operations", body: prose("operation", 50) },
      { title: "Tradeoffs and alternatives", body: prose("tradeoff", 60) },
      { title: "Interview walkthrough", body: prose("walkthrough", 65) },
      { title: "Likely follow-ups", body: prose("followup", 35) },
    ],
    tags: ["event-streaming"],
    references: [],
    questionsAndAnswers: {
      status: "included",
      reason: "The owner asked substantial design follow-up questions during the activity.",
      items: [{
        question: "How does the write path recover after duplicate delivery?",
        answer: prose("answer", 55),
        classification: "target_design",
        turnIds: ["turn-user-1", "turn-specialist-1"],
      }],
    },
  };
}

function completeBehavioralProfile() {
  const answer = prose("answer", 90);
  return {
    summary: prose("summary", 20),
    sections: [
      { title: "Interview signal", body: prose("signal", 35) },
      { title: "Truthful Situation", body: prose("situation", 40) },
      { title: "Truthful Task", body: prose("task", 35) },
      { title: "Truthful Actions and ownership", body: prose("action", 65) },
      { title: "Verified Result and evidence gaps", body: prose("result", 40) },
      { title: "Learning", body: prose("learning", 35) },
      { title: "Likely follow-ups and evidence gaps", body: prose("followup", 35) },
      { title: "Reference answer patterns", body: prose("pattern", 35) },
    ],
    tags: ["ownership"],
    references: [],
    behavioralAnswer: {
      preferred: { answer, evidence: ["owner-confirmed activity evidence"], evidenceGaps: [] },
      alternatives: [],
    },
    questionsAndAnswers: {
      status: "not_applicable",
      reason: "No substantial reusable question and answer exchange occurred in this activity.",
      items: [],
    },
  };
}

test("LeetCode completeness enforces the complete Editorial-first catalog and runnable code", () => {
  const complete = completeLeetcodeProfile();
  assert.equal(isReusableSolutionProfile("leetcode", complete), true, solutionProfileMissingRequirements("leetcode", complete).join("\n"));

  const shallow = {
    ...complete,
    summary: "A solution.",
    sections: complete.sections.map((section) => ({ ...section, body: "Algorithm invariant complexity edge case alternative." })),
  };
  const shallowMissing = solutionProfileMissingRequirements("leetcode", shallow);
  assert.ok(shallowMissing.includes("substantive summary"));
  assert.ok(shallowMissing.includes("substantive content in every section"));
  assert.ok(shallowMissing.includes("complete runnable Java preferred implementation"));

  const missingAlternativeCode = structuredClone(complete);
  missingAlternativeCode.sections.find((section) => section.title === "Editorial-first approach catalog").body = missingAlternativeCode.sections.find((section) => section.title === "Editorial-first approach catalog").body.replace(/```java[\s\S]*?```/, "Reference implementation intentionally omitted.");
  assert.ok(solutionProfileMissingRequirements("leetcode", missingAlternativeCode).includes("catalog approach 1 complete runnable Java reference code"));

  const emptyAlternativeAlgorithm = structuredClone(complete);
  emptyAlternativeAlgorithm.sections.find((section) => section.title === "Editorial-first approach catalog").body = emptyAlternativeAlgorithm.sections.find((section) => section.title === "Editorial-first approach catalog").body.replace(/(#### Algorithm\n)[\s\S]*?(?=\n#### Invariant)/, "$1");
  assert.ok(solutionProfileMissingRequirements("leetcode", emptyAlternativeAlgorithm).includes("catalog approach 1 detailed complete algorithm"));

  const generatedDespiteEnoughEditorials = structuredClone(complete);
  generatedDespiteEnoughEditorials.sections.find((section) => section.title === "Editorial-first approach catalog").body += `\n\n${approachBlock("Generated alternative", "Sorting", "sort")}`;
  assert.ok(solutionProfileMissingRequirements("leetcode", generatedDespiteEnoughEditorials).includes("generated alternatives only to reach three distinct total approaches"));

  const editorialAfterGenerated = structuredClone(complete);
  editorialAfterGenerated.sections.find((section) => section.title === "Editorial-first approach catalog").body = [
    approachBlock("Editorial approach", "Ordered scan", "scan"),
    approachBlock("Generated alternative", "Sorting", "sort"),
    approachBlock("Editorial approach", "Divide and conquer", "divide"),
  ].join("\n\n");
  assert.ok(solutionProfileMissingRequirements("leetcode", editorialAfterGenerated).includes("all Editorial approaches before generated alternatives"));

  const legacyNameOnlyAlternatives = structuredClone(complete);
  legacyNameOnlyAlternatives.sections.find((section) => section.title === "Editorial-first approach catalog").body = "### Alternative: Sorting\nUse sorting.";
  assert.ok(solutionProfileMissingRequirements("leetcode", legacyNameOnlyAlternatives).includes("at least three distinct approaches counting preferred"));

  const preferredEditorialNeedsTwoGenerated = structuredClone(complete);
  const matchingEditorial = approachBlock("Editorial approach", "Preferred ordered scan", "preferred-match");
  preferredEditorialNeedsTwoGenerated.sections.find((section) => section.title === "Best approach").body = `#### Algorithm\n${approachAlgorithm(matchingEditorial)}`;
  preferredEditorialNeedsTwoGenerated.sections.find((section) => section.title === "Editorial-first approach catalog").body = [
    matchingEditorial,
    approachBlock("Generated alternative", "Sorting", "sort"),
  ].join("\n\n");
  assert.ok(solutionProfileMissingRequirements("leetcode", preferredEditorialNeedsTwoGenerated).includes("generated alternatives only to reach three distinct total approaches"));
  preferredEditorialNeedsTwoGenerated.sections.find((section) => section.title === "Editorial-first approach catalog").body += `\n\n${approachBlock("Generated alternative", "Heap scan", "heap")}`;
  preferredEditorialNeedsTwoGenerated.editorialResearch.approaches = [{ title: "Preferred ordered scan" }];
  assert.equal(isReusableSolutionProfile("leetcode", preferredEditorialNeedsTwoGenerated), true, solutionProfileMissingRequirements("leetcode", preferredEditorialNeedsTwoGenerated).join("\n"));

  const missingResearchReceipt = structuredClone(complete);
  delete missingResearchReceipt.editorialResearch;
  assert.ok(solutionProfileMissingRequirements("leetcode", missingResearchReceipt).includes("Playwright Editorial research receipt"));

  const incompleteEditorialCatalog = structuredClone(complete);
  incompleteEditorialCatalog.editorialResearch.approaches = [{ title: "Ordered scan" }];
  assert.ok(solutionProfileMissingRequirements("leetcode", incompleteEditorialCatalog).includes("exact ordered Editorial approach catalog"));

  const unavailableEditorial = structuredClone(complete);
  unavailableEditorial.sections.find((section) => section.title === "Editorial-first approach catalog").body = [
    approachBlock("Generated alternative", "Sorting", "sort"),
    approachBlock("Generated alternative", "Heap scan", "heap"),
  ].join("\n\n");
  unavailableEditorial.references = [{ title: "Problem", url: "https://example.test/problem" }];
  unavailableEditorial.editorialResearch = {
    source: "leetcode_playwright_controller",
    status: "unavailable",
    url: "https://leetcode.com/problems/example/editorial/",
    accessedAt: "2026-08-14T15:00:00.000Z",
    reason: "The controller reached the canonical page but no Editorial article content rendered.",
    approaches: [],
  };
  assert.equal(isReusableSolutionProfile("leetcode", unavailableEditorial), true, solutionProfileMissingRequirements("leetcode", unavailableEditorial).join("\n"));

  unavailableEditorial.sections.find((section) => section.title === "Editorial-first approach catalog").body = [
    approachBlock("Editorial approach", "Sorting", "sort"),
    approachBlock("Generated alternative", "Heap scan", "heap"),
  ].join("\n\n");
  assert.ok(solutionProfileMissingRequirements("leetcode", unavailableEditorial).includes("no Editorial claims when research was unavailable"));
});

test("System Design completeness rejects prose-only skeletons and requires executable artifacts", () => {
  const complete = completeSystemDesignProfile();
  assert.equal(isReusableSolutionProfile("system_design", complete), true, solutionProfileMissingRequirements("system_design", complete).join("\n"));
  const shallow = { ...complete, sections: [{ title: "Architecture", body: "Use queues and caching." }] };
  const missing = solutionProfileMissingRequirements("system_design", shallow);
  assert.ok(missing.includes("detailed functional requirements section"));
  assert.ok(missing.includes("complete fenced HTTP API contracts"));
  assert.ok(missing.includes("versioned SVG architecture diagram"));

  const missingQaDecision = structuredClone(complete);
  delete missingQaDecision.questionsAndAnswers;
  assert.ok(solutionProfileMissingRequirements("system_design", missingQaDecision).includes("Questions and Answers disposition"));

  const shallowQa = structuredClone(complete);
  shallowQa.questionsAndAnswers.items[0].answer = "Use retries.";
  assert.ok(solutionProfileMissingRequirements("system_design", shallowQa).includes("Q&A item 1 detailed answer"));
});

test("Behavioral completeness rejects tiny answers, transcript sections, and incomplete Project Deep Dives", () => {
  const complete = completeBehavioralProfile();
  assert.equal(isReusableSolutionProfile("behavioral", complete), true, solutionProfileMissingRequirements("behavioral", complete).join("\n"));
  const shallow = {
    ...complete,
    sections: [{ title: "Conversation transcript", body: prose("raw", 20) }],
    behavioralAnswer: { preferred: { answer: "A tiny STAR answer.", evidence: [], evidenceGaps: [] }, alternatives: [] },
  };
  const missing = solutionProfileMissingRequirements("behavioral", shallow);
  assert.ok(missing.includes("transcript-free sections"));
  assert.ok(missing.includes("detailed preferred personal answer"));
  assert.ok(missing.includes("preferred-answer evidence or explicit evidence gaps"));

  const missingQaDecision = structuredClone(complete);
  delete missingQaDecision.questionsAndAnswers;
  assert.ok(solutionProfileMissingRequirements("behavioral", missingQaDecision).includes("Questions and Answers disposition"));

  const project = {
    ...complete,
    sections: [
      "orientation", "architecture", "end_to_end_flows", "ownership_and_evidence", "decisions_and_tradeoffs",
      "operations_reliability_security", "results_and_gaps", "interview_walkthrough", "likely_follow_ups",
    ].map((sectionKey) => ({ sectionKey, title: sectionKey, body: prose(sectionKey, 70) })),
    behavioralAnswer: {
      preferred: complete.behavioralAnswer.preferred,
      alternatives: [{
        answer: prose("focusPivot", 62),
        whenToUse: prose("when", 12),
        evidence: [],
        evidenceGaps: ["Personal ownership remains unresolved."],
      }],
    },
    projectDeepDive: { projectId: "sample", bindingRevision: 1, focus: "project_overview" },
    questionsAndAnswers: {
      status: "included",
      reason: "The project discussion contained substantial reusable questions and corrected answers.",
      items: [{
        question: "Which project boundary is current implementation rather than target design?",
        answer: prose("projectAnswer", 55),
        classification: "current_implementation",
        turnIds: ["turn-owner-1", "turn-specialist-1"],
      }],
    },
  };
  assert.equal(isReusableSolutionProfile("behavioral", project), true, solutionProfileMissingRequirements("behavioral", project).join("\n"));
  project.behavioralAnswer.alternatives[0].answer = prose("thinPivot", 59);
  assert.ok(solutionProfileMissingRequirements("behavioral", project).includes("behavioral alternative 1 detailed answer"));
  project.behavioralAnswer.alternatives[0].answer = prose("focusPivot", 62);
  project.sections[2].body = "Thin flow.";
  assert.ok(solutionProfileMissingRequirements("behavioral", project).includes("detailed Project Deep Dive section: end_to_end_flows"));
});

test("canonical and owner tags use only structured current sources", () => {
  const complete = completeLeetcodeProfile();
  assert.deepEqual(effectiveProfileTags({ ...complete, tags: ["parsing"] }, { ...complete, tags: ["polynomial"] }), ["parsing", "polynomial"]);
  assert.ok(!effectiveProfileTags({ ...complete, tags: ["parsing"] }, null).includes("perfect"));
});

test("Project Deep Dive quality keys cannot drift from the binding contract", () => {
  for (const focus of ["project_overview", "resume_claim", "architecture", "technical_decision", "challenge", "incident", "scale", "results"]) {
    assert.deepEqual(solutionProfileProjectSectionKeys(focus), requiredBehavioralProjectSectionKeys(focus));
  }
});
