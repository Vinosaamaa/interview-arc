# Site-wide Interview Arc AI assistant

Owning issue: [#418](https://github.com/Vinosaamaa/interview-arc/issues/418).

This is a horizontal website capability. It is not “AI for Loops.” It lives in the shared application shell and can work across Today, Banks, practice, Learn, Review, Loops, and explicitly selected private evidence as each domain exposes a reviewed adapter.

## User experience

**Ask Interview Arc** is reachable from every authenticated workspace. Opening it shows:

- the current workspace and page;
- the exact records currently selected as context;
- controls to add/remove context;
- whether the request is read-only or may propose an action;
- provider/retention/cost disclosure when private context or an expensive operation is involved;
- conversation retention and deletion controls.

The assistant never treats everything visible to the owner as automatically eligible context. Selection is explicit and inspectable.

## Two operation classes

### Read and explain

The assistant retrieves selected owner-authorized records through read adapters, answers with citations, and distinguishes:

- verified source facts;
- model inference;
- unknown or conflicting evidence.

Read mode has no mutation tools.

### Propose an action

The assistant may emit a versioned proposal for one allowlisted command. Deterministic code resolves references, validates the schema, records source attribution/unknowns/warnings, and freezes an immutable proposal revision and digest. The owner edits, approves, or rejects it. Approval invokes the owning domain command, not a generic AI write path.

```text
owner request + selected context
              │
              ▼
context broker ─▶ provider gateway ─▶ grounded answer OR typed proposal
                                             │
                                      no mutation authority
                                             ▼
                                   owner reviews exact change
                                             │ approve digest
                                             ▼
                                  owning deterministic command
```

## Shared assistant modules

| Module | Responsibility |
| --- | --- |
| Assistant shell | Persistent cross-workspace composer, context chips, history, state and recovery UI |
| Context broker | Owner-authorized retrieval, minimization, redaction policy, citations, size budgeting |
| Provider gateway | Hosted secrets, model routing, structured output, cancellation, timeout, retention/cost policy |
| Conversation store | Owner-scoped conversations/messages and deletion/export state |
| Proposal module | Command allowlist, versioned schemas, canonical payload, digest, expiry, provenance, warnings |
| Approval gate | Exact owner/revision/digest check, warning acknowledgement, replay and concurrency checks |
| Domain adapters | Narrow read and command interfaces owned by Today, Banks, practice, Learn, Review, Loops, evidence |
| Safe observability | Provider/result/latency/token/count events without content or private IDs |

## Context model

Context is a list of typed references, not a large opaque prompt:

```json
{
  "schemaVersion": 1,
  "workspace": "banks",
  "route": "/interview/banks",
  "selected": [
    {"adapter": "personal-bank-question", "reference": "opaque_reference", "revision": 3}
  ],
  "intent": "read"
}
```

The server resolves every reference under the verified owner. The browser cannot request a different owner, raw table, arbitrary R2 key, arbitrary file path, or unregistered adapter. Context receipts record adapter, revision, and digest without copying private content into public logs.

## Action proposal model

Conceptual owner-private D1 entities:

| Entity | Purpose |
| --- | --- |
| `assistant_conversations` | Owner-scoped shell history and retention state |
| `assistant_messages` | Private request/response bodies or private body locators |
| `assistant_context_receipts` | Exact selected adapters/revisions/digests used by a response |
| `assistant_proposals` | Immutable command type/version/payload/digest/status/expiry |
| `assistant_proposal_events` | Proposed, revised, approved, applied, rejected, expired, conflicted events |
| `domain_command_receipts` | Idempotent authoritative result returned by the owning command |

Approval is single-use. Editing creates a new proposal revision/digest. An exact retry returns the existing domain receipt. A stale domain revision produces a conflict and never silently reapplies against new state.

## Domain adapter contract

Every domain joins independently with:

- an allowlisted read schema and citation model;
- an optional command schema only after a deterministic command exists;
- context-size and sensitivity classification;
- owner-authorization function;
- provenance and revision requirements;
- user-facing review language;
- idempotency/concurrency/failure contract;
- retention and provider eligibility;
- injection, cross-owner, outage, and E2E tests.

Candidate order:

1. Learn and published content: read/explain with citations, no private mutation.
2. Today and Banks: read plus proposals over existing deterministic commands.
3. Practice and Review: selected owner-private attempts with scoped summaries/proposals.
4. Loops: only after #417 exposes the deterministic command.
5. Interview evidence: only after #415 and explicit private-provider authorization.

The first action release must integrate at least two distinct domains so the shared platform is proven rather than designed around one Loop use case.

## Prompt-injection and tool safety

- Job descriptions, URLs, published content, transcripts, code, and model responses are untrusted data.
- Provider calls have no D1, R2, SQL, MCP mutation, GitHub, filesystem, or deployment credentials.
- The model cannot name a new adapter or command; server allowlists resolve enums and references.
- Retrieved content cannot change system policy, context limits, retention, tool schemas, or authorization.
- Unsupported or ambiguous intent produces guidance, never guessed execution.
- Destructive actions require a separate deterministic confirmation showing exact scope; they are never bundled into a conversational approval.

## Privacy and provider policy

- The owner sees which selected records will leave Interview Arc before dispatch.
- Sensitive adapters can be local-only or provider-disabled until a reviewed policy exists.
- Use minimum necessary content, configurable zero/limited retention, no provider training, region controls when required, and explicit disclosure.
- Prompts/responses are owner-private. They do not enter Git, issues, screenshots, public logs, Engineering narrative, or generic analytics.
- Owner controls conversation deletion/export and any derived proposal retention.

## Failure and cost behavior

- Manual product UI remains available during provider failure.
- Streaming answers expose cancel/retry without duplicating proposals.
- Timeouts and provider errors use stable safe codes.
- Per-owner request, token, and cost budgets have visible limits and a circuit breaker.
- Context-size estimates and expensive processing estimates appear before dispatch where meaningful.
- Proposal apply failures preserve the proposal and show typed conflict recovery; they do not ask the model to improvise a fix with extra authority.

## Verification matrix

| Boundary | Required cases |
| --- | --- |
| Context | Selection/removal, stale revision, missing record, size cap, sensitivity denial, cross-owner negative |
| Grounding | Exact citations, conflicting facts, unknowns, no-source answer, revision provenance |
| Injection | Instructions in every supported content type cannot expand context, commands, or authority |
| Proposal | Malformed/truncated schema, invented command/ref, edit/new digest, expiry, replay, stale domain state |
| Provider | Timeout, cancellation, partial stream, outage, rate limit, retention-policy mismatch, budget trip |
| Privacy | Captured requests/logs/public artifacts contain no private content or identifiers |
| UX | Persistent global shell, workspace changes, keyboard, screen reader, mobile, zoom, reduced motion |
| Cross-domain | At least two distinct adapters prove the assistant is not Loop-owned |

## Rollout

1. Shared shell plus read-only published-content grounding.
2. Owner-scoped conversation/history controls.
3. Second read adapter from a distinct workspace.
4. Proposal/approval infrastructure with one existing deterministic command.
5. Second command domain.
6. Private practice/evidence adapters only after separate privacy and provider decisions.
7. Owner-only production flags, sanitized canary, cost/retention verification, then gradual enablement.

## Explicit non-goals

- A Loop-only assistant.
- Making AI necessary for any deterministic website feature.
- A general autonomous agent with arbitrary tools.
- Direct model writes, SQL, MCP mutation, GitHub work, deployment, or publication.
- Automatically including all owner data or private evidence in context.
- Automatically uploading, transcribing, analyzing, or deleting interview evidence.
