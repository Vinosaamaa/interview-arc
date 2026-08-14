import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  extractPreferredImplementations,
  groupSolutionProfileSections,
  latestSolutionActionLabel,
  solutionProfileIsAvailable,
} from "../app/solution-profile-reader.ts";
import { leetcodeCatalogApproaches } from "../app/solution-profile-policy.ts";

test("one preferred implementation section becomes an exact Java/Python switch", () => {
  const section = {
    title: "Reference implementations",
    body: `Use the same invariant in both languages.

\`\`\`java
class Solution { int solve() { return 1; } }
\`\`\`

\`\`\`python
class Solution:
    def solve(self):
        return 1
\`\`\``,
  };
  assert.deepEqual(extractPreferredImplementations(section), {
    introduction: "Use the same invariant in both languages.",
    implementations: [
      { label: "Java", language: "java", code: "class Solution { int solve() { return 1; } }" },
      { label: "Python", language: "python", code: "class Solution:\n    def solve(self):\n        return 1" },
    ],
  });
});

test("Editorial and generated approaches retain order and provenance labels", () => {
  const body = `### Editorial approach: Monotonic stack
Stack mechanics.

### Editorial approach: Dynamic programming
Prefix and suffix maxima.

### Generated alternative: Two pointers
Constant-space scan.`;
  assert.deepEqual(leetcodeCatalogApproaches(body).map(({ kind, title }) => ({ kind, title })), [
    { kind: "editorial", title: "Monotonic stack" },
    { kind: "editorial", title: "Dynamic programming" },
    { kind: "generated", title: "Two pointers" },
  ]);
});

test("historical profile existence remains independent from the new completeness gate", () => {
  assert.equal(solutionProfileIsAvailable({ schemaVersion: 1, summary: "Legacy summary", sections: [{ title: "Old", body: "Old content" }] }), true);
  assert.equal(solutionProfileIsAvailable(null), false);
  assert.equal(latestSolutionActionLabel(7), "Open latest solution · Revision 7");
});

test("Solution Profile grouping is specialty-aware and never invents an Attempt record", () => {
  const projectSections = [
    { title: "Orientation", body: "Project context" },
    { title: "Architecture", body: "Service boundaries" },
    { title: "End-to-end flows", body: "Request flow" },
  ];
  assert.deepEqual(groupSolutionProfileSections("behavioral", projectSections, { focus: "project_overview" }), [{
    key: "project-deep-dive",
    title: "Project Deep Dive",
    sections: projectSections,
  }]);
  assert.deepEqual(groupSolutionProfileSections("leetcode", projectSections), [{
    key: "reference-solution",
    title: "Reference solution",
    sections: projectSections,
  }]);
  assert.deepEqual(groupSolutionProfileSections("system_design", projectSections), [{
    key: "reference-design",
    title: "Reference design",
    sections: projectSections,
  }]);
  assert.deepEqual(groupSolutionProfileSections("behavioral", projectSections), [{
    key: "reference-answer",
    title: "Reference answer",
    sections: projectSections,
  }]);
  assert.ok([
    ...groupSolutionProfileSections("behavioral", projectSections, { focus: "project_overview" }),
    ...groupSolutionProfileSections("leetcode", projectSections),
    ...groupSolutionProfileSections("system_design", projectSections),
    ...groupSolutionProfileSections("behavioral", projectSections),
  ].every((group) => group.title !== "Attempt record"));
});

test("the shared reader exposes latest revision, approach panels, Q&A, and incomplete historical content", async () => {
  const [client, css] = await Promise.all([
    readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /latestSolutionActionLabel\(solutionRevision!\)/);
  assert.match(client, /function PreferredImplementationTabs/);
  assert.match(client, /function LeetCodeApproachCatalog/);
  assert.match(client, /function SolutionQuestionsAndAnswers/);
  assert.match(client, /href="#solution-preferred-answer"/);
  assert.match(client, /href="#solution-practice-scenarios"/);
  assert.match(client, /href="#solution-references"/);
  assert.match(client, /selectedProblemProfileAvailable && !selectedProblemProfileReusable/);
  assert.match(client, /historical revision predates the current completeness gate/i);
  assert.match(css, /\.approach-panel/);
  assert.match(css, /\.solution-questions-and-answers/);
  assert.match(css, /\.solution-profile-integrity-notice/);
});
