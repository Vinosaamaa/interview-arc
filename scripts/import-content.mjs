// Mirrors the Git-tracked content (journals, artifacts, stories, question banks)
// into D1 so the deployed site renders the latest without a redeploy. Full
// refresh per table (DELETE then INSERT) keeps it idempotent — safe to run on
// every merge to main.
//
// Usage:
//   node scripts/import-content.mjs            # local D1 (default)
//   node scripts/import-content.mjs --remote   # production D1
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readContent } from "./content-source.mjs";

const root = process.cwd();
const remote = process.argv.includes("--remote");
const now = Date.now();

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return sqlString(JSON.stringify(value));
}

// Full-refresh a table. Rows are chunked into several INSERTs so no single
// statement exceeds SQLite's size limit (SQLITE_TOOBIG on large banks).
const CHUNK_SIZE = 25;
function insert(table, columns, rows) {
  const parts = [`DELETE FROM ${table};`];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const values = chunk.map((row) => `(${row.join(", ")})`).join(",\n");
    parts.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
  }
  return parts.join("\n");
}

const { journals, artifacts, stories, questionBanks } = await readContent(root);

const statements = [];

statements.push(
  insert(
    "content_journals",
    ["date", "payload", "updated_at"],
    journals.map((journal) => [sqlString(journal.date), sqlJson(journal), now]),
  ),
);

statements.push(
  insert(
    "content_artifacts",
    ["path", "type", "date", "title", "payload", "updated_at"],
    artifacts.map((artifact) => [
      sqlString(artifact.path),
      sqlString(artifact.type),
      sqlString(artifact.date),
      sqlString(artifact.title),
      sqlJson(artifact),
      now,
    ]),
  ),
);

statements.push(
  insert(
    "content_stories",
    ["project_id", "ord", "payload", "updated_at"],
    stories.map((story, index) => [sqlString(story.projectId), index, sqlJson(story), now]),
  ),
);

const bankRows = [];
for (const category of ["leetcode", "systemDesign", "behavioral"]) {
  questionBanks[category].forEach((question, index) => {
    bankRows.push([sqlString(category), sqlString(question.id), index, sqlJson(question), now]);
  });
}
statements.push(insert("content_bank", ["category", "id", "ord", "payload", "updated_at"], bankRows));

const sql = statements.join("\n\n") + "\n";

const tmpDir = path.join(root, ".wrangler", "tmp");
await mkdir(tmpDir, { recursive: true });
const sqlPath = path.join(tmpDir, "import-content.sql");
await writeFile(sqlPath, sql);

const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const args = ["d1", "execute", "DB", remote ? "--remote" : "--local", "--file", sqlPath];

console.log(
  `Importing ${journals.length} journal(s), ${artifacts.length} artifact(s), ${stories.length} story project(s), ` +
    `and ${bankRows.length} bank question(s) into ${remote ? "remote" : "local"} D1...`,
);

execFileSync(wranglerBin, args, { cwd: root, stdio: "inherit" });

console.log("Content import complete.");
