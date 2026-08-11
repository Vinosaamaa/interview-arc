import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { learningCourseBlueprintSchema } from "../db/learn-policy.ts";

const blueprintUrl = new URL("../learn/courses/interview-arc-architecture/blueprint.json", import.meta.url);

test("the public Interview Arc architecture tracer is a valid exact-source Course Blueprint", async () => {
  const blueprint = learningCourseBlueprintSchema.parse(JSON.parse(await readFile(blueprintUrl, "utf8")));
  const lessonIds = blueprint.modules.flatMap((module) => module.lessons.map((lesson) => lesson.lessonId));

  assert.equal(blueprint.courseId, "course-interview-arc-architecture");
  assert.equal(blueprint.state, "draft");
  assert.match(`${blueprint.title} ${blueprint.priorKnowledge.join(" ")}`, /Java/);
  assert.match(`${blueprint.goal} ${blueprint.priorKnowledge.join(" ")}`, /JavaScript|TypeScript/);
  assert.ok(blueprint.modules.length >= 4);
  assert.equal(new Set(lessonIds).size, lessonIds.length);
  assert.ok(blueprint.sourcePins.every((source) => source.kind === "repository"));
  assert.ok(blueprint.sourcePins.every((source) => source.commit.length === 40));
  assert.ok(blueprint.sourcePins.every((source) => source.path && source.symbols.length > 0));
  assert.ok(lessonIds.includes("idempotent-command-lab"));
  assert.ok(lessonIds.includes("transcript-only-voice-lab"));
  assert.ok(lessonIds.includes("release-integrity-lab"));
});
