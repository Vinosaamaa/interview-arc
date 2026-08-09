# Postmortem: Unverified reconstruction was reported as prior task content

- **Date:** 2026-08-09
- **Status:** Remediation in review
- **Verification lane:** Reliability
- **Issue:** [interview-arc#203](https://github.com/Vinosaamaa/interview-arc/issues/203)
- **PR:** [interview-arc#204](https://github.com/Vinosaamaa/interview-arc/pull/204)

## Summary

In a long-lived task, the user asked for the exact skill recommendations that
had been given earlier. The original response was no longer present in the
agent's currently loaded context, but it remained available in the stored task
transcript. The agent did not retrieve that transcript. It supplied a
plausible but different reconstruction and then incorrectly said the original
response had not been durably recorded.

The user detected the mismatch. A later transcript query recovered the exact
original response and confirmed that it had been stored. No practice activity,
D1 record, publication artifact, or source file was mutated by the incorrect
answer.

## Impact

- The user received incorrect attribution about what the agent had previously
  recommended.
- The answer incorrectly described durable task history as missing.
- The user had to challenge the response before authoritative retrieval
  occurred.
- Continuing from the reconstruction could have changed the planned skill
  design using references the user had not actually approved.
- The incident reduced trust in long-lived-task continuity even though the
  authoritative transcript remained intact.

## Detection

The user recognized that both the reconstructed shortlist and the storage
claim conflicted with the earlier conversation. After that challenge, the
agent queried the stored task transcript, found the original response, and
reported the correction.

## Timeline

1. The original skill-research response was written to the task transcript.
2. Later context compaction left the exact response outside the agent's loaded
   context while preserving it in stored history.
3. The user asked the agent to recall the earlier recommendations.
4. The agent answered from semantic reconstruction rather than retrieving the
   stored transcript.
5. The user rejected the reconstruction and the claim that the response was
   not durably recorded.
6. The agent queried authoritative task history, recovered the exact response,
   and corrected the record.
7. Issue #203 was opened to add a repository-wide retrieval gate.

## Relevant context boundary

```mermaid
flowchart LR
    Loaded[Currently loaded or compacted context]
    Stored[Stored task transcript or named durable source]
    Gate{Is material exact prior content visible?}
    Verify[Retrieve authoritative history]
    Answer[Report verified prior content]
    Unknown[State retrieval limitation and mark reconstruction unverified]

    Loaded --> Gate
    Gate -->|Yes| Answer
    Gate -->|No| Verify
    Stored --> Verify
    Verify -->|Found| Answer
    Verify -->|Unavailable| Unknown
```

Loaded context is a working input, not proof that older task content was never
stored. Absence from that input must not be upgraded into a storage claim.

## Root cause

The immediate cause was an unverified reconstruction presented as historical
fact. The systemic cause was the absence of a repository-wide instruction
requiring agents to distinguish loaded context from authoritative task history
and to retrieve the latter before making material exact claims about prior
content or its storage status.

## Contributing factors

- The task was long-lived and had undergone context compaction.
- Related contemporary skill research made alternative recommendations feel
  plausible even though they were not the original shortlist.
- The phrase "do you remember" was treated as an invitation to answer from
  semantic memory rather than a request for historical verification.
- No shared guide explicitly prohibited claiming that content was missing or
  unsaved before checking authoritative storage.

## Failed approaches

- Reconstructing the likely answer from current context produced a coherent
  but historically false response.
- Describing the response as not durably recorded converted an unverified
  retrieval assumption into a false storage claim.
- Correcting only after the user objected put the verification burden on the
  user.

## Resolution

The repository-root `AGENTS.md` now requires every Interview Arc agent to:

1. distinguish loaded context from authoritative task history;
2. retrieve available authoritative history when material exact prior content
   is not visible;
3. avoid presenting plausible reconstructions as the prior content;
4. avoid claims that content was absent, unsaved, or not durable without first
   checking the relevant source; and
5. state the retrieval limitation and label any reconstruction unverified when
   authoritative history cannot be accessed.

The shared rule is intentionally not duplicated in specialist guides. Codex
loads repository instructions from the root toward the working directory, so
the root scope reaches coordinator, coding, system-design, behavioral, and
future nested agents. Already-running sessions still need an instruction
reload or restart because the instruction chain is constructed at run or
session start.

## Verification

- Confirm the rule is present in the root guide and absent from nested
  specialist guides.
- Run Markdown and whitespace checks for the changed files.
- Confirm the pull request is based only on current `origin/main` and contains
  no unrelated work.
- After merge, have each long-lived task reload repository instructions before
  relying on the new rule.

## Prevention and follow-up

| Action | Owner | Tracking | Status |
| --- | --- | --- | --- |
| Add repository-wide authoritative-history retrieval gate | Interview Arc | #203 | Implemented in branch |
| Preserve private task identifiers and transcript paths outside public artifacts | Interview Arc | #203 | Implemented |
| Reload existing long-lived tasks after merge | Task coordinator | #203 | Pending merge |
| Consider automated transcript lookup only if instruction-level prevention proves insufficient | Interview Arc | Future evidence | Not currently planned |

## Known limitations

- The rule cannot retrieve history that is genuinely unavailable to the active
  environment.
- It does not add a transcript-search product feature or change D1/MCP.
- It does not make every paraphrase require byte-for-byte lookup; the gate is
  for material exact claims about prior content, decisions, or storage state.
- Existing sessions do not receive a live broadcast of changed instruction
  files and must reload or restart.
