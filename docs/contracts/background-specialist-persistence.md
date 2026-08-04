# Background Specialist Persistence Contract

This is the interim conversation-first bridge for issue #155. The durable
product-owned hook and D1 outbox remain future work under #93.

## Parent specialist path

The useful coaching answer is latency-critical. After resolving the activity
and composing the complete visible answer plus its exact persistence sidecar:

1. Spawn exactly one bounded persistence sub-agent for that visible response.
2. Use a context-free fork when the runtime supports it. Give the child only
   the exact structured payload and stable identities it needs; do not copy the
   long specialist transcript into the child context.
3. Prefer the fastest low-cost sub-agent model available for this mechanical
   tool work. Correct identity and MCP support are mandatory; cost preference
   never permits a model to infer missing evidence.
4. Return the useful answer immediately after the spawn acknowledgement. Do
   not wait for MCP completion, reload D1, poll status, retry a failed write, or
   run Delivery Coach on the parent response path.
5. Use one truthful interim line when persistence applies:
   `↻ Practice persistence delegated in background`
   This means only that a child received the work. It never means D1/R2 saved.

Do not spawn a persistence child for a response that has no classification or
practice write. One child may perform the related exchange and Code Attempt
write for the same visible response; never spawn one child per MCP call.

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
MCP operations, in order, with the arguments and stable IDs verbatim. Do not
research, coach, rewrite content, infer missing fields, use a browser, submit
code, mutate timers/results, publish, edit files, or perform Git work. Retry an
operation at most once and only when its structured failure says retryable;
reuse every original ID. Return one compact result listing each operation as
saved, duplicate, or failed, with the privacy-safe error. Do not ask the user.
```

Authentication remains in the MCP connection. Never place credentials or
private task/thread IDs in the child prompt, source, logs, or receipts.

## Existing operation mapping

- Related typed exchange: `save_practice_exchange`.
- One related Voice envelope: `resolve_voice_capture_and_save_response`.
- Two to twenty consecutive related Voice envelopes answered by one visible
  response: one `resolve_voice_captures_and_save_response` call.
- Unrelated or uncertain Voice envelope: `resolve_voice_capture`.
- Explicit LeetCode attempt boundary: `save_leetcode_code_attempt`, after the
  related visible exchange when its review turn must already exist.

All existing atomicity, ordering, visible-parity, and conflict rules remain in
force. A child may not split a multi-capture answer, invent a review, rewrite a
canonical turn, or convert administrative discussion into practice evidence.

## Completion and failure

The child reports to its parent task when it finishes. A parent may mention a
successful background result on a later turn, but must surface any unresolved
failure at the next natural interaction and always before Finish/finalization.

Before activity, session, workbench, or publication Finish, the specialist
must join every outstanding persistence child for the affected activity and
read the authoritative D1 record. Finish remains blocked when required
evidence is missing or a child failed. Never treat a spawn acknowledgement or
child message as authoritative D1 evidence.

This mechanism is intentionally not durable across agent/process termination.
If the parent or child disappears, use stable IDs to perform the existing
idempotent recovery operation. Do not claim background execution is a queue;
#93 owns that replacement.
