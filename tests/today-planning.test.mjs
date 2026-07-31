import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPlanningBatch,
  filterPlanningCatalog,
  planningRequestFingerprint,
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
});
