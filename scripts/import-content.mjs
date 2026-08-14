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
import { buildTableRefreshSql } from "./content-import-sql.mjs";
import { validateOwnerPrivateContentBoundary } from "./validate-owner-private-content-boundary.mjs";

const root = process.cwd();
const remote = process.argv.includes("--remote");
const now = Date.now();

await validateOwnerPrivateContentBoundary(root);
const { journals, artifacts, stories, questionBanks } = await readContent(root);

const statements = [];

statements.push(
  buildTableRefreshSql(
    "content_journals",
    ["date", "payload", "updated_at"],
    journals.map((journal) => [journal.date, JSON.stringify(journal), now]),
    { largeTextColumn: "payload", keyColumns: ["date"] },
  ),
);

statements.push(
  buildTableRefreshSql(
    "content_artifacts",
    ["path", "type", "date", "title", "payload", "updated_at"],
    artifacts.map((artifact) => [
      artifact.path,
      artifact.type,
      artifact.date,
      artifact.title,
      JSON.stringify(artifact),
      now,
    ]),
    { largeTextColumn: "payload", keyColumns: ["path"] },
  ),
);

statements.push(
  buildTableRefreshSql(
    "content_stories",
    ["project_id", "ord", "payload", "updated_at"],
    stories.map((story, index) => [story.projectId, index, JSON.stringify(story), now]),
    { largeTextColumn: "payload", keyColumns: ["project_id", "ord"] },
  ),
);

const bankRows = [];
for (const category of ["leetcode", "systemDesign", "behavioral"]) {
  questionBanks[category].forEach((question, index) => {
    bankRows.push([category, question.id, index, JSON.stringify(question), now]);
  });
}
statements.push(
  buildTableRefreshSql("content_bank", ["category", "id", "ord", "payload", "updated_at"], bankRows, {
    largeTextColumn: "payload",
    keyColumns: ["category", "id"],
  }),
);

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
