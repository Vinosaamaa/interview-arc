import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Loop Recorder has one routed durable specialist guide", async () => {
  const [root, guide, startup] = await Promise.all([
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../loops/AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/agents/task-startup-prompts.md", import.meta.url), "utf8"),
  ]);
  assert.match(root, /Loop Recorder, hiring Loops, Role Briefs \| `loops\/AGENTS\.md`/);
  assert.match(startup, /interview-arc\/loops\/AGENTS\.md/);
  assert.match(guide, /Only the Loop Recorder specialist may call `create_loop`, `revise_loop`, and\n`revise_loop_role_brief`/);
  assert.match(guide, /owner-authenticated website may\ncreate Loop and Role Brief revision 1/);
  assert.match(guide, /it cannot revise either aggregate/);
  assert.match(guide, /Exact or Reconstructed/);
  assert.match(guide, /never infer interviewer feedback/i);
  assert.match(guide, /`capturedAt`/);
  assert.match(guide, /`backfilledAt`/);
  for (const tool of [
    "create_loop",
    "revise_loop",
    "revise_loop_role_brief",
    "query_loops",
    "migrate_target_profile_to_loop",
    "capture_loop_packet",
    "import_loop_capture_packet",
  ]) {
    assert.match(guide, new RegExp("`" + tool + "`"));
  }
});
