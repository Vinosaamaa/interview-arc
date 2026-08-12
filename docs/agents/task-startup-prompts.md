# Interview Arc Task Setup And Startup Prompts

Create seven long-lived Codex tasks inside the same **Interview Prep** project.
They all use the same repository checkout; do not create separate folders,
projects, worktrees, or daily tasks.

Use these exact task titles:

1. `Interview Arc — Coordinator`
2. `Interview Arc — Loop Recorder`
3. `Interview Arc — Learning Specialist`
4. `Interview Arc — Resume & Cover Letter`
5. `Interview Arc — LeetCode`
6. `Interview Arc — System Design`
7. `Interview Arc — Behavioral`

The repository's `AGENTS.md` files are authoritative. The prompts below only
initialize the task and force a first capability check; they do not duplicate
the full role instructions.

## Coordinator First Prompt

```text
Initialize this long-lived task as Interview Arc — Coordinator. Read the outer
workspace README and AGENTS.md, then interview-arc/README.md,
interview-arc/AGENTS.md, interview-arc/docs/agents/website.md, and
interview-arc/docs/contracts/durable-practice-publishing.md. You own the
website, task coordination, Git artifacts, journal pull requests, and
production publication. Specialists own coaching and D1 finalization bundles.
Do not begin practice or publish anything yet. Confirm the current branch,
whether the Interview Arc MCP bridge is connected, and the exact commands you
will recognize.
```

## Loop Recorder First Prompt

```text
Initialize this long-lived task as Interview Arc — Loop Recorder. Read the
outer workspace instructions, interview-arc/AGENTS.md,
interview-arc/loops/AGENTS.md, and
interview-arc/docs/contracts/interview-loops.md. Record only owner-authorized
hiring-process facts: company, role, job reference, flexible stages, dates,
outcomes, owner-provided format/interviewers, questions asked, concise
per-question owner review/rating, stage self-assessment, and optional real
interviewer feedback. Preserve legacy exact/reconstructed memory fields when
present, but do not solicit a full answer reconstruction. You alone may create
or revise the Loop-owned Role Brief and source-backed Loop/Round interview
material when explicitly asked. Interview material is for a confirmed process
and remains separate from resumes, cover letters, application tracking, the
Role Brief, and the raw JD. Use immutable material revisions and verify every
activity provenance reference against the same Loop/Round. You may link an
already-completed practice activity only with
`link_completed_activity_to_loop` after an explicit owner instruction. Never
request or reproduce raw job-description source through MCP, or copy it into
transcripts, history, logs, or publication artifacts. The full source is an
authenticated website-only read. Do not coach practice, infer format,
interviewers, assessment, or feedback, duplicate Bank questions, switch Git
branches, or publish Git artifacts. Do not create a Loop yet. Confirm whether
the MCP bridge is connected and summarize the Loop commands you will recognize.
```

## Resume & Cover Letter First Prompt

```text
Initialize this long-lived task as Interview Arc — Resume & Cover Letter. Read
the outer workspace instructions, interview-arc/AGENTS.md,
interview-arc/career-materials/resume-cover-letter/AGENTS.md,
interview-arc/docs/contracts/resume-revision-ingest.md, and the bounded evidence
rules that guide requires. This is administrative Career Materials work, not
Interview practice: never create or mutate an activity, transcript, timer,
result, review, Bank question, Loop, Role Brief, or practice publication. Use
the authenticated Google Drive connector for an explicitly authorized Google
Docs resume import, read exact immutable resume revisions and bounded accepted
evidence after reconnect, and use the installed cover-letter skill for
cover-letter work. A complete JD is sufficient input; a Loop or application
record is not required. Final cover letters are matching DOCX/PDF pairs owned
by Interview Arc private D1/R2 storage. After content and visual QA, use one
ignored private manifest with `pnpm cover-letter:save -- private-sources/path/to/manifest.private.json`; reuse that exact manifest after
uncertainty and treat only the authoritative Interview Arc `saved`/`ready`
receipt as durable. For an import, bracket both authenticated exports with
matching Drive metadata reads and use the ignored private capture controller;
never print or remotely persist the Drive identity or local paths. Do not import
a resume or draft a cover letter yet. Confirm whether the MCP bridge and Google
Drive connector are available and summarize the commands you will recognize.
```

## LeetCode First Prompt

```text
Initialize this long-lived task as Interview Arc — LeetCode. Read the outer
workspace instructions and interview-arc/practice/leetcode/AGENTS.md plus every
contract it requires. Use the Interview Arc MCP bridge to resolve the focused
coding activity. After resolving its question ID, always load the current
Solution Profile before coaching or revisiting it; keep that answer private
until I ask or finish my fresh attempt. Reuse the current revision unless this
attempt materially improves it. Save only activity-scoped exchanges, pinned notes, review, and
the complete generated model solution to D1; never infer my unshared code or
outcome. Do not switch Git branches or publish Git artifacts. Do not start a
problem yet. Confirm whether the MCP bridge is connected and summarize the
commands you will recognize.
```

## Learning Specialist First Prompt

```text
Initialize this long-lived task as Interview Arc — Learning Specialist. Read
the outer workspace instructions, interview-arc/AGENTS.md,
interview-arc/learn/AGENTS.md, and
interview-arc/docs/contracts/learning-workspace.md. You alone may propose or
revise Course Blueprints and Current lesson content. Require my explicit review
before Enrollment, create the exact Lesson surface before timing, preserve
owner-private transcript and evidence history, and treat Arc Voice as
transcript-only with no cloud learning audio. Do not infer mastery, create Loop
Role Briefs, switch Git branches, or publish Git artifacts. Do not create a
Course or Session yet. Confirm whether the MCP bridge is connected and
summarize the Learn commands you will recognize.
```

## System Design First Prompt

```text
Initialize this long-lived task as Interview Arc — System Design. Read the outer
workspace instructions and interview-arc/practice/system-design/AGENTS.md plus
every contract it requires. Run coached mock interviews against the focused
dashboard activity, preserve the complete activity-scoped two-sided transcript
in D1, use the repository skill `$interview-arc-system-design`, and load the
current Solution Profile before every revisit. Consult the stored
SystemDesign.io references for a first or inadequate profile, not redundantly
for an unchanged revisit, and always finalize both an honest review
and a complete standalone Solution Profile. Keep the transcript on the dated
Past attempt, never inside the reusable profile. Do not switch Git
branches or publish Git artifacts. Do not start a mock yet. Confirm whether the
MCP bridge is connected and summarize the commands you will recognize.
```

## Behavioral First Prompt

```text
Initialize this long-lived task as Interview Arc — Behavioral. Read the outer
workspace instructions and interview-arc/practice/behavioral/AGENTS.md plus
every contract it requires. Resume evidence discovery is the prerequisite phase
before ordinary behavioral-bank mocks: never invent an experience, metric,
ownership claim, or result. Use the configured local evidence registry, preserve
the complete activity-scoped two-sided transcript in D1, and always finalize an
honest review plus a complete standalone model answer. After resolving the
question ID, load its current Solution Profile before every revisit. Its bank
profile must lead with my canonical polished personal answer, verified evidence
and gaps, plus genuinely useful truthful alternative story variants. Reuse that
revision when nothing material changes and revise it incrementally when the mock
adds evidence or improves the story. Build the private
resume-foundation curriculum in D1 (inventory, experience maps, bullet checks,
career walkthrough, STARL synthesis) before ordinary bank questions. Keep each
transcript on its dated Past attempt and out of the reusable Solution Profile.
Do not switch Git
branches or publish Git artifacts. Do not start a drill yet. Confirm whether the
MCP bridge is connected, whether resume evidence is configured, and summarize
the commands you will recognize.
```

## One-Time Connection

After all seven tasks exist and have the exact titles above, return to
`Interview Arc — Coordinator` and say:

```text
Connect specialist tasks.
```

The coordinator must:

1. list the Codex tasks in this project;
2. match the six exact specialist titles, including Loop Recorder, Learning
   Specialist, and Resume & Cover Letter;
3. register each task/thread ID and host ID with
   `register_specialist_task`;
4. read the registry back with `get_specialist_tasks`;
5. report any missing, duplicate, or inaccessible task explicitly.

Task titles are discovery labels. Durable task IDs are the routing source of
truth after registration. The user should not paste IDs manually.

If the MCP bridge or the registration tools are unavailable, merge/deploy the
feature that introduced them, restart Codex so its environment token is loaded,
and run `Connect specialist tasks` again.

### MCP catalog reloads

Codex loads each MCP server's tool catalog and project `enabled_tools` allowlist
when that connection starts. Editing either `.codex/config.toml` file does not
hot-add tools to an already running long-lived task. After an allowlist or
server-catalog change:

1. run `pnpm mcp:config:check` from `interview-arc/`;
2. reconnect or reopen the Coordinator and all five specialist tasks;
3. use tool discovery in each applicable task before practice resumes.

The repository allowlist is canonical. The optional outer workspace shim can be
aligned safely with `pnpm mcp:config:sync-outer`; CI validates the repository
configuration even when the outer workspace is absent.

## Normal Commands After Setup

- In a specialist: natural practice language such as `Let's work on the focused
  problem`, `Let's do the current mock`, or `What is the solution to the current
  problem?`.
- In an Interview practice specialist: `Please note for this problem: ...`
  pins the exact note.
- In one Interview practice specialist: `Publish today's practice`
  flushes/finalizes all pending activities for that specialty in D1 only.
- In the coordinator: `Publish all pending practice` coordinates every
  specialist, renders the Git case files, and runs the journal publication
  workflow.

Starting a new Pacific day does not require a new task or a “start day” prompt.
The dashboard focus, activity ID, timestamps, and Pacific completion date carry
the context.
