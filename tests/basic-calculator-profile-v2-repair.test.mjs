import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { solutionProfileMissingRequirements } from "../app/solution-profile-policy.ts";
import {
  TARGET,
  buildMutationBatch,
  databaseIdFromConfig,
  executeRemoteBatch,
  renderArtifact,
  resultSetsFromWrangler,
  validateProfile,
} from "../scripts/repairs/basic-calculator-profile-v2.mjs";

const profile = JSON.parse(await readFile(
  path.join(process.cwd(), "scripts/repairs/basic-calculator-profile-v2.json"),
  "utf8",
));

function baseSnapshot() {
  return {
    profile: [{
      owner_id: "owner-fixture",
      specialty: "leetcode",
      question_id: TARGET.questionId,
      title: TARGET.title,
      current_revision: 1,
      tags: '["legacy"]',
      payload: '{"legacy":true}',
      updated_at: 100,
    }],
    revisions: [{
      owner_id: "owner-fixture",
      specialty: "leetcode",
      question_id: TARGET.questionId,
      revision: 1,
      activity_id: TARGET.activityId,
      payload: '{"legacy":true}',
      created_at: 90,
    }],
    finalization: [{ revision: 1, payload: '{"preserved":true}' }],
    solutionLink: [{ solution_revision: 1, activity_id: TARGET.activityId }],
    codeAttempts: [],
    activity: [{ id: TARGET.activityId }],
    timers: [{ revision: 4 }],
    outcomes: [{ outcome: "failed" }],
    publication: [{ artifact_path: "practice/leetcode/attempts/existing.md" }],
    activityNotes: [],
    practiceNotes: [],
    transcript: [{ turn_id: "turn-1" }],
    audio: [{ id: "clip-1" }],
    delivery: [{ id: "delivery-1" }],
  };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE problem_solution_profiles (
      owner_id TEXT NOT NULL,
      specialty TEXT NOT NULL,
      question_id TEXT NOT NULL,
      title TEXT NOT NULL,
      current_revision INTEGER NOT NULL,
      tags TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, specialty, question_id)
    );
    CREATE TABLE problem_solution_revisions (
      owner_id TEXT NOT NULL,
      specialty TEXT NOT NULL,
      question_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      activity_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, specialty, question_id, revision)
    );
    CREATE TABLE activity_solution_links (
      owner_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      specialty TEXT NOT NULL,
      question_id TEXT NOT NULL,
      solution_revision INTEGER NOT NULL,
      PRIMARY KEY (owner_id, activity_id)
    );
    CREATE TABLE leetcode_code_attempts (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
  `);
  db.prepare("INSERT INTO problem_solution_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("owner-fixture", "leetcode", TARGET.questionId, TARGET.title, 1, '["legacy"]', '{"legacy":true}', 100);
  db.prepare("INSERT INTO problem_solution_revisions VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("owner-fixture", "leetcode", TARGET.questionId, 1, TARGET.activityId, '{"legacy":true}', 90);
  db.prepare("INSERT INTO activity_solution_links VALUES (?, ?, ?, ?, ?)")
    .run("owner-fixture", TARGET.activityId, "leetcode", TARGET.questionId, 1);
  return db;
}

function executeSqliteBatchAtomically(db, batch, { failAt = -1 } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, statement] of batch.entries()) {
      if (index === failAt) throw new Error(`Injected failure at statement ${index + 1}.`);
      const prepared = db.prepare(statement.sql);
      if (/^\s*SELECT\b/i.test(statement.sql)) prepared.all(...statement.params);
      else prepared.run(...statement.params);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function javaHarness(inputs, expected) {
  return `
public class Main {
    public static void main(String[] args) {
        String[] inputs = {${inputs.map((input) => JSON.stringify(input)).join(",")}};
        int[] expected = {${expected.join(",")}};
        for (int i = 0; i < inputs.length; i++) {
            int actual = new Solution().calculate(inputs[i]);
            if (actual != expected[i]) {
                throw new AssertionError(inputs[i] + ": " + actual + " != " + expected[i]);
            }
        }
    }
}
`;
}

async function executeJavaImplementations(directory, implementations, inputs, expected) {
  for (const [index, java] of implementations.entries()) {
    const implementationDirectory = path.join(directory, `java-${index}`);
    await mkdir(implementationDirectory);
    await writeFile(path.join(implementationDirectory, "Solution.java"), `${java}\n`);
    await writeFile(path.join(implementationDirectory, "Main.java"), javaHarness(inputs, expected));
    execFileSync("javac", ["Solution.java", "Main.java"], { cwd: implementationDirectory });
    execFileSync("java", ["Main"], { cwd: implementationDirectory });
  }
}

async function executePythonImplementation(directory, implementation, inputs, expected) {
  const pythonPath = path.join(directory, "solution.py");
  await writeFile(pythonPath, `${implementation}\n\ncases = ${JSON.stringify(inputs)}\nexpected = ${JSON.stringify(expected)}\nfor expression, answer in zip(cases, expected):\n    actual = Solution().calculate(expression)\n    assert actual == answer, (expression, actual, answer)\n`);
  execFileSync("python3", [pythonPath]);
}

test("Basic Calculator revision 2 remains immutable and readable under the newer depth gate", () => {
  validateProfile(profile);
  const missing = solutionProfileMissingRequirements("leetcode", profile);
  assert.ok(missing.includes("detailed self-contained problem section"));
  assert.ok(missing.includes("detailed Editorial-first approach catalog section"));
  const rendered = renderArtifact(profile);
  assert.match(rendered, /not a new practice attempt/i);
  assert.match(rendered, /### Alternative: Reverse scan with a token stack/);
  assert.match(rendered, /### Alternative: Distribute accumulated sign contexts/);
  assert.doesNotMatch(rendered, /^activity_id:/m);
});

test("every published Basic Calculator reference implementation executes high-signal cases", async () => {
  const source = profile.sections.map((section) => section.body).join("\n");
  const javaBlocks = [...source.matchAll(/```java\n([\s\S]*?)```/g)].map((match) => match[1].trim());
  const pythonBlock = source.match(/```python\n([\s\S]*?)```/)?.[1].trim();
  assert.equal(javaBlocks.length, 3);
  assert.ok(pythonBlock);

  const deeplyNested = `${"(".repeat(2_000)}1${")".repeat(2_000)}`;
  const inputs = [
    "1 + 1",
    " 2-1 + 2 ",
    "(1+(4+5+2)-3)+(6+8)",
    "1-(2-3)",
    "-(2+3)",
    "1-(-2)",
    "1-(2-(3-4))",
    "123-(45+6)",
    "42",
    deeplyNested,
  ];
  const expected = [2, 3, 23, 2, -5, 3, -2, 72, 42, 1];
  const directory = await mkdtemp(path.join(os.tmpdir(), "basic-calculator-profile-v2-"));
  try {
    await executeJavaImplementations(directory, javaBlocks, inputs, expected);
    await executePythonImplementation(directory, pythonBlock, inputs, expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("guarded correction appends revision 2 and preserves the historical attempt link", () => {
  const db = database();
  executeSqliteBatchAtomically(db, buildMutationBatch(baseSnapshot(), profile, 200));

  const current = db.prepare("SELECT current_revision, payload FROM problem_solution_profiles").get();
  const revisions = db.prepare("SELECT revision, activity_id, payload FROM problem_solution_revisions ORDER BY revision").all();
  const link = db.prepare("SELECT solution_revision FROM activity_solution_links").get();
  const attempts = db.prepare("SELECT * FROM leetcode_code_attempts").all();

  assert.equal(current.current_revision, 2);
  assert.equal(current.payload, JSON.stringify(profile));
  assert.deepEqual(revisions.map((row) => row.revision), [1, 2]);
  assert.equal(revisions[0].payload, '{"legacy":true}');
  assert.equal(revisions[1].activity_id, TARGET.activityId);
  assert.equal(link.solution_revision, 1);
  assert.deepEqual(attempts, []);
});

test("transactional correction rolls back an inserted revision when a later statement fails", () => {
  const db = database();
  const batch = buildMutationBatch(baseSnapshot(), profile, 200);
  assert.throws(
    () => executeSqliteBatchAtomically(db, batch, { failAt: 6 }),
    /Injected failure at statement 7/,
  );

  assert.equal(db.prepare("SELECT current_revision FROM problem_solution_profiles").get().current_revision, 1);
  assert.deepEqual(
    db.prepare("SELECT revision FROM problem_solution_revisions ORDER BY revision").all().map((row) => row.revision),
    [1],
  );
});

test("guarded correction rejects stale current state and a pre-existing revision 2", () => {
  const divergentPointer = baseSnapshot();
  divergentPointer.profile[0].payload = '{"diverged":true}';
  assert.throws(() => buildMutationBatch(divergentPointer, profile, 200), /pointer payload does not match/);

  const stale = baseSnapshot();
  stale.profile[0].current_revision = 2;
  assert.throws(() => buildMutationBatch(stale, profile, 200), /current revision must be exactly 1/);

  const duplicate = baseSnapshot();
  duplicate.revisions.push({ ...duplicate.revisions[0], revision: 2 });
  assert.throws(() => buildMutationBatch(duplicate, profile, 200), /revision 2 must be absent/);
});

test("remote correction sends one parameterized Cloudflare D1 batch", async () => {
  const batch = buildMutationBatch(baseSnapshot(), profile, 200);
  let request;
  const results = await executeRemoteBatch(batch, {
    accountId: "account-fixture",
    apiToken: "token-fixture",
    databaseId: "database-fixture",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: batch.map(() => ({ success: true, results: [] })),
        }),
      };
    },
  });

  assert.equal(results.length, batch.length);
  assert.equal(request.url, "https://api.cloudflare.com/client/v4/accounts/account-fixture/d1/database/database-fixture/query");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer token-fixture");
  assert.deepEqual(JSON.parse(request.init.body), { batch });
  assert.ok(batch.every((statement) => Array.isArray(statement.params)));
  assert.ok(batch[5].sql.includes("VALUES (?, ?, ?, 2, ?, ?, ?)"));
});

test("remote correction rejects a failed statement result", async () => {
  const batch = buildMutationBatch(baseSnapshot(), profile, 200);
  await assert.rejects(
    executeRemoteBatch(batch, {
      accountId: "account-fixture",
      apiToken: "token-fixture",
      databaseId: "database-fixture",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: batch.map((_, index) => index === 6
            ? { success: false, errors: [{ message: "injected D1 failure" }] }
            : { success: true, results: [] }),
        }),
      }),
    }),
    /statement 7 failed: injected D1 failure/,
  );
});

test("repair resolves the configured production D1 database ID", async () => {
  const source = await readFile(path.join(process.cwd(), "wrangler.jsonc"), "utf8");
  assert.equal(databaseIdFromConfig(source), "28834aae-e412-4046-913b-02684f1e11cf");
  assert.throws(() => databaseIdFromConfig('{"binding":"OTHER"}'), /does not define/);
});

test("Wrangler result parsing keeps every statement result set", () => {
  assert.deepEqual(resultSetsFromWrangler(JSON.stringify([
    { results: [{ id: 1 }] },
    { results: [{ id: 2 }] },
  ])), [[{ id: 1 }], [{ id: 2 }]]);
});
