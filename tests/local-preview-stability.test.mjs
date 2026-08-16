import assert from "node:assert/strict";
import test from "node:test";
import { shouldKeepLocalPreviewAlive } from "../scripts/stabilize-local-preview.mjs";

test("local preview stays up for inspector JSON parse and peer disconnects", () => {
  const jsonCrash = new SyntaxError("Unexpected token '\u001f', \"\u001f\u0013\"... is not valid JSON");
  assert.equal(shouldKeepLocalPreviewAlive(jsonCrash), true);
  assert.equal(shouldKeepLocalPreviewAlive(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
  assert.equal(shouldKeepLocalPreviewAlive(Object.assign(new Error("pipe"), { code: "EPIPE" })), true);
  assert.equal(shouldKeepLocalPreviewAlive(new Error("real bug")), false);
  assert.equal(shouldKeepLocalPreviewAlive(new TypeError("cannot read")), false);
});
