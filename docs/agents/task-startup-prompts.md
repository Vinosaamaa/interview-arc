# Interview Arc Task Setup And Startup Prompts

Create four long-lived Codex tasks inside the same **Interview Prep** project.
They all use the same repository checkout; do not create separate folders,
projects, worktrees, or daily tasks.

Use these exact task titles:

1. `Interview Arc — Coordinator`
2. `Interview Arc — LeetCode`
3. `Interview Arc — System Design`
4. `Interview Arc — Behavioral`

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

## LeetCode First Prompt

```text
Initialize this long-lived task as Interview Arc — LeetCode. Read the outer
workspace instructions and interview-arc/practice/leetcode/AGENTS.md plus every
contract it requires. Use the Interview Arc MCP bridge to resolve the focused
coding activity. Save only activity-scoped exchanges, pinned notes, review, and
the complete generated model solution to D1; never infer my unshared code or
outcome. Do not switch Git branches or publish Git artifacts. Do not start a
problem yet. Confirm whether the MCP bridge is connected and summarize the
commands you will recognize.
```

## System Design First Prompt

```text
Initialize this long-lived task as Interview Arc — System Design. Read the outer
workspace instructions and interview-arc/practice/system-design/AGENTS.md plus
every contract it requires. Run coached mock interviews against the focused
dashboard activity, preserve the complete activity-scoped two-sided transcript
in D1, consult the stored SystemDesign.io references, and always finalize both
an honest review and a complete standalone model solution. Do not switch Git
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
honest review plus a complete standalone model answer. Do not switch Git
branches or publish Git artifacts. Do not start a drill yet. Confirm whether the
MCP bridge is connected, whether resume evidence is configured, and summarize
the commands you will recognize.
```

## One-Time Connection

After all four tasks exist and have the exact titles above, return to
`Interview Arc — Coordinator` and say:

```text
Connect specialist tasks.
```

The coordinator must:

1. list the Codex tasks in this project;
2. match the three exact specialist titles;
3. register each task/thread ID and host ID with
   `register_specialist_task`;
4. read the registry back with `get_specialist_tasks`;
5. report any missing, duplicate, or inaccessible task explicitly.

Task titles are discovery labels. Durable task IDs are the routing source of
truth after registration. The user should not paste IDs manually.

If the MCP bridge or the registration tools are unavailable, merge/deploy the
feature that introduced them, restart Codex so its environment token is loaded,
and run `Connect specialist tasks` again.

## Normal Commands After Setup

- In a specialist: natural practice language such as `Let's work on the focused
  problem`, `Let's do the current mock`, or `What is the solution to the current
  problem?`.
- In any specialist: `Please note for this problem: ...` pins the exact note.
- In one specialist: `Publish today's practice` flushes/finalizes all pending
  activities for that specialty in D1 only.
- In the coordinator: `Publish all pending practice` coordinates every
  specialist, renders the Git case files, and runs the journal publication
  workflow.

Starting a new Pacific day does not require a new task or a “start day” prompt.
The dashboard focus, activity ID, timestamps, and Pacific completion date carry
the context.
