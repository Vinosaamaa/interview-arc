---
schemaVersion: 1
id: architecture-review-chatgpt-oauth-practice
revision: 1
type: architecture-review
status: accepted
title: Connect ChatGPT to private practice through managed OAuth
repository: interview-arc
capabilityIds: ["practice-records", "problem-banks"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Real ChatGPT account authorization and plan/model tool availability", "Voice handoff and tool invocation"]
modules: ["practice-records", "problem-banks"]
interfaces: ["chatgpt-practice-mcp"]
seams: ["external-chat-to-private-practice-record"]
adapters: ["cloudflare-access-managed-oauth"]
relatedRecords: ["architecture-review-chatgpt-practice-backfill@1"]
decisions: []
incidents: []
features: []
capabilities: ["connected-private-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Issue #453","url":"https://github.com/Vinosaamaa/interview-arc/issues/453","kind":"issue"},{"label":"PR #455","url":"https://github.com/Vinosaamaa/interview-arc/pull/455","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:453","tests/chatgpt-connector.test.mjs","tests/chatgpt-connector.integration.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 453
pr: 455
release: null
run: null
---
# Connect ChatGPT to private practice through managed OAuth

The manual bank/export handoff did not meet the intended everyday workflow.
ChatGPT's connector could not authenticate against the existing bridge because
it accepted a personal bearer token and supplied no OAuth discovery. The new
practice endpoint uses Cloudflare Access Managed OAuth with a separate audience
and an explicit practice-tool allowlist. The established provider owns discovery,
client registration, PKCE, refresh and revocation rather than a new Arc
authorization server. Existing personal-token clients retain their endpoint.
The separate path-scoped provider application was configured and its public
resource/authorization discovery verified during implementation: OAuth 401 leads
to resource metadata and issuer metadata, both 200, advertising S256 PKCE and
dynamic client registration. ChatGPT connector creation succeeded after fresh
discovery and entered owner sign-in; completion awaits Mac unlock. Account
linking and authenticated production calls remain separate release checks.

## Boundary and alternatives

The origin verifies the Access assertion's RS256 signature, exact configured
issuer/audience and lifetime, then derives the existing opaque browser owner.
Missing provider configuration fails closed. Untrusted identity headers cannot
choose the owner. An SDK subclass removes every tool not explicitly reviewed
for this connection; removed tools are absent from discovery and uncallable.
This reuses current practice handlers without copying timer/finalization logic.

A private GPT API key would require a separate supported GPT configuration and
manual credential setup. A custom OAuth server would duplicate a security
boundary already offered by the hosting provider. Managed OAuth is selected,
with account/provider setup kept distinct from repository correctness. A
path-scoped Access application must prove discovery works without disrupting
the legacy bridge; a separate hostname is the fallback if those paths conflict.

## Practice persistence

Search/fetch return current private questions and progress. New original
questions use insert-only owner-bank persistence with atomic operation receipts,
canonical URL matching and retry identity. They never start activities or
overwrite prior prompts. Historical preview/apply reuses immutable source and
record revision services, returns compact receipts and preserves estimates,
unknown timing and incomplete evidence. Same-question/day conflicts stay pending.

The default Voice workflow prepares selected content in text without starting a
backend timer, then saves available evidence after returning to text. Explicit
backend-timed text work uses the same activity's exchange, code-attempt and
strict finalization handlers plus saved-status readback. No duplicate historical
record or invented pause interval is used to make those workflows appear equal.

Typed exchanges record the server-selected ChatGPT origin; the existing Codex
default remains unchanged. Typed pairing requires matching source identity.
Behavioral evidence and generated coaching remain attributable. Existing
Solution Profile contracts govern reusable answers; no external code execution,
official editorial access or editable Excalidraw capture is implied by an MCP
tool call. Saved Excalidraw scene fragments are readable with exact revision
checks. Generated-reference drawing writes remain outside this slice because
the current asset contract declares user-original attempt roles only.
Historical backfill can prepare a first provisional reusable reference, but
does not promote or revise a current Solution Profile. That needs a separate
explicit imported-record/profile publication contract.
The connector does not expose career administration, destructive
record deletion, task registration or arbitrary uploads.

## Verification and rollout

Focused tests use real SQLite migrations, signed synthetic assertions and real
MCP clients. They check owner isolation, wrong audience/issuer, expired or forged
assertions, forbidden tools, canonical creation/retry, source-preserving saves
and exact receipt readback. An isolated bundled Worker test exercises the actual
dedicated route, existing practice catalog, exact ChatGPT exchanges and a complete
code review with runtime D1 bindings. Strict finalization coverage also verifies
ChatGPT-origin transcript with an immutable record and current Solution link.
Local D1 migrations and content import pass. No real private practice is used in
the tests.

Deploy the tested Worker and migration, configure a separate Managed OAuth Access
application with the existing owner policy, then set the MCP Worker's application
audience and team domain. Verify OAuth discovery/account sign-in, private bank
read, legacy-client compatibility and actual plan/model write availability before
claiming the connection ready. Live tool invocation and the text/Voice transition
require separate account evidence. Rollback removes the endpoint or its provider
configuration; the additive receipt table and existing private records remain.
