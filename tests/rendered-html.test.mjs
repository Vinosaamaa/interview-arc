import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function javascriptUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return javascriptUnder(target);
      return entry.name.endsWith(".js") ? readFile(target, "utf8") : "";
    }),
  );
  return files.flat().join("\n");
}

test("the Cloudflare build contains the Interview Arc dashboard", async () => {
  const bundle = await javascriptUnder(fileURLToPath(new URL("../dist", import.meta.url)));
  assert.match(bundle, /Interview Arc/);
  assert.match(bundle, /A clean page/);
  assert.match(bundle, /No session planned yet/);
  assert.match(bundle, /Add another session/);
  assert.match(bundle, /Edit session recipe/);
  assert.match(bundle, /Shape the session you need/);
  assert.match(bundle, /SESSION COUNTDOWN/);
  assert.match(bundle, /Add one activity/);
  assert.match(bundle, /Problem banks/);
  assert.match(bundle, /YESTERDAY/);
  assert.match(bundle, /365-DAY PRACTICE MAP/);
  assert.match(bundle, /Time spent versus outcome/);
  assert.match(bundle, /Topics practiced/);
  assert.match(bundle, /Begin today’s work/);
  assert.match(bundle, /TODAY’S MIX/);
  assert.match(bundle, /TODAY’S LISTENING/);
  assert.match(bundle, /Previous music track/);
  assert.match(bundle, /Save MP3/);
  assert.match(bundle, /Source ↗/);
  assert.match(bundle, /Ready for journal/);
  assert.match(bundle, /Connect Codex and the LeetCode companion/);
  assert.match(bundle, /Sweet September/);
  assert.match(bundle, /Forest Mist Whispers/);
  assert.match(bundle, /arrival-cozy-room-4k\.jpg/);
  assert.match(bundle, /arrival-illuminated-blossom-4k\.jpg/);
  assert.doesNotMatch(bundle, /Practice library|Story bank|All finished/);
  assert.doesNotMatch(bundle, /Test console|Submit attempt|solution\.py/);
  assert.doesNotMatch(bundle, /codex-preview|react-loading-skeleton/);
});
