import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Behavioral Foundation renders a bounded responsive Story Shelf", async () => {
  const [component, contract, css] = await Promise.all([
    load("../app/behavioral-foundation.tsx"),
    load("../app/behavioral-foundation-contract.ts"),
    load("../app/globals.css"),
  ]);
  assert.match(component, /status\.stories\.active/);
  assert.match(component, /foundation-story-list/);
  assert.match(component, /story\.revision/);
  assert.doesNotMatch(component, /Story composition remains a later/);
  assert.match(contract, /storyBank: z\.literal\("available"\)/);
  assert.match(css, /\.foundation-story-list/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.foundation-ledger \{ grid-template-columns: 1fr; \}/);
});
