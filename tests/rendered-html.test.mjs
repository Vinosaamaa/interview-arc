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
  assert.match(bundle, /Add one activity/);
  assert.match(bundle, /Problem banks/);
  assert.doesNotMatch(bundle, /Practice library|Story bank|All finished/);
  assert.doesNotMatch(bundle, /Test console|Submit attempt|solution\.py/);
  assert.doesNotMatch(bundle, /codex-preview|react-loading-skeleton/);
});
