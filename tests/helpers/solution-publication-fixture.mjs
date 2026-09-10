// Synthetic text exercises the structural gate; it is never real practice data.
export const prose = (topic, count) => Array.from({ length: count }, (_, index) => `${topic}${index + 1}`).join(" ");
export function profile() {
  return {
    schemaVersion: 1, summary: prose("summary", 20), tags: [" Event streaming ", "event-streaming"], references: [],
    sections: [
      ["Problem framing and assumptions", prose("scope", 45)],
      ["Functional requirements", prose("functional", 30)],
      ["Non-functional requirements", prose("quality", 30)],
      ["Capacity estimates", `10 million users, 50k requests per second, 5 TB retained data. ${prose("capacity", 35)}`],
      ["API contracts", `${prose("api", 40)}\n\`\`\`http\nPOST /v1/items\nContent-Type: application/json\n\n{"name":"example"}\n\`\`\``],
      ["Data model", `${prose("data", 45)}\n\`\`\`sql\nCREATE TABLE items (id TEXT PRIMARY KEY);\n\`\`\``],
      ["Architecture", `${prose("architecture", 90)}\n![Synthetic versioned diagram](design-v1.svg)`],
      ["End-to-end flows", prose("flows", 70)],
      ["Scaling and performance", prose("scaling", 60)],
      ["Reliability and failure recovery", prose("recovery", 65)],
      ["Security and privacy", prose("security", 50)],
      ["Observability and operations", prose("operations", 50)],
      ["Tradeoffs and alternatives", prose("tradeoffs", 60)],
      ["Interview walkthrough", prose("walkthrough", 65)],
      ["Likely follow-ups", prose("followups", 35)],
    ].map(([title, body]) => ({ title, body })),
    questionsAndAnswers: { status: "not_applicable", reason: "No substantial reusable question and answer exchange occurred in this synthetic activity.", items: [] },
  };
}


export function nativePracticeRecord(specialty = "system_design") {
  return { schemaVersion: 1, activityId: "native-attempt", revision: 1, questionId: "native-question", specialty,
    completedAt: "2026-09-10T00:00:00Z", practiceDate: "2026-09-09", practiceTimezone: "America/Los_Angeles",
    timing: { source: "website", startedAt: null, endedAt: "2026-09-10T00:00:00Z", elapsedSeconds: 60, sessionId: null },
    outcome: "failed", interactionMode: "mentor", prompt: { title: "Synthetic native practice", body: "Synthetic prompt", canonicalUrl: null },
    summary: "Synthetic immutable summary", transcript: { revision: 1, turnCount: 0, firstTurnId: null, lastTurnId: null }, notesRevision: null,
    specialtyOutput: { kind: specialty === "behavioral" ? "final_tailored_answer" : "your_design", responseStages: [], codeAttemptIds: [], finalAnswerRevision: null, designAssetIds: [] },
    review: { didWell: [], improve: [], nextDrill: null }, references: [], solutionLink: null, assetLinks: [], finalizationOperationId: "native-finalize", createdAt: "2026-09-10T00:00:00Z" };
}

const javaCode = `class Solution {
  public int solve(int[] values) {
    int best = values[0];
    for (int value : values) best = Math.max(best, value);
    return best;
  }
}`;
const pythonCode = `class Solution:
    def solve(self, values: list[int]) -> int:
        best = values[0]
        for value in values:
            best = max(best, value)
        return best`;

function approachBlock(title, seed) {
  return `### Editorial approach: ${title}

#### When and why to choose it
Choose this approach when its state model matches the constraints and the interviewer values its tradeoff. ${prose(`${seed}choice`, 20)}

#### Algorithm
Initialize the state, process each transition in order, and derive the final result from the preserved state. ${prose(`${seed}algorithm`, 30)}

#### Invariant and correctness
The invariant is that every processed value is incorporated exactly once and the stored optimum matches the processed prefix. ${prose(`${seed}correctness`, 30)} Therefore the result is correct.

#### Complexity
Time O(n) processes each value once. Space O(1) retains only transition state. ${prose(`${seed}cost`, 15)}

#### Edge cases
- Minimum-size input follows the base case.
- Duplicate values preserve the invariant.
- Extreme values avoid overflow-producing arithmetic.

#### Tradeoffs versus preferred
This representation changes explanation and implementation costs while preserving correctness. ${prose(`${seed}tradeoff`, 22)}

#### Reference implementation
\`\`\`java
${javaCode}
\`\`\``;
}

export function completeLeetcodeProfile(questionId = "maximum-value-fixture") {
  return {
    schemaVersion: 1,
    summary: prose("summary", 20),
    sections: [
      { title: "Problem", body: `${prose("objective", 55)} Required API: solve(int[] values). Example: [1, 2] returns 2. Canonical problem: https://example.test/maximum-value` },
      { title: "Pattern recognition and constraints", body: prose("pattern", 35) },
      { title: "Best approach", body: `#### Algorithm\n${prose("preferredalgorithm", 70)}` },
      { title: "Reference implementations", body: `${prose("implementation", 35)}\n\n\`\`\`java\n${javaCode}\n\`\`\`\n\n\`\`\`python\n${pythonCode}\n\`\`\`` },
      { title: "Correctness reasoning", body: `The invariant is preserved before and after every transition. ${prose("proof", 45)} Therefore the algorithm is correct.` },
      { title: "Time and space complexity", body: `Time O(n) visits every value once. Space O(1) keeps only the current optimum. ${prose("complexity", 20)}` },
      { title: "Edge cases", body: `- A single value is its own maximum.\n- Duplicate values preserve the invariant.\n- Maximum integers require no arithmetic.\n${prose("edge", 25)}` },
      {
        title: "Editorial-first approach catalog",
        body: [approachBlock("Ordered scan", "scan"), approachBlock("Divide and conquer", "divide")].join("\n\n"),
      },
      { title: "Common mistakes and recall cues", body: prose("mistake", 35) },
      { title: "Interview walkthrough", body: prose("walkthrough", 40) },
    ],
    tags: ["array"],
    references: [
      { title: "Maximum value problem", url: "https://example.test/maximum-value", accessedAt: "2026-08-13T18:02:00.000Z" },
      { title: "LeetCode Editorial", url: `https://leetcode.com/problems/${questionId}/editorial/`, accessedAt: "2026-08-13T18:02:00.000Z" },
    ],
    editorialResearch: {
      source: "leetcode_playwright_controller",
      status: "available",
      url: `https://leetcode.com/problems/${questionId}/editorial/`,
      accessedAt: "2026-08-13T18:02:00.000Z",
      contentSha256: "b".repeat(64),
      approaches: [{ title: "Ordered scan" }, { title: "Divide and conquer" }],
    },
  };
}
