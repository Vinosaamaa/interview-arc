import assert from "node:assert/strict";
import test from "node:test";

import { parseJobDescription } from "../app/loop-role-brief-source.ts";

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
