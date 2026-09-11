import assert from "node:assert/strict";
import test from "node:test";
import { behavioralTargetErrorMessage, readBehavioralTargetResponse } from "../app/behavioral-target-response.ts";

test("role context tolerates intermediary HTML and malformed JSON with a concise recovery message", async () => {
  for (const response of [
    new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
    new Response("<html>Gateway</html>", { status: 503, headers: { "content-type": "text/html" } }),
    new Response("{broken", { headers: { "content-type": "application/json" } }),
    Response.json(null), Response.json([]),
  ]) {
    await assert.rejects(async () => readBehavioralTargetResponse(response), error => {
      assert.match(behavioralTargetErrorMessage(error), /Reload this page to reconnect, then retry/);
      assert.doesNotMatch(behavioralTargetErrorMessage(error), /SyntaxError|expected pattern|<html>/);
      return true;
    });
  }
});

test("role context keeps valid API errors and recovers on the next valid response", async () => {
  await assert.rejects(() => readBehavioralTargetResponse(Response.json({ error: "Please sign in again." }, { status: 401 })), error => {
    assert.equal(behavioralTargetErrorMessage(error), "Please sign in again.");
    return true;
  });
  assert.deepEqual(await readBehavioralTargetResponse(Response.json({ bindings: [] })), { bindings: [] });
});

test("role context does not expose schema or network internals", () => {
  for (const reason of [new Error('[{"expected":"array","path":["bindings"]}]'), new TypeError("Failed to fetch"), null]) {
    assert.equal(behavioralTargetErrorMessage(reason), "Saved role context could not be loaded. Reload this page to reconnect, then retry.");
  }
});
