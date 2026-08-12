import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RouteBodyTooLargeError, readBoundedJson } from "../app/api/route-helpers.ts";

const routeUrl = new URL("../app/api/learn/route.ts", import.meta.url);
const artifactRouteUrl = new URL("../app/api/learn/artifacts/route.ts", import.meta.url);

test("the Learn route keeps reads owner-private and mutations explicitly bounded", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /resolveOwnerId\(request\)/);
  assert.match(route, /readBoundedJson\(request, 128_000\)/);
  assert.match(route, /authorization: "explicit_user_instruction"/);
  assert.match(route, /action === "control_session"/);
  assert.match(route, /const \{ action, sessionAction, \.\.\.input \} = body/);
  assert.match(route, /action: sessionAction/);
  assert.match(route, /action === "finish_session"/);
  assert.match(route, /action === "set_homework_state"/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(route, /register_activity_audio_clip|save_delivery_analysis|objectKey/);
});

test("the Learn artifact route authenticates bounded private upload and download seams", async () => {
  const route = await readFile(artifactRouteUrl, "utf8");
  assert.match(route, /resolveOwnerId\(request\)/g);
  assert.match(route, /MAX_LEARNING_ARTIFACT_BYTES \+ 128_000/);
  assert.match(route, /authorization: "explicit_user_instruction"/);
  assert.match(route, /persistLearningArtifact\(/);
  assert.match(route, /readPrivateLearningArtifact\(ownerId, artifactId\)/);
  assert.match(route, /servePrivateLearningArtifact\(artifact, env\.AUDIO\)/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(route, /privateLocator|contentHash|sizeBytes/);
});

test("the shared request reader rejects oversized Learn mutation bodies", async () => {
  const request = new Request("https://example.test/api/learn", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "128001" },
    body: JSON.stringify({ action: "control_session" }),
  });
  await assert.rejects(() => readBoundedJson(request, 128_000), RouteBodyTooLargeError);
});
