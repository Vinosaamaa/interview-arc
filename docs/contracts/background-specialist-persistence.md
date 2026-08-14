# Background Specialist Persistence Contract

This is the conversation-first bridge for issue #155 plus the durable write
receipt and D1 outbox introduced by issue #158. The application-owned response
hook described by #93 remains future work, but Code Attempt, personal-bank,
and complete specialist-finalization writes no longer depend on one
uninterrupted MCP request.

## Parent specialist path

The useful coaching answer is latency-critical. After resolving the activity
and composing the complete visible answer plus its exact persistence sidecar:

1. Reuse the activity's one persistence sub-agent. Spawn it only when no live
   child exists; otherwise send the exact work as an ordered follow-up task.
2. Use a context-free fork when the runtime supports it. Give the child only
   the exact structured payload and stable identities it needs; do not copy the
   long specialist transcript into the child context.
3. Prefer the fastest low-cost sub-agent model available for this mechanical
   tool work. Correct identity and MCP support are mandatory; cost preference
   never permits a model to infer missing evidence.
4. Return the useful answer immediately after the spawn/message acknowledgement. Do
   not wait for MCP completion, reload D1, poll status, retry a failed write, or
   run Delivery Coach on the parent response path. The persistence child, not
   the visible parent, owns durable write receipt inspection.
5. End every visible parent response with exactly one truthful persistence
   status line. When persistence was delegated but no authoritative receipt is
   available, the final line is
   `↻ Attachment pending · Practice persistence delegated in background`.
   When persistence does not apply, use the owning specialist guide's exact
   not-attached line. Replace the pending state with exact saved, duplicate,
   uncertain, or failed receipt wording only when that state is authoritative.
   The status line is always the final non-empty line and never enters the
   durable transcript or publication.

The bounded authoring-child policy lives in
[`owner-private-practice-records.md`](./owner-private-practice-records.md).
This child receives only the parent's accepted bytes and storage operations.

For Voice grouping, operation selection, membership, and reservation, follow
[`durable-practice-publishing.md`](./durable-practice-publishing.md). Delegate
the resulting singular or batch work item only after the exact visible response
identity and body exist.

Do not contact a persistence child for a response that has no classification
or practice write. One work item may contain the related exchange and Code
Attempt write for the same visible response; never create one child per MCP
call.

Each activity may have at most one live persistence child and eight delegated
work items not yet reported complete. Follow-up tasks preserve visible-response
order. At the eight-item limit, join the child before delegating more work;
never create another child, reorder evidence, or silently drop persistence.
After Finish verification, stop reusing that activity's child.

## MCP routing boundary

These post-response persistence calls are dedicated to the activity child:

- `save_practice_exchange`;
- `resolve_voice_capture_and_save_response`;
- `resolve_voice_captures_and_save_response`;
- `resolve_voice_capture` for an unrelated or uncertain envelope;
- `save_leetcode_code_attempt`;
- `add_practice_note`;
- `save_specialist_finalization` and its required
  `schedule_practice_review` call when finalization is being committed.

The parent keeps these calls because they are authoritative interactive state,
required inputs to the answer, or coordinator/release actions:

- `get_today_practice`, `get_problem_solution_profile`,
  `get_activity_practice_record`, and other reads needed before composing the
  answer;
- timer, session, workbench, planning, result, and focus mutations;
- LeetCode browser/controller commands and submission/verdict reads;
- publication queue reads, publication marking, specialist-task registry,
  deployment, Git, and any coordinator-only operation.

Delivery Coach audio analysis remains its own background workflow. A
persistence child may perform only explicitly supplied asset staging/head/read
operations required by the finalization packet; it never analyzes media.

## Exact child instruction

The parent supplies, verbatim:

- activity ID, title, and specialty;
- ordered MCP tool names;
- complete tool arguments, including stable capture, user-turn, response-turn,
  Code Attempt, and review identities where applicable;
- the exact visible specialist response body and occurrence time;
- the required final report shape.

For a complete Code Attempt review, the parent—not the child—also supplies the
already-composed parity-safe review sidecar. Every structured review string is
present unchanged in the visible response, and every testing-evidence string is
present unchanged in the supplied attempt evidence. The child copies these
fields mechanically; it never derives a summary or substitutes a semantic
paraphrase.

The child instruction must say:

```text
You are a persistence-only sub-agent. Execute only the supplied Interview Arc
MCP operations, in order, with the arguments and stable IDs verbatim. For
save_leetcode_code_attempt and upsert_personal_bank_question, supply one stable
operationId per logical write. For save_specialist_finalization, use the stable
interactionModeClassificationOperationId as the immutable finalization
identity. Then call get_specialist_write_status until every returned receipt is
saved or failed. Make at most five follow-up reads, waiting 1, 2, 4, 8, and 15
seconds before them. If a receipt is still non-terminal after that 30-second
budget, return it as pending with jobId, status, and nextAttemptAt so the parent
or coordinator can resume from the same durable identity later. A queued
receipt is not a saved result. Do not
research, coach, rewrite content, infer missing fields, summarize or paraphrase
a complete Code Attempt review, use a browser, submit
code, mutate timers/results, publish, edit files, or perform Git work. Retry an
enqueue after uncertain transport at most once and only with the exact original
operationId and payload. The Worker owns bounded retries after a receipt exists;
never create a manual retry storm. Use retry_specialist_writes only for a
durable failed receipt whose failure.retryable is true. Return one compact
result listing each operation as saved, duplicate, or failed, with the
privacy-safe error. Do not ask the user.
```

Authentication remains in the MCP connection. Never place credentials or
private task/thread IDs in the child prompt, source, logs, or receipts.

## Durable operation authority

`durable-practice-publishing.md` remains the single source for MCP operation
selection, atomicity, ordering, visible parity, identity conflicts, and
multi-capture behavior. Delegation changes only who executes those operations
and when the parent returns. A child may not reinterpret that contract.

## Completion and failure

The child reports each delegated work item to its parent task when it finishes.
A parent may mention a successful background result on a later turn, but must
surface any unresolved failure at the next natural interaction and always
before Finish/finalization.

Before enqueuing Finish, the specialist joins all earlier writes and reads the
authoritative D1 record. Missing required evidence blocks enqueue. After the
complete finalization packet is durably accepted, the parent may return while
the same child performs exact D1/R2 writes and readback. Until its saved receipt,
the activity is `Finalization pending` and must not appear in Past. Never treat
a spawn acknowledgement or child message as authoritative storage evidence.

The agent delegation is not durable across agent/process termination, but a
successful Code Attempt, personal-bank, or complete-finalization enqueue is
durable. If the parent or child disappears before receiving a receipt, reuse
the stable operation ID and exact payload. Once a receipt exists, the Worker
executor owns lease recovery and bounded retry. The application-owned response
hook remains #93 scope.
