import test from "node:test";
import assert from "node:assert/strict";
import { effectiveProfileTags, isReusableSolutionProfile, solutionProfileMissingRequirements } from "../app/solution-profile-policy.ts";

const complete = {
  summary: "A complete reusable solution.",
  sections: [
    { title: "Pattern recognition and constraints", body: "Use parsing under the stated constraints." },
    { title: "Best approach", body: "Apply the recursive algorithm." },
    { title: "Reference implementation", body: "```java\nclass Solution {}\n```" },
    { title: "Correctness reasoning", body: "The invariant proves correctness." },
    { title: "Complexity", body: "Time O(n), space O(n)." },
    { title: "Edge cases", body: "Empty terms and nested input." },
    { title: "Alternatives", body: "A stack is an alternative." },
    { title: "Common mistakes and recall cues", body: "Do not lose signs." },
  ],
  tags: ["parsing"],
  references: [{ title: "Problem", url: "https://example.test/problem" }],
};

test("LeetCode profile completeness distinguishes reusable and malformed state", () => {
  assert.equal(isReusableSolutionProfile("leetcode", complete), true);
  const malformed = { ...complete, sections: complete.sections.filter((section) => section.title !== "Reference implementation") };
  assert.equal(isReusableSolutionProfile("leetcode", malformed), false);
  assert.ok(solutionProfileMissingRequirements("leetcode", malformed).includes("reference implementation"));
  assert.equal(isReusableSolutionProfile("leetcode", null), false);
  const unrelatedCode = { ...complete, sections: complete.sections.map((section) => section.title === "Reference implementation" ? { title: "Notes", body: section.body } : section).concat({ title: "Implementation idea", body: "No reference code is present here." }) };
  assert.equal(isReusableSolutionProfile("leetcode", unrelatedCode), false);
});

test("behavioral reuse requires a preferred answer and excludes transcript sections", () => {
  const base = { summary: "A grounded answer.", sections: [{ title: "Situation", body: "Verified context" }], tags: [], references: [] };
  assert.equal(isReusableSolutionProfile("behavioral", base), false);
  assert.equal(isReusableSolutionProfile("behavioral", { ...base, behavioralAnswer: { preferred: { answer: "A verified STAR answer" } } }), true);
  assert.equal(isReusableSolutionProfile("behavioral", { ...base, sections: [{ title: "Conversation transcript", body: "raw" }], behavioralAnswer: { preferred: { answer: "A verified STAR answer" } } }), false);
});

test("canonical and owner tags use only structured current sources", () => {
  assert.deepEqual(effectiveProfileTags({ ...complete, tags: ["parsing"] }, { ...complete, tags: ["polynomial"] }), ["parsing", "polynomial"]);
  assert.ok(!effectiveProfileTags({ ...complete, tags: ["parsing"] }, null).includes("perfect"));
});
