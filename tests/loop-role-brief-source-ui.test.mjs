import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fetchRoleBriefSource, parseJobDescription } from "../app/loop-role-brief-source.ts";

test("the private source fetch requests one exact revision without caching", async () => {
  const controller = new AbortController();
  const payload = {
    loopId: "loop-public-fixture",
    roleBriefRevision: 2,
    label: "Example Platform Engineer",
    company: "Example Co",
    roleTitle: "Platform Engineer",
    source: {
      kind: "public_posting",
      displayLocator: "https://example.com/jobs/platform-engineer",
      capturedAt: 1_787_900_000_000,
      jdText: "# Platform Engineer",
      fingerprint: "a".repeat(64),
    },
    createdAt: 1_787_900_000_000,
  };
  const fetcher = async (input, init) => {
    assert.equal(
      input,
      "/api/loops/role-brief-source?loopId=loop-public-fixture&roleBriefRevision=2&includeArchived=false",
    );
    assert.equal(init.cache, "no-store");
    assert.equal(init.signal, controller.signal);
    return Response.json(payload);
  };

  assert.deepEqual(
    await fetchRoleBriefSource("loop-public-fixture", 2, false, controller.signal, fetcher),
    payload,
  );

  await assert.rejects(
    fetchRoleBriefSource("loop-public-fixture", 2, true, undefined, async () => (
      Response.json({ error: "That owner-private Loop is unavailable." }, { status: 404 })
    )),
    /owner-private Loop is unavailable/,
  );
});

test("the job-description reader preserves structured headings, prose, and ordered bullet groups", () => {
  const blocks = parseJobDescription(`# Platform Engineer

Build secure systems across teams.
Keep source text inert: <script>alert("never execute")</script>

## Responsibilities
- Design APIs
- Improve delivery

## Requirements
- Experience with distributed systems`);

  assert.deepEqual(blocks, [
    { type: "heading", level: 1, text: "Platform Engineer" },
    {
      type: "paragraph",
      text: "Build secure systems across teams. Keep source text inert: <script>alert(\"never execute\")</script>",
    },
    { type: "heading", level: 2, text: "Responsibilities" },
    { type: "list", items: ["Design APIs", "Improve delivery"] },
    { type: "heading", level: 2, text: "Requirements" },
    { type: "list", items: ["Experience with distributed systems"] },
  ]);
});

test("the Loop detail uses a modal source reader and semantic exact-attempt links", async () => {
  const source = await readFile(new URL("../app/loops-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /workspace\.inert = true/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /data-loop-activity-id=/);
  assert.match(source, /onOpenActivity\(activity\.activityId\)/);
  assert.doesNotMatch(source, /showSource \? <section className="loop-jd-source"/);
});
