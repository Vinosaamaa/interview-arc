# Owner-Private Behavioral Evidence Domain

The ignored Behavioral Evidence Bundle is the canonical local review source.
D1 stores only display-safe source snapshots and deliberately pending or
explicitly reviewed sanitized records needed across devices. Raw source bytes
remain local and are never copied to R2.

## Trust boundary

- Every table, link, receipt, and query is scoped by the opaque authenticated
  owner ID.
- D1 never receives a local locator, raw résumé/document/source bytes, private
  remote, credential, customer data, employer email, or confidential excerpt.
- Mutation payloads are screened before enqueue because the durable
  specialist-write queue is itself D1 storage.
- All source, evidence, claim, review, and story records are `owner_private`.
  Nothing here publishes Git content or changes a Solution Profile or Role
  Brief.

## Local connector

The controller supports `status`, `refresh`, `project`, and `prepare-sync`.
`status` prints aggregate counts only. `refresh` inspects only `user_owned` or
`user_authorized` sources whose explicit `refreshMode` is `filesystem`,
respects the 5,000-entry directory cap, and stores fingerprints and inspection
state only in the ignored bundle. Filesystem locators name one real canonical
root or exact file. Remote and conversation modes are never passed to
filesystem inspection and report `not_checked`; blocked, unknown, or
authorization-required sources are blocked without inspection.

`prepare-sync` accepts only typed `kind: evidence` candidates. Each candidate
projects exactly one canonical pending evidence record and one or more stable
question links. It strips local locators and `safeLocators`, rejects A3 because
that grade requires an exact D1 transcript attestation, rejects unsafe paths,
URLs, identities, and credentials, and writes the plan only under the ignored
bundle. Source registration is derived separately from display-safe source
metadata. The plan is not proof of persistence.

Before writing a plan, the controller requires every pending evidence record to
have exactly one disposition: a typed D1 candidate or an explicit local-only
exclusion. Status reports covered, excluded, and uncovered counts; exclusions
and their reasons remain local and are never written to the plan or D1.
The controller also mirrors the D1 grade ceiling: owner statements, resume
claims, generated secondary material, and derived inferences cannot be
prepared above `E1`.

## Mutation flow

1. Run `pnpm behavioral:evidence:refresh` only for sources the owner authorized.
   Then run `pnpm behavioral:evidence:prepare-sync` to create the ignored,
   remote-safe `sync/plan.json`.
2. Read `get_behavioral_evidence_registry` before each source write. Call
   `upsert_behavioral_evidence_source` with the exact current revision (or zero
   for a new source), the plan's display-safe snapshot, and an operation ID
   derived from the plan seed plus that expected revision. Source revisions
   are immutable. Exact retries replay; changed retries and stale revisions
   fail closed.
3. Execute only explicit typed candidate writes through
   `upsert_behavioral_evidence_item`, preserving the plan's stable operation,
   evidence, and question-link identities.
4. Poll `get_specialist_write_status` until `saved` or `failed`; a queued MCP
   response is not proof of persistence. Use bounded backoff (250 ms, 500 ms,
   1 s, 2 s, then 4 s) and stop the foreground wait after 10 seconds. If the
   receipt is still nonterminal, report it as pending with its operation ID;
   never invent failure, change the payload, or reserve a replacement ID.
   Bulk foundation sync keeps only one unresolved write at a time. The durable
   worker also holds at most one unexpired specialist-write execution lease;
   scheduled recovery drains the remaining queue serially.
5. Present pending candidates through `query_behavioral_evidence_candidates`
   or the Behavioral Foundation review desk. Only an explicit owner action may
   call `review_behavioral_evidence_candidates`. Every accept, reject, or
   supersede decision carries the exact `reviewRevision`; a batch is atomic.
6. Call `set_behavioral_claim_status` only after every linked evidence item has
   a matching question/relevance link. Supply `expectedRevision: 0` for a new
   claim or the exact current revision for a change, then verify its receipt.
7. After reconnect or transport uncertainty, replay only the byte-identical
   operation and payload. Changed operation retries and immutable-ID rewrites
   fail.

Claims keep immutable identity, text, scope, and strength; a mutable current
checkpoint; an optimistic revision guard; and append-only operation events. A
verified project fact needs accepted E3 support. A verified personal
contribution, ownership decision, or leadership claim needs accepted A3
owner-attested support whose statement exactly matches the same-owner
behavioral user turn and timestamp. Neither code nor Git metadata establishes
A3. Generated or inferred material cannot establish verification or
contradiction, and accepted contrary evidence prevents verification.

Sanitized provenance uses opaque stable references, not labels or locators.
Non-conversation evidence carries a source revision and matching provenance
kind. All evidence linked to one atomic claim shares one `projectKey`.
Candidate review changes only state and the append-only review ledger;
immutable evidence content is never rewritten. Rejected and superseded states
are terminal. Accepted evidence may only be superseded by a same-owner,
same-project pending or accepted replacement.

## Ordinary preflight

After resolving a behavioral `questionId`, call the existing Solution Profile
read and `query_behavioral_evidence`. The evidence read returns deterministic,
owner-scoped slices of accepted supporting evidence, accepted contrary
evidence, current claim status, open gaps, and exact Story Bank candidates.
Pending, rejected, and superseded evidence is excluded. Limits and truncation
are explicit. Never infer evidence or stories from transcripts or generated
coaching.

## Behavioral Foundation aggregate

`get_behavioral_foundation_status` and the authenticated Bank hub consume one
bounded owner-scoped read model over the same source, evidence, claim, and
story tables. It reports display-safe source state and immutable revision
counts, the pending candidate queue, evidence and claim counts, question
coverage, open gaps, last update time, and explicit truncation. It never
returns local paths, source locators, raw documents or code, private remotes,
credentials, or another owner's rows.

Capability fields are truthful product boundaries, not empty-data guesses.
Source registration and candidate review report `available` even when their
collections are empty. The UI reads exact source refresh state; it never
infers availability from old evidence. Résumé curriculum completion and claim
verification remain separate measures.

## Recovery and non-goals

Failed validation receipts are terminal. Retry only failures explicitly marked
retryable and always reuse the original operation ID and payload. Missing or
blocked sources are factual states, not retry authorization. This domain does
not publish evidence, store raw files in R2, create or revise a Loop-owned Role
Brief, infer a personal contribution, or silently promote a candidate into a
claim or Story Bank record.
