import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Behavioral Bank and Today keep Target Profiles migration-only", async () => {
  const [home, desk, bindings, contract, targetRoute, bindingRoute, routeError, worker, css] = await Promise.all([
    load("../app/home-client.tsx"),
    load("../app/behavioral-target-desk.tsx"),
    load("../app/behavioral-target-bindings.tsx"),
    load("../app/behavioral-target-contract.ts"),
    load("../app/api/behavioral-targets/route.ts"),
    load("../app/api/behavioral-target-bindings/route.ts"),
    load("../app/api/behavioral-target-route-error.ts"),
    load("../mcp-worker/index.ts"),
    load("../app/behavioral-targets.css"),
  ]);
  assert.match(home, /<BehavioralTargetDesk/);
  assert.match(home, /<BehavioralTargetBindings/);
  assert.match(desk, /LEGACY TARGET PROFILES · MIGRATION ONLY/);
  assert.match(desk, /Loop Recorder/);
  assert.doesNotMatch(desk, /Create Target Profile|Paste job description|Import public posting|Revise/);
  assert.match(desk, /latestRevisionRequest/);
  assert.match(desk, /latestRevisionRequest\.current\[target\.targetId\] === revision/);
  assert.match(desk, /type="number"/);
  assert.doesNotMatch(desk, /Array\.from\(\{ length: target\.revision/);
  assert.match(bindings, /Historical activity binding/);
  assert.match(bindings, /Historical session inheritance/);
  assert.match(bindings, /Loop context or universal practice/);
  assert.doesNotMatch(bindings, /<select|Set exact revision|Clear override|Clear target/);
  const displayRenderer = desk.slice(desk.indexOf("function TargetRevision"), desk.indexOf("export default function"));
  assert.doesNotMatch(displayRenderer, /jdText/);
  assert.doesNotMatch(bindings, /jdText/);
  assert.match(contract, /behavioralTargetPublicSourceSchema\.extend/);
  assert.match(targetRoute, /rejectLegacyTargetProfileWrite/);
  assert.match(bindingRoute, /rejectLegacyTargetProfileWrite/);
  assert.match(targetRoute, /behavioralTargetRouteError/);
  assert.match(bindingRoute, /behavioralTargetRouteError/);
  assert.match(routeError, /behavioral_target_migration_only/);
  for (const route of [targetRoute, bindingRoute]) {
    const post = route.slice(route.indexOf("export async function POST"));
    assert.ok(post.indexOf("resolveOwnerId(request)") < post.indexOf("rejectLegacyTargetProfileWrite()"));
  }
  assert.doesNotMatch(targetRoute, /upsertBehavioralTargetProfile|changeBehavioralTargetProfileState|fetchPublicBehavioralTargetSource/);
  assert.doesNotMatch(worker, /server\.registerTool\(\s*"upsert_behavioral_target_profile"/);
  assert.doesNotMatch(worker, /server\.registerTool\(\s*"set_behavioral_target_binding"/);
  assert.match(bindings, /behavioralTargetBindingBatchReadSchema/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
