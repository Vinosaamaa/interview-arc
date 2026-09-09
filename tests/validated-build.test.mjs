import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const find = createRequire(import.meta.url)("../scripts/find-validated-build.cjs");

function fixture(overrides = {}) {
  const artifact = { name: "validated-worker-tree", expired: false, workflow_run: { id: 17 }, ...overrides.artifact };
  const run = { id: 17, workflow_id: 5, event: "pull_request", status: "completed", conclusion: "success",
    head_repository: { full_name: "owner/repo" }, head_sha: "head", ...overrides.run };
  return {
    tree: "tree", context: { repo: { owner: "owner", repo: "repo" } },
    github: { rest: {
      actions: {
        listArtifactsForRepo: async () => ({ data: { artifacts: overrides.missing ? [] : [artifact] } }),
        getWorkflow: async () => ({ data: { id: 5 } }),
        getWorkflowRun: async () => ({ data: run }),
      },
      git: { getCommit: async () => ({ data: { tree: { sha: overrides.tree ?? "tree" } } }) },
    } },
  };
}
test("main reuses only a successful same-repository PR build for the identical tree", async () => {
  assert.equal(await find(fixture()), "17");
  for (const rejected of [
    { missing: true }, { artifact: { expired: true } },
    { artifact: { name: "validated-worker-other" } }, { tree: "changed" },
    { run: { conclusion: "failure" } }, { run: { status: "in_progress" } },
    { run: { event: "push" } }, { run: { workflow_id: 6 } },
    { run: { head_repository: { full_name: "fork/repo" } } },
  ]) assert.equal(await find(fixture(rejected)), "");
});
