# Owner-Private Behavioral Evidence Domain

This contract is the first remote tracer bullet of issue #201. The ignored
Behavioral Evidence Bundle remains the canonical local review source; D1 stores
only accepted or deliberately pending sanitized records needed across devices.

## Trust boundary

- Every table, link, receipt, and query is scoped by the opaque authenticated
  owner ID.
- D1 never receives a local locator, raw résumé/document/source bytes, private
  remote, credential, customer data, employer email, or confidential excerpt.
- The mutation payload is screened before enqueue because the durable
  specialist-write queue is itself D1 storage.
- All evidence and claims in this slice are `owner_private`. Nothing here
  publishes Git content or changes a Solution Profile.

## Mutation flow

1. Compose one sanitized item from canonical bundle fields.
2. Call `upsert_behavioral_evidence_item` with one stable `operationId`, stable
   evidence identity, and one question relevance link.
3. Poll `get_specialist_write_status` until `saved` or `failed`; a queued MCP
   response is not proof of persistence.
4. Call `set_behavioral_claim_status` only after every linked evidence item has
   a matching question/relevance link. Supply `expectedRevision: 0` when
   creating a claim or the exact revision returned by preflight when changing
   it, then poll the separate stable receipt.
5. After reconnect or transport uncertainty, replay only the byte-identical
   operation/payload. Changed operation retries and immutable-ID rewrites fail.

Claims keep immutable identity/text/scope/strength, a mutable current
checkpoint, an optimistic revision guard, and append-only operation events.
Every operation has a domain receipt, so reclaiming an interrupted queue job
cannot overwrite a newer checkpoint. A verified project fact needs accepted E3
support. A verified personal contribution, ownership decision, or leadership
claim needs accepted A3 owner-attested support whose statement exactly matches
the same-owner behavioral user turn and timestamp. Neither code nor Git
metadata alone establishes A3. Generated or inferred material cannot establish
a verification or contradiction, and accepted contrary evidence prevents a
claim from being marked verified.

Sanitized provenance uses opaque stable references, not labels or locators.
Non-conversation evidence carries a source revision and a provenance kind that
matches its origin. Candidate review and effective supersession remain later
#201 slices; this mutation never rewrites an accepted item or silently hides
its predecessor.

## Ordinary preflight

After resolving a behavioral `questionId`, call the existing Solution Profile
read and `query_behavioral_evidence`. The evidence read returns deterministic,
owner-scoped slices of accepted supporting evidence, accepted contrary
evidence, current claim status, and open gaps. Pending, rejected, and
superseded evidence is excluded. Limits and truncation are explicit. Story
candidates are an empty list until their later #201 domain slice; never infer
them from transcripts or generated coaching.

## Recovery and non-goals

Failed validation receipts are terminal. Retry only failures explicitly marked
retryable and always reuse the original operation ID/payload. A missing local
source, candidate review, source refresh, story persistence, Foundation UI,
Behavioral Attempt reader, profile revision, publication, merge, and deployment
remain outside this slice.
