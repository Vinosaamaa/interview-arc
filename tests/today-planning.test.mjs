import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPlanningBatch,
  filterPlanningCatalog,
  plannedActivityRemovalIdentity,
  planningRequestFingerprint,
  specialistPlanningReplay,
  selectExactPlanningQuestions,
} from "../db/today-planning-policy.ts";

const questions = [
  {
    id: "course-schedule",
    title: "Course Schedule",
    difficulty: "medium",
    acceptanceRate: 49.8,
    companySignals: [{ company: "Meta", window: "30 days", frequencyScore: 4, frequencyScale: 5 }],
    topics: ["Graph", "Topological Sort"],
    targetMinutes: 40,
    active: true,
  },
  {
    id: "two-sum",
    title: "Two Sum",
    difficulty: "easy",
    acceptanceRate: 55.2,
    companySignals: [{ company: "Meta", window: "30 days", frequencyScore: 5, frequencyScale: 5 }],
    topics: ["Array", "Hash Table"],
    targetMinutes: 30,
    active: true,
  },
  {
    id: "inactive",
    title: "Inactive",
    topics: [],
    targetMinutes: 40,
    active: false,
  },
];

test("exact-count planning preserves requested filters and deterministic order", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: `hard-${index + 1}`,
    title: `Hard ${String(index + 1).padStart(2, "0")}`,
    difficulty: "hard",
    companySignals: [{
      company: "Meta",
      window: "30 days",
      frequencyScore: 12 - index,
      frequencyScale: 12,
    }],
    topics: ["Graph"],
    targetMinutes: 40,
    active: true,
  }));
  candidates.push({
    id: "easy-higher-frequency",
    title: "Easy Higher Frequency",
    difficulty: "easy",
    companySignals: [{ company: "Meta", window: "30 days", frequencyScore: 99, frequencyScale: 100 }],
    topics: ["Array"],
    targetMinutes: 30,
    active: true,
  });

  const selected = selectExactPlanningQuestions(candidates, {
    count: 10,
    levels: new Set(["hard"]),
    sort: "frequency",
    direction: "desc",
  });

  assert.deepEqual(selected.map((question) => question.id), [
    "hard-1", "hard-2", "hard-3", "hard-4", "hard-5",
    "hard-6", "hard-7", "hard-8", "hard-9", "hard-10",
  ]);
});

test("exact-count planning fails instead of relaxing an insufficient filter", () => {
  assert.throws(
    () => selectExactPlanningQuestions(questions, {
      count: 2,
      levels: new Set(["hard"]),
      sort: "frequency",
      direction: "desc",
    }),
    (error) => error?.code === "insufficient_eligible_questions"
      && /requested 2.*found 0/i.test(error.message),
  );
});

test("planning catalog applies specialty-local search, filters, sort, and paging", () => {
  const result = filterPlanningCatalog(questions, {
    search: "graph",
    starredQuestionIds: new Set(["course-schedule"]),
    starredOnly: true,
    levels: new Set(["medium"]),
    sort: "acceptance",
    direction: "desc",
    page: 1,
    pageSize: 20,
  });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.id), ["course-schedule"]);
  assert.equal(result.hasMore, false);
});

test("planning catalog resolves an exact public question id", () => {
  const result = filterPlanningCatalog([
    { ...questions[0], id: "lc-207" },
    questions[1],
  ], {
    search: "lc-207",
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(result.items.map((item) => item.id), ["lc-207"]);
});

test("planning catalog marks blocked questions without hiding them", () => {
  const result = filterPlanningCatalog(questions, {
    blockedQuestionIds: new Set(["two-sum"]),
    sort: "frequency",
    direction: "desc",
    page: 1,
    pageSize: 20,
  });
  assert.equal(result.items[0].id, "two-sum");
  assert.equal(result.items[0].eligible, false);
  assert.equal(result.items[0].disabledReason, "Already on Today");
});

test("planning catalog applies website-equivalent attention groups", () => {
  const result = filterPlanningCatalog(questions, {
    attentionFilters: new Set(["due", "solved"]),
    attentionByQuestionId: new Map([
      ["course-schedule", new Set(["due", "solved"])],
      ["two-sum", new Set(["todo"])],
    ]),
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(result.items.map((item) => item.id), ["course-schedule"]);
  assert.deepEqual(result.items[0].attention, ["due", "solved"]);
  assert.equal(result.attentionCounts.due, 1);
});

test("one mutation id deterministically builds standalone or one-session work", () => {
  const batch = buildPlanningBatch({
    date: "2026-07-30",
    workbenchId: "workbench-1",
    mutationId: "voice-plan-1",
    destination: "session",
    sessionNumber: 2,
    selections: [
      {
        kind: "practice",
        specialty: "leetcode",
        questionId: "course-schedule",
        title: "Course Schedule",
        minutes: 40,
        topics: ["Graph"],
      },
      {
        kind: "focus",
        focusCategory: "job_applications",
        title: "Job applications",
        minutes: 60,
      },
    ],
  });

  assert.equal(batch.activities.length, 1);
  assert.equal(batch.focusBlocks.length, 1);
  assert.equal(batch.session?.activityIds.length, 2);
  assert.equal(batch.session?.allocatedSeconds, 6_000);
  assert.equal(batch.activities[0].sessionId, batch.session?.id);
  assert.match(batch.activities[0].id, /voice-plan-1/);
});

test("request fingerprints are stable across object key order and reject changed content", async () => {
  const first = await planningRequestFingerprint({
    mutationId: "same",
    destination: "standalone",
    selections: [{ title: "Course Schedule", minutes: 40 }],
  });
  const retry = await planningRequestFingerprint({
    selections: [{ minutes: 40, title: "Course Schedule" }],
    destination: "standalone",
    mutationId: "same",
  });
  const changed = await planningRequestFingerprint({
    mutationId: "same",
    destination: "standalone",
    selections: [{ title: "Course Schedule", minutes: 60 }],
  });

  assert.equal(first, retry);
  assert.notEqual(first, changed);

  const today = await planningRequestFingerprint({
    operation: "plan_today_practice",
    practiceDate: "2026-08-02",
    mutationId: "same",
  });
  const tomorrow = await planningRequestFingerprint({
    operation: "plan_today_practice",
    practiceDate: "2026-08-03",
    mutationId: "same",
  });
  assert.notEqual(today, tomorrow);
});

test("legacy activity-removal retries keep identity across inferred revision changes", async () => {
  const base = {
    date: "2026-08-09",
    expectedWorkbenchId: "workbench-1",
    mutationId: "legacy-remove-activity-1",
    activityIds: ["activity-1"],
  };
  const legacyFirst = await planningRequestFingerprint(plannedActivityRemovalIdentity({
    ...base,
    expectedWorkbenchRevision: 100,
    legacyRouteRevisionless: true,
  }));
  const legacyRetry = await planningRequestFingerprint(plannedActivityRemovalIdentity({
    ...base,
    expectedWorkbenchRevision: 101,
    legacyRouteRevisionless: true,
  }));
  const explicitFirst = await planningRequestFingerprint(plannedActivityRemovalIdentity({
    ...base,
    expectedWorkbenchRevision: 100,
  }));
  const explicitChanged = await planningRequestFingerprint(plannedActivityRemovalIdentity({
    ...base,
    expectedWorkbenchRevision: 101,
  }));

  assert.equal(legacyFirst, legacyRetry);
  assert.notEqual(explicitFirst, explicitChanged);
  assert.notEqual(legacyFirst, explicitFirst);
});

test("specialist planning retries validate identity and legacy scope", () => {
  const prior = {
    workbenchId: "workbench-1",
    createdAt: Date.parse("2026-08-02T16:00:00Z"),
    response: {
      mutationId: "voice-plan-1",
      activityIds: ["activity-1"],
      specialistRequestHash: "request-hash-1",
    },
  };
  const context = {
    expectedWorkbenchId: "workbench-1",
    practiceDate: "2026-08-02",
    receiptPracticeDate: "2026-08-02",
  };
  assert.deepEqual(
    specialistPlanningReplay(prior, "request-hash-1", context),
    prior.response,
  );
  assert.throws(
    () => specialistPlanningReplay(prior, "changed-request-hash", context),
    (error) => error?.code === "planning_mutation_identity_conflict",
  );
  const legacy = {
    workbenchId: "workbench-1",
    createdAt: prior.createdAt,
    response: { mutationId: "legacy", activityIds: ["activity-legacy"] },
  };
  assert.deepEqual(
    specialistPlanningReplay(legacy, "request-hash-1", context),
    legacy.response,
  );
  assert.throws(
    () => specialistPlanningReplay(legacy, "request-hash-1", {
      ...context,
      practiceDate: "2026-08-03",
    }),
    (error) => error?.code === "planning_mutation_identity_conflict",
  );
});

test("the Voice planning bridge is authenticated, idempotent, and push-driven", async () => {
  const [bridge, schema, migration, contract] = await Promise.all([
    readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0017_today_planning_mutations.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/voice-today-planning.md", import.meta.url), "utf8"),
  ]);

  assert.match(bridge, /\/voice\/planning/);
  assert.match(bridge, /\/voice\/planning\/mutations/);
  assert.match(bridge, /publishOwnerLiveUpdate\(env\.LIVE_UPDATES, ownerId, "practice"\)/);
  assert.match(schema, /todayPlanningMutations/);
  assert.match(migration, /PRIMARY KEY\(`owner_id`, `mutation_id`\)/);
  assert.match(contract, /Job applications is a focus selection inside Activities/);
  assert.match(bridge, /start_fresh_today/);
  assert.match(contract, /start_fresh_today/);

  const planningTool = bridge.slice(
    bridge.indexOf('"plan_today_practice"'),
    bridge.indexOf('"control_practice_timer"'),
  );
  assert.ok(
    planningTool.indexOf("readPlanningMutation") < planningTool.indexOf("specialistCatalog"),
    "an exact planning retry must be replayed before catalog eligibility is evaluated",
  );
  assert.match(
    planningTool,
    /voicePlanningMutation\([\s\S]*env, priorReceipt\)/,
    "the authoritative mutation path must reuse the preflight receipt",
  );
});
