import { z } from "zod";

const stableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedTextList = (maxItems: number, maxLength = 1_000) => z.array(boundedText(maxLength)).max(maxItems);

export const hypotheticalPracticeScenarioLabel = "Hypothetical practice scenario — not the owner's experience";
export const fictionalPracticeScenarioLabel = "Fictional practice scenario — not the owner's experience";

export const behavioralPracticeScenarioSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: stableIdSchema,
  revision: z.number().int().positive(),
  mode: z.enum(["hypothetical", "fictional"]),
  label: z.enum([hypotheticalPracticeScenarioLabel, fictionalPracticeScenarioLabel]),
  purpose: boundedText(2_000),
  canon: z.object({
    realSourceFacts: z.array(z.object({
      statement: boundedText(2_000),
      acceptedEvidenceIds: z.array(stableIdSchema).max(100),
    }).strict()).max(100),
    inventedPremises: boundedTextList(100, 2_000),
    inventedActions: boundedTextList(100, 2_000),
    inventedResults: boundedTextList(100, 2_000),
  }).strict(),
  answer: boundedText(40_000),
  challengeMap: z.array(z.object({
    challenge: boundedText(2_000),
    response: boundedText(10_000),
  }).strict()).max(100),
  likelyFollowUps: boundedTextList(100, 2_000),
  limitations: boundedTextList(100, 2_000),
  visibility: z.literal("owner_private"),
}).strict().superRefine((scenario, context) => {
  const expectedLabel = scenario.mode === "hypothetical"
    ? hypotheticalPracticeScenarioLabel
    : fictionalPracticeScenarioLabel;
  if (scenario.label !== expectedLabel) {
    context.addIssue({
      code: "custom",
      path: ["label"],
      message: `${scenario.mode} scenarios require the exact non-experience disclaimer.`,
    });
  }
  for (const [index, fact] of scenario.canon.realSourceFacts.entries()) {
    if (new Set(fact.acceptedEvidenceIds).size !== fact.acceptedEvidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["canon", "realSourceFacts", index, "acceptedEvidenceIds"],
        message: "Evidence references must be unique within one source fact.",
      });
    }
  }
});

export const behavioralPracticeScenariosSchema = z.array(behavioralPracticeScenarioSchema)
  .max(5)
  .superRefine((scenarios, context) => {
    const seen = new Set<string>();
    scenarios.forEach((scenario, index) => {
      if (seen.has(scenario.scenarioId)) {
        context.addIssue({
          code: "custom",
          path: [index, "scenarioId"],
          message: "A Solution Profile may contain only one current revision per scenario ID.",
        });
      }
      seen.add(scenario.scenarioId);
    });
  });

export type BehavioralPracticeScenario = z.infer<typeof behavioralPracticeScenarioSchema>;
export type BehavioralPracticeScenarioProjection = {
  solutionProfile: { questionId: string; revision: number };
  scenarios: BehavioralPracticeScenario[];
};

export function behavioralPracticeScenariosFingerprint(scenarios?: BehavioralPracticeScenario[]) {
  return JSON.stringify(behavioralPracticeScenariosSchema.parse(scenarios ?? []));
}

export function projectBehavioralPracticeScenarios(input: {
  questionId: string;
  solutionProfileRevision: number;
  scenarios?: unknown;
}): BehavioralPracticeScenarioProjection | null {
  const scenarios = behavioralPracticeScenariosSchema.parse(input.scenarios ?? []);
  if (!scenarios.length) return null;
  return {
    solutionProfile: { questionId: input.questionId, revision: input.solutionProfileRevision },
    scenarios,
  };
}

function markdownList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function sourceFactLabel(fact: BehavioralPracticeScenario["canon"]["realSourceFacts"][number]) {
  const references = fact.acceptedEvidenceIds.length
    ? ` (evidence references: ${fact.acceptedEvidenceIds.join(", ")})`
    : "";
  return `${fact.statement}${references}`;
}

export function renderBehavioralPracticeScenariosMarkdown(projection: BehavioralPracticeScenarioProjection | null) {
  if (!projection) return "";
  return [
    "## Practice scenarios",
    "",
    `Exact Solution Profile ${projection.solutionProfile.questionId} · revision ${projection.solutionProfile.revision}`,
    ...projection.scenarios.flatMap((scenario) => [
      "",
      `### ${scenario.label}`,
      "",
      `Scenario ${scenario.scenarioId} · revision ${scenario.revision} · owner private`,
      "",
      scenario.purpose,
      "",
      "#### Scenario canon — real source facts",
      "",
      markdownList(scenario.canon.realSourceFacts.map(sourceFactLabel), "None recorded."),
      "",
      "#### Invented premises",
      "",
      markdownList(scenario.canon.inventedPremises, "None recorded."),
      "",
      "#### Invented actions",
      "",
      markdownList(scenario.canon.inventedActions, "None recorded."),
      "",
      "#### Invented results",
      "",
      markdownList(scenario.canon.inventedResults, "None recorded."),
      "",
      "#### Practice answer",
      "",
      scenario.answer,
      "",
      "#### Challenge map",
      "",
      markdownList(scenario.challengeMap.map((item) => `${item.challenge} — ${item.response}`), "None recorded."),
      "",
      "#### Likely follow-ups",
      "",
      markdownList(scenario.likelyFollowUps, "None recorded."),
      "",
      "#### Limitations",
      "",
      markdownList(scenario.limitations, "None recorded."),
    ]),
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlList(items: string[], empty: string) {
  return `<ul>${(items.length ? items : [empty]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderBehavioralPracticeScenariosHtml(projection: BehavioralPracticeScenarioProjection | null) {
  if (!projection) return "";
  return [
    '<section data-behavioral-practice-scenarios="true">',
    "<h2>Practice scenarios</h2>",
    `<p>Exact Solution Profile ${escapeHtml(projection.solutionProfile.questionId)} · revision ${projection.solutionProfile.revision}</p>`,
    ...projection.scenarios.map((scenario) => [
      `<article data-scenario-id="${escapeHtml(scenario.scenarioId)}">`,
      `<h3>${escapeHtml(scenario.label)}</h3>`,
      `<p>Scenario ${escapeHtml(scenario.scenarioId)} · revision ${scenario.revision} · owner private</p>`,
      `<p>${escapeHtml(scenario.purpose)}</p>`,
      "<h4>Scenario canon — real source facts</h4>",
      htmlList(scenario.canon.realSourceFacts.map(sourceFactLabel), "None recorded."),
      "<h4>Invented premises</h4>",
      htmlList(scenario.canon.inventedPremises, "None recorded."),
      "<h4>Invented actions</h4>",
      htmlList(scenario.canon.inventedActions, "None recorded."),
      "<h4>Invented results</h4>",
      htmlList(scenario.canon.inventedResults, "None recorded."),
      "<h4>Practice answer</h4>",
      `<div>${escapeHtml(scenario.answer).replaceAll("\n", "<br>")}</div>`,
      "<h4>Challenge map</h4>",
      htmlList(scenario.challengeMap.map((item) => `${item.challenge} — ${item.response}`), "None recorded."),
      "<h4>Likely follow-ups</h4>",
      htmlList(scenario.likelyFollowUps, "None recorded."),
      "<h4>Limitations</h4>",
      htmlList(scenario.limitations, "None recorded."),
      "</article>",
    ].join("")),
    "</section>",
  ].join("");
}
