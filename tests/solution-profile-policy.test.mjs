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

function completeLeetcodeProfile() {
  return {
    summary: prose("summary", 20),
    sections: [
      { title: "Pattern recognition and constraints", body: prose("pattern", 35) },
      { title: "Best approach", body: prose("algorithm", 70) },
      { title: "Reference implementations", body: `${prose("implementation", 35)}\n\n\`\`\`java\n${javaCode}\n\`\`\`\n\n\`\`\`python\n${pythonCode}\n\`\`\`` },
      { title: "Correctness reasoning", body: `The invariant is preserved before and after every transition. ${prose("proof", 45)} Therefore the algorithm is correct.` },
      { title: "Time and space complexity", body: `Time O(n) visits every value once. Space O(1) keeps only the current optimum. ${prose("complexity", 20)}` },
      { title: "Edge cases", body: `- Empty or minimum input uses the contract default.\n- Duplicate values preserve the invariant.\n- Maximum values avoid overflow.\n${prose("edge", 25)}` },
      {
        title: "Meaningful alternatives",
        body: `### Alternative: Sort a defensive copy

#### When and why to choose
Choose sorting when the input already needs ordered output or when a simple auditable implementation matters more than linear time. ${prose("choice", 20)}

#### Algorithm
Copy the values, sort the copy, and return the final value after confirming the input contract. ${prose("algorithm", 22)}

#### Invariant and correctness
The invariant is that the processed suffix is ordered and the final position contains a value no smaller than every earlier value. ${prose("correctness", 22)}

#### Complexity
Time O(n log n) is dominated by sorting. Space O(n) preserves the caller-owned input in a defensive copy. ${prose("cost", 15)}

#### Edge cases
- Empty input follows the stated contract.\n- Equal values remain correct.\n- Extreme integers require no arithmetic.

#### Tradeoffs versus preferred
This approach is slower and allocates memory, but it can reuse a required sorted representation and is straightforward to inspect. ${prose("tradeoff", 18)}

#### Reference implementation
\`\`\`java
class Solution {
  public int solve(int[] values) {
    int[] copy = values.clone();
    java.util.Arrays.sort(copy);
    return copy[copy.length - 1];
  }
}
\`\`\``,
      },
      { title: "Common mistakes and recall cues", body: prose("mistake", 35) },
      { title: "Interview walkthrough", body: prose("walkthrough", 40) },
    ],
    tags: ["array"],
    references: [{ title: "Problem", url: "https://example.test/problem" }],
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
  };
}

test("LeetCode completeness rejects keyword-only and missing-code profiles", () => {
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
  missingAlternativeCode.sections.find((section) => section.title === "Meaningful alternatives").body = missingAlternativeCode.sections.find((section) => section.title === "Meaningful alternatives").body.replace(/```java[\s\S]*?```/, "Reference implementation intentionally omitted.");
  assert.ok(solutionProfileMissingRequirements("leetcode", missingAlternativeCode).includes("alternative 1 complete runnable Java reference code"));

  const emptyAlternativeAlgorithm = structuredClone(complete);
  emptyAlternativeAlgorithm.sections.find((section) => section.title === "Meaningful alternatives").body = emptyAlternativeAlgorithm.sections.find((section) => section.title === "Meaningful alternatives").body.replace(/(#### Algorithm\n)[\s\S]*?(?=\n#### Invariant)/, "$1");
  assert.ok(solutionProfileMissingRequirements("leetcode", emptyAlternativeAlgorithm).includes("alternative 1 detailed complete algorithm"));
});

test("System Design completeness rejects prose-only skeletons and requires executable artifacts", () => {
  const complete = completeSystemDesignProfile();
  assert.equal(isReusableSolutionProfile("system_design", complete), true, solutionProfileMissingRequirements("system_design", complete).join("\n"));
  const shallow = { ...complete, sections: [{ title: "Architecture", body: "Use queues and caching." }] };
  const missing = solutionProfileMissingRequirements("system_design", shallow);
  assert.ok(missing.includes("detailed functional requirements section"));
  assert.ok(missing.includes("complete fenced HTTP API contracts"));
  assert.ok(missing.includes("versioned SVG architecture diagram"));
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
