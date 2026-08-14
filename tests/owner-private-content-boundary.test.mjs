import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateOwnerPrivateContentBoundary } from "../scripts/validate-owner-private-content-boundary.mjs";

const manifestPath = "docs/contracts/legacy-owner-private-content-manifest.json";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "arc-private-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relativePath = "practice/leetcode/attempts/attempt.md";
  const body = "private attempt\n";
  await mkdir(path.join(root, path.dirname(relativePath)), { recursive: true });
  await mkdir(path.join(root, path.dirname(manifestPath)), { recursive: true });
  await writeFile(path.join(root, relativePath), body);
  await writeFile(path.join(root, manifestPath), JSON.stringify({
    schemaVersion: 1,
    frozenAtCommit: "fixture",
    entries: [{ path: relativePath, sha256: createHash("sha256").update(body).digest("hex") }],
  }));
  return { root, relativePath };
}

test("accepts only byte-identical frozen legacy owner-private content", async (t) => {
  const { root } = await fixture(t);
  assert.deepEqual(await validateOwnerPrivateContentBoundary(root), { checked: 1, frozenAtCommit: "fixture" });
});

test("rejects changed legacy owner-private bytes", async (t) => {
  const { root, relativePath } = await fixture(t);
  await writeFile(path.join(root, relativePath), "rewritten attempt\n");
  await assert.rejects(
    validateOwnerPrivateContentBoundary(root),
    /Legacy owner-private Git content is immutable; a frozen file changed/,
  );
});

test("rejects a new owner-private Git artifact", async (t) => {
  const { root } = await fixture(t);
  const added = "practice/system-design/sessions/new-session.md";
  await mkdir(path.join(root, path.dirname(added)), { recursive: true });
  await writeFile(path.join(root, added), "new private session\n");
  await assert.rejects(
    validateOwnerPrivateContentBoundary(root),
    /New owner-private Git content is forbidden under a protected content root/,
  );
});

test("rejects a new revisioned Solution Profile artifact", async (t) => {
  const { root } = await fixture(t);
  const added = "practice/system-design/solutions/example.md";
  await mkdir(path.join(root, path.dirname(added)), { recursive: true });
  await writeFile(path.join(root, added), "---\n  solution_profile_revision: 3\n---\nnew private profile\n");
  await assert.rejects(
    validateOwnerPrivateContentBoundary(root),
    /New owner-private Git content is forbidden under a protected content root/,
  );
});

test("rejects a one-time owner repair packet in Git", async (t) => {
  const { root } = await fixture(t);
  const added = "scripts/repairs/owner-practice-repair.json";
  await mkdir(path.join(root, path.dirname(added)), { recursive: true });
  await writeFile(path.join(root, added), '{"private":"practice bytes"}');
  await assert.rejects(
    validateOwnerPrivateContentBoundary(root),
    /New owner-private Git content is forbidden under a protected content root/,
  );
});

test("does not treat an ignored local recording as Git narrative", async (t) => {
  const { root } = await fixture(t);
  const recording = "audio-answers/local-recording.m4a";
  await mkdir(path.join(root, path.dirname(recording)), { recursive: true });
  await writeFile(path.join(root, recording), "local bytes");
  assert.equal((await validateOwnerPrivateContentBoundary(root)).checked, 1);
});
