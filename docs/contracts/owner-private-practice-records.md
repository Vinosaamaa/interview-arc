# Owner-Private Practice Records

This contract replaces Git publication as the forward authority for personal
practice. It governs completed LeetCode, Behavioral, and System Design records,
reusable Solution Profiles, private assets, background finalization, Past, and
Solution readers.

## Authority and privacy

- Owner-scoped D1 owns activities, immutable Practice Record and Solution
  Profile revisions, exact links, transcript identity, notes, reviews, timing,
  outcome, interaction mode, references, finalization, and asset metadata.
- Private R2 owns recording and drawing bytes. D1 stores opaque object identity,
  role, revision, MIME type, SHA-256, byte size, alt text, and record link.
- APIs never expose R2 keys, owner identity, credentials, local paths, or raw
  private source locators.
- Git may contain public-safe product code, contracts, question banks, examples,
  and Engineering records. It receives no new personal attempt, transcript,
  review, answer, profile, journal, recording, or diagram.
- Optional ignored local exports are convenience copies, never authority or a
  finalization prerequisite.

The frozen legacy list in
`legacy-owner-private-content-manifest.json` preserves current imported files
byte-for-byte during migration. The validator rejects new or changed private
Git content. Remove a legacy entry only with its file after authenticated D1/R2
parity is proven. Never rewrite Git history.

## Attempt and Solution separation

- **Past** answers what happened in one exact completed `activityId`.
- **Solution** answers what the owner should study now for one stable
  `questionId`.
- A Practice Record stores the exact Solution Profile revision used at
  completion. The primary reader action resolves the newest current revision;
  Technical Audit may open the historical revision.
- A new profile revision never creates a Past row. A record without an exact
  completed activity never becomes an attempt.
- Attempt evidence never moves into a reusable profile merely to fill a gap.

## Finalization ownership

`Pause` leaves an activity open. `Finish` locks its timer and transcript
boundary, then enqueues one idempotent finalization packet.

The visible specialist owns meaning: coaching, transcript scope, factual
summary and review, references, user-selected outcome/timing, verified source
packet, and exact diagram/profile bytes. A bounded authoring child may expand
that verified packet into an exhaustive Solution Profile; it cannot browse,
change evidence, or write durable state.

One mechanical persistence child owns D1/R2 operations. It never authors,
paraphrases, researches, fills gaps, changes results, edits Git, or deploys. It:

1. accepts one stable operation ID and expected revisions;
2. stages and verifies supplied R2 assets;
3. inserts immutable Practice Record/Profile/asset revisions and exact links;
4. compare-and-sets only current pointers;
5. rereads every stored revision, hash, and link;
6. marks the job `saved` only after exact readback.

The visible specialist may return after the complete packet is durably queued.
The product shows `Finalization pending` until readback succeeds; it must not
claim `Finalized`, expose the Past row, or discard a failed job. Exact retries
reuse identical bytes and identities. Changed retries conflict.

## Past reader order

Every specialty uses this order:

1. Title
2. `Open latest solution · Revision N`
3. Pinned Notes, once and only when explicitly saved
4. Timeline
5. Problem Description or Interview Prompt
6. Attempt Summary
7. Conversation
8. Code Attempts, Final Tailored Answer, or Your Design
9. Activity Review
10. collapsed Technical Audit, omitted when empty

Conversation preserves ordered user/specialist turns and exact recording links.
Long code renders only in Code Attempts; its conversation turn uses a pointer.
Administrative persistence, MCP, browser, timer, Git, issue, and deployment
chatter is not practice dialogue.

Technical Audit is progressive disclosure for applicable identities,
revisions, interaction-mode basis, execution evidence, recordings, diagrams,
and Behavioral provenance. It is not a second review or evidence section.

## Mentor records

Mentor is an interaction mode, not an outcome. Finish retains exactly
`solved`, `solved_after_reviewing_approach`, or `failed` and never infers one
from mode.

For each material stage, record `answered`, `partially_answered`,
`no_answer_provided`, or `needs_correction`. Preserve the concise owner response,
separate Mentor guidance, and a final adopted understanding only when the owner
later demonstrated it. Never attribute taught material to the owner.

## Specialty payloads

### LeetCode attempt

Use a self-contained original problem restatement with constraints, examples,
required API, and canonical link. Code Attempts contain exact owner code,
evidence, claims, edge cases, and version-specific review. An empty activity
states `No code attempt was submitted in this activity.` Reference code and
alternative approaches belong only in Solution.

### Behavioral attempt

Render one Final Tailored Answer, its applicable evidence/gaps/contradictions,
and one Activity Review. Put raw provenance in Technical Audit. Never duplicate
an Attempt Record, notes, follow-ups, final answer, or evidence audit.

### System Design attempt

Render Your Design: the requirements, estimates, APIs, model, original drawing,
components, flows, scaling/reliability choices, tradeoffs, and close that the
owner actually produced or later adopted. Missing stages remain explicit with
separate Mentor guidance.

## Solution Profiles

All profiles remain subject to `solution-profiles.md` and its executable depth
gate. LeetCode uses one Reference Implementation panel with Java/Python tabs,
then one collapsible panel per verified Editorial or generated approach.
Behavioral Project Deep Dives and System Design profiles include a dedicated
Questions and Answers section when substantial questions occurred. Restate a
noisy question clearly, retain the corrected specialist answer, and preserve
hidden turn provenance. Fictional material remains visibly labeled.

## System Design drawings

Practice preflight uses the project-pinned local Excalidraw v2 runtime on
`127.0.0.1:3032` and exactly one Playwright Chromium tab. It verifies health and
one browser/CLI round trip, then restores the activity draft. Do not use the
blocked Chrome extension, Computer Use, remote MCP, `npx`, port 3000, or a
second server.

WebSocket state is transport, not storage. Save owner/activity-scoped draft
checkpoints. Finish stores the exact `.excalidraw` scene plus SVG and optional
PNG preview as immutable owner-authored attempt assets. A polished reusable
model is separately attributed Solution material using draw.io source and SVG.
Never replace the original drawing with the model.

Both readers provide alt text, zoom, pan, reset, enlarged view, keyboard and
narrow-screen support, and exact revision attribution.

## Record schemas

`practice-record.schema.json` defines the immutable reader record.
`practice-asset.schema.json` defines drawing metadata. Storage keys additionally
include the verified owner and are never caller-selected. Relational tables may
normalize these documents, but readback must reconstruct the exact schema bytes
without inference.

## Transition and reconciliation

- The existing Git importer may read only the frozen legacy manifest during
  migration; it must never overwrite a newer owner-private revision.
- Past, Journey, and Pacific date grouping move to D1 projections before legacy
  files are removed from current `main`.
- The coordinator reconciles pending/failed jobs and optional exports. Routine
  private finalization requires no journal branch, pull request, deployment, or
  publication marking.
- Public publication remains a separate explicit owner-authorized operation.
