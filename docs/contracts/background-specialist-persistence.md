# Background Specialist Persistence Contract

This is the conversation-first bridge for issue #155 plus the durable write
receipt and D1 outbox introduced by issue #158. The application-owned response
hook described by #93 remains future work, but Code Attempt and personal-bank
writes no longer depend on one uninterrupted MCP request.

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
5. Use one truthful interim line when persistence applies:
   `↻ Practice persistence delegated in background`
   This means only that a child received the work. It never means D1/R2 saved.

The complete visible response is the grouping boundary. Before contacting the
child, collect every ordered Voice capture that response actually answers. A
response to one capture delegates the singular resolver; one response to 2–20
captures delegates the batch resolver once, even when later captures arrived
as separate prompts while the assistant turn was active. Separate visible
responses delegate separate work items. Never group by arrival timing alone,
delegate a placeholder response, or reserve a capture before the exact shared
response identity and body exist.

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
- `save_provisional_solution_profile` when a missing profile is needed before
  coaching;
- publication queue reads, publication marking, specialist-task registry,
  deployment, Git, and any coordinator-only operation.

Delivery Coach audio analysis remains its own background workflow. It is not a
reason for the visible specialist parent or this persistence child to inspect
audio or perform R2 work.

## Exact child instruction

The parent supplies, verbatim:

- activity ID, title, and specialty;
- ordered MCP tool names;
- complete tool arguments, including stable capture, user-turn, response-turn,
  Code Attempt, and review identities where applicable;
- the exact visible specialist response body and occurrence time;
- the required final report shape.

The child instruction must say:

```text
You are a persistence-only sub-agent. Execute only the supplied Interview Arc
MCP operations, in order, with the arguments and stable IDs verbatim. For
save_leetcode_code_attempt and upsert_personal_bank_question, supply one stable
operationId per logical write, then call get_specialist_write_status until the
receipt is saved or failed. A queued receipt is not a saved result. Do not
research, coach, rewrite content, infer missing fields, use a browser, submit
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

Before activity, session, workbench, or publication Finish, the specialist
must join every outstanding persistence child for the affected activity and
read the authoritative D1 record. Finish remains blocked when required
evidence is missing or a child failed. Never treat a spawn acknowledgement or
child message as authoritative D1 evidence.

The agent delegation is not durable across agent/process termination, but a
successful Code Attempt or personal-bank enqueue is durable. If the parent or
child disappears before receiving a receipt, reuse the stable operation ID and
exact payload. Once a receipt exists, the Worker executor owns lease recovery
and bounded retry. The application-owned response hook and generalized outbox
remain #93 scope.
