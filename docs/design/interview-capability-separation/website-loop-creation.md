# Website-native Loop creation and management

Owning issue: [#417](https://github.com/Vinosaamaa/interview-arc/issues/417).

This feature answers one concrete question: how does the owner add a Loop without talking to Codex or a CLI? It is a deterministic website operation and does not require AI.

## How to add a Loop today

Use the long-lived `Interview Arc — Loop Recorder` task. Supply explicit facts:

- company and role;
- job-description text or source URL;
- location and opened date when known;
- known interview stages, dates, and statuses;
- every uncertainty that must remain unknown rather than inferred.

The recorder creates the Loop and Role Brief revision 1 together under its dedicated authorization. Later changes use explicit revision operations.

## Target website flow

1. Choose **Add Loop** from the Loops header or empty state.
2. Enter company and role.
3. Paste job-description text and/or provide a source URL.
4. Enter location, opened date, and known stages.
5. Mark uncertain facts unknown.
6. Review the exact initial Loop, Role Brief, stages, source provenance, and warnings.
7. Choose **Create Loop**.
8. Receive one stable command receipt and open the new Loop.

The form preserves values on validation or concurrency failure. Error messages identify the field and recovery action.

## Domain command boundary

```text
Manual website form ─┐
Loop Recorder ───────┼─▶ create_loop command ─▶ Loop + Role Brief revision 1
Future AI proposal ──┘        │
                              └▶ receipt / typed conflict
```

The website, Loop Recorder, and any later assistant adapter share the same domain command. They may have different authorization adapters and input preparation, but business invariants cannot drift.

## Proposed interface

```http
POST /api/loops
Idempotency-Key: <opaque client-generated key>
If-Match: <optional collection/version token>
Content-Type: application/json
```

```json
{
  "schemaVersion": 1,
  "company": "Example Company",
  "role": "Software Engineer",
  "location": null,
  "openedOn": null,
  "jobDescription": {
    "text": "…",
    "sourceUrl": "https://example.com/job"
  },
  "stages": [],
  "unknowns": ["location", "openedOn", "stages"]
}
```

The server derives owner identity from Cloudflare Access. The response contains public-safe domain references, the created Role Brief revision, and an idempotent receipt; it does not expose owner IDs or internal D1 identifiers unnecessarily.

## Atomicity and idempotency

- Validate schema and canonical domain invariants before opening the transaction.
- Create Loop, Role Brief revision 1, initial stages, source link, and command receipt in one transaction.
- On conflict, commit none of them.
- Bind the idempotency key to owner, command type/version, and canonical request digest.
- An exact retry returns the existing receipt.
- Reusing a key for a different digest returns a typed idempotency conflict.
- Concurrent duplicates resolve deterministically through unique constraints and receipt lookup.

## Authorization migration

The current Loop Recorder-exclusive mutation contract must be revised deliberately:

- retain the recorder's dedicated adapter authorization;
- add an owner-confirmed website adapter authorized by verified Access identity;
- move reusable validation and transaction logic into a shared Loop command module;
- prevent either adapter from impersonating the other;
- keep direct model, client-supplied owner, SQL, and unreviewed MCP mutation paths unavailable.

## Website states

- Empty: explain what a Loop represents and offer **Add Loop**.
- Draft: autosave only in owner-private browser/server draft state if explicitly designed; never create partial domain state.
- Validation error: focus and describe the first field while preserving all input.
- Conflict: explain which current fact changed and offer reload/review.
- Applying: disable duplicate submission while allowing safe navigation rules.
- Success: show receipt, created Loop, Role Brief revision, and next actions.
- Provider unavailable: irrelevant; no provider call exists in this feature.

## Verification

| Layer | Required cases |
| --- | --- |
| API | Required/optional fields, unknowns, provenance, malformed/oversized input |
| Command | Authorization, exact retry, changed-digest retry, atomic rollback, concurrency |
| Domain | Loop/Role Brief/stage invariants and revision 1 provenance |
| Security | Cross-owner substitution, CSRF, request owner field rejection, source URL safety |
| E2E | Empty-state create, header create, validation recovery, conflict recovery, success navigation |
| Accessibility | Keyboard, screen reader, focus/error summary, mobile, zoom, reduced motion |
| Compatibility | Existing Loop Recorder behavior and shared invariants |

## Relationship to AI

Issue #418 may later add a website-wide assistant adapter that proposes values for `create_loop`. That proposal must be owner-reviewed and then call this same command. The Loop feature neither embeds nor owns the assistant, and it remains complete when AI is disabled.
