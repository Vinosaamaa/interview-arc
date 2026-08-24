# Interview Prep Coordinator Fastlane

Use this lane by default for ordinary implementation and operational work
across `interview-arc` and `interview-arc-voice`; `fast fix`, `fast iteration`,
and `fastlane` explicitly reaffirm that choice. Follow every required lifecycle
step below; Fastlane removes repetition, not engineering requirements.

## Objective

Deliver the smallest complete fix with one evidence path and no repeated
ceremony. Fastlane shortens breadth and reporting; it does not lower the
correctness bar for the changed behavior.

## Required path

1. Route to the owning repository and search open and closed issues. Reuse or
   reopen the issue whenever it already owns the behavior; create a new issue
   only for distinct scope. Keep one coherent end-to-end outcome in one
   substantial issue with internal checklist items, and update it once with the
   corrected scope rather than creating duplicate planning artifacts.
2. Inspect only the affected contract, source, and focused tests. Do not repeat
   already completed repository orientation, broad searches, or unrelated
   status checks.
3. Start from current `main` in exactly one temporary isolated issue-owned
   worktree on one scoped feature branch. The canonical root is
   `$HOME/Projects/interview-prep-support/worktrees`: use
   `arc-<issue-number>-<short-slug>`, `live-<issue-number>-<short-slug>`, or
   `voice-<issue-number>-<short-slug>` for the owning repository, with a short
   lowercase kebab-case slug. Never use `/tmp`, `/private/tmp`, a repository-
   local `.worktrees` directory, or another arbitrary path for durable issue
   work. Record the exact path and branch, reuse them for that issue, and never
   implement in the primary/shared checkout, reuse another issue's worktree,
   or create a duplicate. Preserve dirty, divergent, ambiguous, and unpublished
   work.
4. Make the smallest end-to-end change, including only the contract or agent
   guidance that would otherwise remain false.
5. Run the narrowest meaningful regression test plus a syntax, parser, or diff
   check. Let required CI supply the broad suite; do not rerun equivalent local
   suites without a concrete failure reason.
6. For UI or bundled-resource changes, prove the fix before hosted CI. Resource
   injection is valid only when the native binary and native↔web bridge are
   unchanged; otherwise build one disposable app containing both changed
   layers. Ad-hoc sign it, launch only that exact path, use an isolated local
   state root (never the normal Application Support store), and perform one
   reversible headed smoke of the reported interaction. Never present this
   staged copy as a release install, and never spend a cold CI run on pixels
   not yet approved locally.
   - For an embedded canvas, trace one gesture end to end: pointer/input,
     accepted scene, persistence publication, represented-host lifecycle,
     child-WebView attachment/frame, and per-frame toolbar/footer geometry.
     One accepted scene, one retained web session, and stable viewport/chrome
     are the required invariants; SwiftUI wrapper reconstruction is allowed,
     but a retained WebView must be an AppKit child rather than a directly
     reused represented view.
   - Accessibility movement is semantic evidence, not raw-pointer evidence.
     Use a physical pointer trace or an isolated deterministic diagnostic path.
     Run hosted CI only after the local interaction trace and headed smoke pass.
7. Open one coherent PR for the issue immediately after the focused checks and
   any required headed smoke. Link it without closing the issue before required
   merged-main and release verification. Review only the changed diff and
   actionable automated comments. Push one correction pass when needed; do not
   wait on advisory or superseded feedback.
8. If the same user instruction authorizes merge and release, merge as soon as
   required checks pass. Deploy only when runtime code, infrastructure, or
   packaged application behavior changed. Documentation-only changes do not
   trigger an artificial deployment.
9. Run one focused post-release smoke only when it directly verifies the
   reported runtime behavior. Otherwise leave normal-use visual acceptance to
   the user as the repository Fast lane permits.
10. After merged-main and required release verification, perform the exact
    guarded issue-worktree and branch cleanup required by this repository's
    `AGENTS.md`; preserve the worktree if ownership, cleanliness, ancestry,
    publication, merge, or release evidence is incomplete. Report the outcome,
    exact receipt or failure, rollback point, cleanup result, and compact
    execution ledger. Do not narrate routine command plumbing.

## Stop or escalate

Leave Fastlane only when evidence reveals risk of silent data loss or
corruption, authentication or permission failure, credential exposure,
destructive recovery, recording/transcription loss, crash, or an irreversible
migration. State the escalation once and continue in the repository's
Reliability lane.

Fastlane never authorizes a merge, deployment, destructive mutation, practice
result change, submission, or activity Finish that the user did not authorize.
It never permits duplicate retries after an ambiguous external mutation or
skipping the issue, isolated worktree, branch, focused tests, PR, required CI,
release evidence, or guarded cleanup lifecycle.
