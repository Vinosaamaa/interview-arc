import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Behavioral Bank and Today expose display-safe Target Profile workflows", async () => {
  const [home, desk, bindings, contract, targetRoute, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/behavioral-target-desk.tsx"),
    load("../app/behavioral-target-bindings.tsx"),
    load("../app/behavioral-target-contract.ts"),
    load("../app/api/behavioral-targets/route.ts"),
    load("../app/behavioral-targets.css"),
  ]);
  assert.match(home, /<BehavioralTargetDesk/);
  assert.match(home, /<BehavioralTargetBindings/);
  assert.match(desk, /Create Target Profile/);
  assert.match(desk, /Paste job description/);
  assert.match(desk, /Import public posting/);
  assert.match(desk, /Archived/);
  assert.match(bindings, /Inherited from session/);
  assert.match(bindings, /Activity override/);
  assert.match(bindings, /No target/);
  const displayRenderer = desk.slice(desk.indexOf("function TargetRevision"), desk.indexOf("export default function"));
  assert.doesNotMatch(displayRenderer, /jdText/);
  assert.doesNotMatch(bindings, /jdText/);
  assert.match(contract, /behavioralTargetPublicSourceSchema\.extend/);
  assert.match(targetRoute, /fetchPublicBehavioralTargetSource/);
  assert.match(targetRoute, /VERIFIED_PUBLIC_TARGET_SOURCE/);
  assert.match(bindings, /behavioralTargetBindingBatchReadSchema/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
