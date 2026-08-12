import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Resume & Cover Letter is a registered administrative specialist outside practice", async () => {
  const [guide, startup, rootGuide, durablePractice, schema, worker, architecture, contract, packageJson] = await Promise.all([
    load("../career-materials/resume-cover-letter/AGENTS.md"),
    load("../docs/agents/task-startup-prompts.md"),
    load("../AGENTS.md"),
    load("../db/durable-practice.ts"),
    load("../db/schema.ts"),
    load("../mcp-worker/index.ts"),
    load("../docs/architecture/single-project-practice-workflow.md"),
    load("../docs/contracts/resume-revision-ingest.md"),
    load("../package.json"),
  ]);

  assert.match(rootGuide, /Resume or cover-letter administration[^\n]*career-materials\/resume-cover-letter\/AGENTS\.md/);
  assert.match(startup, /Create seven long-lived Codex tasks/);
  assert.match(startup, /Interview Arc — Resume & Cover Letter/);
  assert.match(startup, /match the six exact specialist titles/);
  assert.match(startup, /all six specialist tasks/);
  assert.match(startup, /complete JD is sufficient input/i);
  assert.match(architecture, /Loop Recorder\s+and Resume & Cover Letter are administrative specialists/);
  assert.match(architecture, /Learning\s+Specialist owns tutoring/);
  assert.match(architecture, /none is an Interview practice specialty/);
  assert.match(durablePractice, /SpecialistTaskType = Specialty \| "loop_recorder" \| "learning_specialist" \| "resume_cover_letter"/);
  assert.match(schema, /"loop_recorder", "learning_specialist", "resume_cover_letter"/);
  assert.match(worker, /"behavioral", "loop_recorder", "learning_specialist", "resume_cover_letter"/);

  assert.match(guide, /not Interview practice/i);
  assert.match(guide, /Never create or mutate an Interview activity/);
  assert.match(guide, /Never inherit the practice-specialist persistence footer/);
  assert.match(guide, /Use `query_behavioral_evidence`/);
  assert.match(guide, /Use `get_resume_library`/);
  assert.match(guide, /authenticated Google Drive connector/);
  assert.match(guide, /before[\s\S]*after[\s\S]*exports/i);
  assert.match(guide, /resume:import:google-doc/);
  assert.match(guide, /installed `cover-letter` skill/);
  assert.match(guide, /final cover letter is one matching DOCX\/PDF pair/i);
  assert.match(guide, /Interview Arc owns its\s+immutable D1 metadata and private R2 bytes/);
  assert.match(guide, /must not be contacted or\s+created merely to generate or save a letter/i);
  assert.match(guide, /cover-letter:save/);
  assert.doesNotMatch(guide, /save_practice_exchange|append_practice_transcript|save_specialist_finalization/);
  assert.match(contract, /resume_source_changed_during_export/);
  assert.match(contract, /never the Drive ID\/revision, provider URL, capture path/);
  assert.equal(JSON.parse(packageJson).scripts["resume:import:google-doc"], "node scripts/import-google-doc-resume.mjs");
  assert.equal(JSON.parse(packageJson).scripts["cover-letter:save"], "node scripts/save-cover-letter-to-interview-arc.mjs");
});
