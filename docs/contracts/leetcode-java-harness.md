# CLI-Native LeetCode Java Harness Contract

This contract defines the local self-test workflow for the one evolving Java
source file used during a CLI-native LeetCode activity. The harness is a fast
coaching aid. It is not LeetCode's judge, hidden-test coverage, an exhaustive
proof, a Code Attempt boundary, or evidence that the user obtained Accepted.

## Deterministic activity state

The runner is `scripts/leetcode-java-harness.mjs`. Its default local state root
is `~/Library/Caches/InterviewArc/leetcode-java-harnesses`; tests may override
that root with `INTERVIEW_ARC_HARNESS_ROOT`. Harness state, generated Java,
manifests, compiled classes, and run workspaces never belong under
`practice/leetcode/solutions/` and never enter Git.

At the start of one activity, the primary specialist derives one verified
problem signature from the canonical problem identity plus the exact Java
starter entry points and supplied helper types. It then runs:

```bash
node scripts/leetcode-java-harness.mjs prepare \
  --activity-id <activity-id> \
  --signature <verified-problem-and-starter-signature> \
  --source <absolute-evolving-java-file>
```

`prepare` atomically reserves a deterministic generation and writes status
`preparing`. Its JSON result contains `created`, `generationId`,
`stagingDirectory`, `deadlineAt`, the stable Quick and Full commands, and the
sub-agent publish/failure commands. An exact repeat returns `created: false`
and the same generation. The primary specialist spawns a helper only when
`created` is true, which enforces exactly one Codex sub-agent per activity and
verified signature. A changed verified signature creates a new generation and
marks the old one stale. An activity-scoped local mutex serializes prepare,
publish/fail, and run operations. A signature transition therefore cannot
reorder `active.json` or invalidate a test midway through compilation and
execution; a crashed lock expires with an actionable bounded wait.

The initial visible specialist response must immediately provide all three
user commands before harness generation finishes:

1. the complete `nvim "<absolute-source-path>"` command;
2. the returned default Quick command; and
3. the returned command ending in `--full`.

Every physical line in these user-facing shell blocks must be at most 59
characters and must remain directly pasteable as one valid shell operation.
Each block contains exactly one command: no variable declarations, arrays,
aliases, helper commands, or preceding `cd`. Continue between ordinary
arguments with a trailing backslash. Split an overlong path or opaque ID inside
the same double-quoted token by placing a final backslash before the newline;
the continuation begins at rendered column one so no whitespace enters the
value. Never rely on visual wrapping. Before sending, verify the physical line
lengths, parse with `zsh -n`, and execute safe equivalent editor and runner
smokes.

The primary specialist finishes that ordinary response immediately. It does
not await the helper and never sends a proactive “harness ready” message. The
user simply reruns the same previously supplied command.

## Sub-agent publication protocol

The one harness sub-agent receives the verified signature, starter scaffold,
reserved staging directory, generation identity, and this contract. It may
write only inside that staging directory. It must not edit the evolving user
source, a D1 record, the solution directory, the persistent browser, a timer,
or an outcome.

The sub-agent writes `manifest.json` plus every declared Java harness file,
then invokes the returned `publish` command. The runner validates every file,
the activity/generation/signature identity, suite relationship, filenames,
entry point, and timeout. It renames the complete staging directory to the
published location atomically and changes status to `ready` only afterward.
The run command never reads staging, so it cannot compile a partial harness.

If delegation is unavailable or generation fails, the primary specialist or
helper invokes the returned `fail` command with a precise actionable reason.
The initial visible response still contains the editor and both test commands.
Repair, if the user asks for it later, occurs in a normal new turn and reuses
the same activity generation; it never rewrites the working source.

## Harness manifest

The published manifest has this versioned shape:

```json
{
  "schemaVersion": 1,
  "activityId": "stable-activity-id",
  "generationId": "signature-derived-generation",
  "signatureHash": "sha256-of-verified-starter-signature",
  "sourceFileName": "Solution.java",
  "mainClass": "HarnessMain",
  "harnessFiles": ["HarnessMain.java", "TreeNode.java"],
  "quickCases": ["visible-example-1", "empty-boundary"],
  "fullCases": ["visible-example-1", "empty-boundary", "adversarial-duplicates"],
  "runTimeoutMs": 5000
}
```

`sourceFileName` is the compilation-only filename required by the exact
starter scaffold. It may be `Solution.java`, `Codec.java`, or another verified
public API class. `harnessFiles` contains only the generated main harness and
support types compilation actually requires. Every path is a single safe Java
filename; packages, traversal, symlinks, and replacement of the user source
copy are rejected.

`fullCases` must contain every Quick case in the same order and at least one
additional case. Publication rejects an equal, smaller, partial, malformed, or
identity-mismatched suite. Quick is bounded at 64 cases, Full local at 256
cases, and each case name at 160 characters. Compiler and harness output each
have an explicit 1 MiB process buffer; exceeding it fails locally with a
nonzero, actionable error instead of growing memory without limit.

## Quick suite and Full local suite

The default **Quick suite** contains compilation, visible examples, and a
small high-signal smoke/boundary set. It is optimized for repeated edit-save-run
feedback.

The **Full local suite**, selected only with `--full`, is a strict superset of
Quick. It adds broader boundaries, targeted adversarial cases,
problem-specific comparators, and a deterministic brute-force or differential
oracle when practical. Randomized differential tests use a fixed printed seed
so a failure is reproducible. “Full local” never means exhaustive, LeetCode
hidden tests, or an authoritative Accepted verdict.

Generated cases should cover the verified problem's meaningful shapes, which
may include empty arrays/strings, negative and multi-digit values, null roots,
linked structures, duplicate values, custom APIs such as `Codec`, and multiple
valid output orders. A comparator may use deterministic equality,
order-insensitive equality, or a clearly named property. Expected and actual
evidence must remain concise and deterministic.

## Latest-source compilation

Every run rereads the latest saved evolving Java file. It creates a new
temporary compilation workspace, copies the source bytes to
`sourceFileName`, copies only the manifest-declared harness files, and invokes
the installed Java 17 toolchain there. It never edits, renames, formats, or
snapshots the durable source. Public-class filename conflicts therefore exist
only in the temporary compilation workspace.

The runner verifies the published bundle hash before compiling and removes the
temporary workspace afterward. Compilation errors, runtime exceptions,
runaway-execution timeouts, protocol errors, and failed cases return nonzero.

## Harness JSON-lines protocol

The generated Java main class writes exactly one JSON object per selected test
case to standard output:

```json
{"type":"case","name":"visible-example-1","input":"nums=[2,7,11,15], target=9","expected":"indices with values summing to 9","actual":"[0,1]","passed":true}
```

The runner owns presentation and the final summary. It identifies the selected
suite and prints each deterministic name, input, expected value or property,
actual value, and pass/fail state. All-pass output uses **Locally verified** and
explicitly says that it is not a LeetCode Accepted verdict. Failed assertions,
compilation failures, runtime failures, and timeouts are clearly separated and
return a nonzero status.

## Status behavior

- `preparing`: print “Test harness is still preparing; run this command again
  shortly,” return temporary-failure status, and never compile staging files.
- `ready`: verify the immutable published bundle and test the latest source.
- `failed`: print the stored reason and tell the user to ask the specialist to
  repair preparation.
- `stale`: explain that the verified signature changed and require the current
  activity commands.
- `timed_out`: persist the terminal timeout state and provide the same repair
  guidance; never remain preparing forever.

## Durable-practice boundary

Harness reservation, helper prompts, raw runner commands, preparing/ready
receipts, generated Java plumbing, compiler output, and unrelated terminal
output stay local and outside D1. If the user discusses a meaningful test
conclusion, that conclusion may enter the activity exchange and an explicit
Code Attempt's evaluation evidence. Local runner success never changes a
timer, result, Code Attempt boundary, finalization, publication state, or
LeetCode submission.
