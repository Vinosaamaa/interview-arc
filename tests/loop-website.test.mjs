import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addLoopRoundCommandSchema,
  createLoopCommandSchema,
  createLoopSchema,
  websiteAddLoopRoundSchema,
  websiteCreateLoopSchema,
} from "../db/loop-policy.ts";
import { buildWebsiteAddRoundCommand, buildWebsiteLoopCommand } from "../db/loop-website.ts";

const urlOnlyDraft = {
  schemaVersion: 1,
  operationId: "c7f58c28-99f9-43df-9c57-8aa3dcd54e6f",
  company: "Example Systems",
  roleTitle: "Platform Engineer",
  jobDescription: { sourceUrl: "https://jobs.example.com/platform-engineer" },
  stages: [],
  unknowns: ["location", "openedOn", "stages", "jobDescriptionText"],
};

test("website Loop intake preserves explicit unknowns and a URL-only source", async () => {
  assert.equal(websiteCreateLoopSchema.safeParse(urlOnlyDraft).success, true);
  const command = await buildWebsiteLoopCommand("owner-a", urlOnlyDraft, 1_787_300_000_000);
  const exactRetry = await buildWebsiteLoopCommand("owner-a", urlOnlyDraft, 1_787_300_000_000);
  const otherOwner = await buildWebsiteLoopCommand("owner-b", urlOnlyDraft, 1_787_300_000_000);

  assert.deepEqual(command, exactRetry);
  assert.notEqual(command.loop.loopId, otherOwner.loop.loopId);
  assert.equal(command.authorization, "website_owner");
  assert.equal(command.loop.openedAt, undefined);
  assert.equal(command.loop.location, undefined);
  assert.deepEqual(command.loop.stages, []);
  assert.equal(command.roleBrief.source.kind, "public_posting_reference");
  assert.equal("jdText" in command.roleBrief.source, false);
  assert.deepEqual(command.roleBrief.responsibilities, []);
  assert.match(command.roleBrief.unresolvedAmbiguities.join(" "), /Location is not yet known/);
  assert.equal(createLoopCommandSchema.safeParse(command).success, true);
  assert.equal(createLoopSchema.safeParse(command).success, false);
});

test("website Loop intake rejects inferred unknowns, unsafe URLs, and incomplete scheduled stages", () => {
  assert.equal(websiteCreateLoopSchema.safeParse({ ...urlOnlyDraft, unknowns: [] }).success, false);
  assert.equal(websiteCreateLoopSchema.safeParse({
    ...urlOnlyDraft,
    jobDescription: { sourceUrl: "http://jobs.example.com/platform-engineer" },
  }).success, false);
  assert.equal(websiteCreateLoopSchema.safeParse({
    ...urlOnlyDraft,
    stages: [{ label: "Hiring manager", status: "scheduled" }],
    unknowns: ["location", "openedOn", "jobDescriptionText"],
  }).success, false);
  assert.equal(websiteCreateLoopSchema.safeParse({
    ...urlOnlyDraft,
    openedOn: "2026-02-31",
    unknowns: ["location", "stages", "jobDescriptionText"],
  }).success, false);
});

test("website Loop adapter derives stable stage identities and exact initial provenance", async () => {
  const command = await buildWebsiteLoopCommand("owner-a", {
    schemaVersion: 1,
    operationId: "5af003ff-bbc2-491e-8cd5-091213d14dc0",
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    location: "Remote",
    openedOn: "2026-08-20",
    jobDescription: {
      text: "Build reliable platform services.",
      sourceUrl: "https://jobs.example.com/platform-engineer",
    },
    stages: [{ label: "Technical screen", status: "scheduled", scheduledOn: "2026-08-28", format: "Video" }],
    unknowns: [],
  }, 1_787_300_000_000);

  assert.match(command.loop.loopId, /^loop-[a-f0-9]{32}$/);
  assert.match(command.loop.stages[0].stageId, /^stage-[a-f0-9]{32}$/);
  assert.equal(command.loop.openedAt, Date.parse("2026-08-20T12:00:00.000Z"));
  assert.equal(command.loop.stages[0].scheduledAt, Date.parse("2026-08-28T12:00:00.000Z"));
  assert.equal(command.roleBrief.source.kind, "public_posting");
  assert.equal(command.roleBrief.source.jdText, "Build reliable platform services.");
});

test("website Add Round derives stable identity while leaving order server-owned", async () => {
  const draft = {
    schemaVersion: 1,
    operationId: "round-add-5af003ff-bbc2-491e-8cd5-091213d14dc0",
    loopId: "loop-example",
    expectedLoopRevision: 4,
    label: "System design",
    status: "scheduled",
    scheduledOn: "2026-08-28",
    format: "Video · 60 min",
  };
  assert.equal(websiteAddLoopRoundSchema.safeParse(draft).success, true);
  const command = await buildWebsiteAddRoundCommand("owner-a", draft);
  const exactRetry = await buildWebsiteAddRoundCommand("owner-a", draft);
  assert.deepEqual(command, exactRetry);
  assert.match(command.stage.stageId, /^stage-[a-f0-9]{32}$/);
  assert.equal(command.stage.scheduledAt, Date.parse("2026-08-28T12:00:00.000Z"));
  assert.equal("order" in command.stage, false);
  assert.equal(command.authorization, "website_owner");
  assert.equal(addLoopRoundCommandSchema.safeParse(command).success, true);
  assert.equal(websiteAddLoopRoundSchema.safeParse({ ...draft, status: "planned" }).success, false);
  assert.equal(websiteAddLoopRoundSchema.safeParse({ ...draft, scheduledOn: undefined }).success, false);
});

test("Loops route and UI keep website authorization server-side", async () => {
  const [route, roundRoute, dialog, workspace, resources] = await Promise.all([
    readFile(new URL("../app/api/loops/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/loops/rounds/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/loop-create-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/loops-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/round-resources.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /resolveOwnerId\(request\)/);
  assert.match(route, /readBoundedJson\(request, 160_000\)/);
  assert.match(route, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(route, /createLoopFromWebsite\(ownerId, body\)/);
  assert.match(dialog, /"idempotency-key": operationId/);
  assert.doesNotMatch(dialog, /authorization/);
  assert.match(dialog, /No AI or provider call/);
  assert.match(dialog, /aria-current=\{index === step \? "step"/);
  assert.match(dialog, /inline \? "Add another Loop"/);
  assert.match(roundRoute, /addLoopRoundFromWebsite\(ownerId, body\)/);
  assert.match(roundRoute, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(workspace, /"Add another Round"/);
  assert.match(workspace, /<LoopCreateDialog inline/);
  assert.doesNotMatch(workspace, /InterviewPackageDialog/);
  assert.match(resources, /title="Recording & Transcript"/);
  assert.match(resources, /title="Resources"/);
  assert.match(resources, /onDrop=/);
  assert.match(resources, />Resume</);
});
