# Interview Arc Live HTTP v1 Contract

Status: locked v1 contract for Interview Arc Live rooms. This document is the
shared server/client boundary for `/live/v1`; incompatible changes require a
new `/live/v2` surface.

## Authority and authentication

D1 is authoritative for the open workbench, focus, timers, results, transcript
pairs, receipts, and Live metadata. Provider threads, event delivery, a Live
manifest, and client caches are not authority.

Every request uses an Interview Arc personal integration token:

```http
Authorization: Bearer <integration-token>
```

The Worker hashes the token and resolves it through the existing revocable
`integration_tokens` store. The resolved opaque owner ID is the only owner
scope used for D1 and R2 access. v1 ignores and never accepts owner IDs in a
header, path, query, or body. A missing, malformed, unknown, or revoked token
returns:

```json
{
  "error": "Unauthorized",
  "code": "unauthorized",
  "retryable": false
}
```

with HTTP `401` and `WWW-Authenticate: Bearer realm="Interview Arc"`.
Browser cookies and copied Cloudflare Access JWTs are not Live credentials.

All JSON responses use `Cache-Control: no-store`. Private clip responses use
`Cache-Control: private, no-store`.

## Common scalar schemas

The schemas below use TypeScript notation only to describe JSON values.

```ts
type StableId = string;       // ^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$
type HolderId = string;       // lowercase/uppercase UUID v4 accepted
type EpochMilliseconds = number; // non-negative safe integer
type Revision = number;       // non-negative safe integer
type ProtocolVersion = 1;

type Result =
  | "solved"
  | "solved_after_reviewing_approach"
  | "failed";

type Timer = {
  accumulatedSeconds: number;
  startedAt: EpochMilliseconds | null;
  runningSince: EpochMilliseconds | null;
  completed: boolean;
  completedAt: EpochMilliseconds | null;
  revision: Revision;
};

type ErrorBody = {
  error: string;
  code: string;
  retryable: boolean;
  // A code may add the explicitly documented safe metadata below.
};
```

Unknown request and response fields must be ignored. Clients must not infer
authority from an unknown field. Stable IDs are opaque and case-sensitive.
Timestamps are server epoch milliseconds. JSON numbers used as IDs are not
accepted. JSON mutation bodies are limited to 1,048,576 encoded bytes and an
oversized body returns `400 invalid_request` before deserialization.

## Read projections

### `GET /live/v1/today`

Returns the resolved owner's latest open workbench. Completed activities are
not included in `activities`; clients may resume a completed activity through
its activity endpoint while its open workbench remains available.

```ts
type TodayProjection = {
  protocolVersion: 1;
  serverTime: EpochMilliseconds;
  ownerRevision: Revision;
  workbench: null | {
    id: StableId;
    revision: Revision; // authoritative workbench revision
    openedPacificDate: string; // YYYY-MM-DD
    openedAt: EpochMilliseconds;
  };
  focus: {
    activityId: StableId | null;
    sessionId: StableId | null;
    focusedAt: EpochMilliseconds | null;
  };
  sessions: Array<{
    id: StableId;
    label: string;
    activityIds: StableId[];
    allocatedSeconds: number | null;
    revision: Revision;
    timer: Timer | null;
  }>;
  activities: ActivitySummary[];
};

type ActivitySummary = {
  id: StableId;
  questionId: StableId | null;
  date: string;
  source: string | null;
  type: "leetcode" | "system_design" | "behavioral";
  title: string;
  prompt: string | null;
  allocatedSeconds: number;
  sessionId: StableId | null;
  // "running" means started and unfinished; inspect runningSince to
  // distinguish an actively ticking timer from a paused timer.
  lifecycle: "planned" | "running" | "completed";
  revision: Revision;
  timer: Timer | null;
  result: { value: Result | null; revision: Revision };
};
```

When there is no open workbench, `workbench` is `null`, focus is empty, and
the session/activity arrays are empty.

### `GET /live/v1/activities/{activityId}`

Returns `404 activity_not_found` unless the ID is an owner-visible System
Design activity in the current open workbench.

```ts
type ActivityProjection = {
  protocolVersion: 1;
  serverTime: EpochMilliseconds;
  ownerRevision: Revision;
  workbench: NonNullable<TodayProjection["workbench"]>;
  focus: TodayProjection["focus"];
  session: TodayProjection["sessions"][number] | null;
  activity: ActivitySummary & { textEvidenceSatisfied: boolean };
  lease: {
    active: boolean;
    holderPresent: boolean;
    expiresAt: EpochMilliseconds | null;
  };
  pairs: LivePair[];
  clips: LiveClip[];
};

type CandidateEvidenceStatus =
  | "verified"
  | "best_available"
  | "possible_contamination";

type LivePair = {
  pairId: StableId;
  candidate: {
    turnId: StableId;
    text: string;
    evidenceStatus: CandidateEvidenceStatus;
    evidenceConfirmedAt: EpochMilliseconds | null;
    evidenceSatisfied: boolean;
    occurredAt: EpochMilliseconds;
    sequence: number;
  };
  interviewer: {
    turnId: StableId;
    displayMarkdown: string;
    spokenText: string;
    occurredAt: EpochMilliseconds;
    sequence: number;
  };
  clipId: StableId | null;
  committedAt: EpochMilliseconds;
};

type LiveClip = {
  clipId: StableId;
  candidateTurnId: StableId;
  pairId: StableId | null;
  mimeType: "audio/mp4" | "audio/mpeg" | "audio/wav" | "audio/webm" | "audio/x-m4a";
  byteSize: number;
  sha256: string; // 64 lowercase hexadecimal characters
  status: "staged" | "uploading" | "available" | "failed" | "abandoned";
  failureCode: string | null;
  createdAt: EpochMilliseconds;
  updatedAt: EpochMilliseconds;
};
```

Pairs are ordered by candidate canonical sequence. The candidate and
interviewer sequences are adjacent. An incomplete pair is omitted rather than
partially projected. The projection never includes provider state, a partial
stream, credentials, R2 object keys, object URLs, or upload-writer identity.
The lease summary deliberately hides holder/session IDs and fencing tokens.

Read projections are transactionally consistent D1 snapshots. `serverTime`
describes response construction time; clients use it to correct local timer
clock skew.

## Immutable operations and receipts

Every mutation has a caller-generated `operationId`. The server hashes a
canonical request containing only v1 fields. An exact retry of the same
operation and digest returns HTTP `200`, the original immutable receipt, and
`duplicate: true`. Reusing the operation ID with any changed normalized field
returns HTTP `409 idempotency_conflict`, `retryable: false`, and no mutation.

```ts
type MutationReceipt = {
  protocolVersion: 1;
  operationId: StableId;
  activityId: StableId;
  operation: string;
  committedAt: EpochMilliseconds;
  result: Record<string, unknown>;
};

type MutationResponse = {
  protocolVersion: 1;
  duplicate: boolean;
  receipt: MutationReceipt;
  activity: ActivityProjection;
  // Endpoint-specific fields described below may be present.
};
```

Receipt insertion, D1 state changes, lease compare-and-swap, and owner-revision
advance share one D1 transaction. A missing HTTP response is ambiguous, not a
failure signal. Recover it with:

### `GET /live/v1/activities/{activityId}/receipts/{operationId}`

```json
{
  "protocolVersion": 1,
  "receipt": { "protocolVersion": 1, "operationId": "...", "activityId": "...", "operation": "...", "committedAt": 0, "result": {} }
}
```

Only the resolved owner and exact activity scope can read a receipt. An absent
receipt returns `404 receipt_not_found`.

## Activity writer lease

Live generates one random UUID v4 `holderId` per installation and a fresh
opaque `holderSessionId` per room launch. Neither value may contain a device
name or user data. The server uses a 90-second TTL. A writable room renews on a
30-second client cadence.

### `POST /live/v1/activities/{activityId}/lease/acquire`

```ts
type AcquireLeaseRequest = {
  operationId: StableId;
  holderId: HolderId;
  holderSessionId: StableId;
};
```

A grant returns the endpoint's mutation response plus:

```json
{
  "lease": {
    "fencingToken": 1,
    "expiresAt": 1900000090000,
    "holderSessionId": "room-launch-id"
  }
}
```

The first grant and each post-expiry takeover increment the persistent fencing
token. Reacquiring with the same holder/session reads the existing token and
expiry; it does not extend the lease. A different installation or a new room
session cannot steal an unexpired lease. It receives `409 lease_held`,
`retryable: false`, with only `holderPresent: true` and `expiresAt`.

### `POST .../lease/renew`

### `POST .../lease/release`

```ts
type FencedLeaseRequest = AcquireLeaseRequest & {
  fencingToken: number; // positive safe integer
};
```

Renew retains the fence and moves expiry to server time plus 90 seconds.
Release clears the active holder/session/expiry but retains the persistent
fencing counter. Only an exact receipt replay makes release idempotent after
the lease is gone. A stale, expired, or foreign lease receives
`409 lease_conflict`, `retryable: true`.

Every write below carries `operationId`, `holderId`, `holderSessionId`, and
`fencingToken`. The server checks all four activity/lease dimensions plus
unexpired server time inside the state-changing D1 transaction. v1 does not
fence existing browser, specialist, or Voice writers. Live releases before a
cross-surface handoff and rereads before reacquiring.

## Immutable candidate/interviewer pairs

### `POST /live/v1/activities/{activityId}/turn-pairs`

```ts
type CommitPairRequest = FencedLeaseRequest & {
  pairId: StableId;
  candidate: {
    turnId: StableId;
    text: string; // 1..100,000 UTF-16 code units after nonempty trim
    evidenceStatus: CandidateEvidenceStatus;
    occurredAt: EpochMilliseconds;
  };
  interviewer: {
    turnId: StableId;
    displayMarkdown: string; // 1..100,000, nonempty after trim
    spokenText: string;      // 1..20,000, nonempty after trim
    occurredAt: EpochMilliseconds;
  };
  clipId?: StableId;
};
```

One transaction reserves cross-role turn identities and adjacent sequence
slots, appends the candidate as `user/audio_transcript`, appends the
interviewer as `specialist/codex`, associates an already staged compatible
clip by stable candidate-turn identity (with optional `clipId` acting as an
additional exact assertion), writes the pair, and stores the receipt. A
collision or changed immutable identity is `409 idempotency_conflict`.

`verified` and nonempty `best_available` satisfy text evidence.
`possible_contamination` is retained but does not satisfy Finish until the
confirmation command below. `no_candidate` is not a persistent pair status:
a request using it returns `422 candidate_evidence_required` without writing
either turn. Clients retain local playable recovery material instead.

## Optional private clips

Clips are never authority for accepted text and are not Voice capture intents.
A failed or absent Live clip does not block Finish. v1 has no presigned or
public object URL.

### `POST /live/v1/activities/{activityId}/clips/stage`

```ts
type StageClipRequest = FencedLeaseRequest & {
  clipId: StableId;
  candidateTurnId: StableId;
  mimeType: LiveClip["mimeType"];
  byteSize: number; // integer, 1..104,857,600 bytes
  sha256: string;   // exact expected lowercase SHA-256
};
```

Stage reserves immutable metadata only and returns the current clip. It may
run before or after pair commit; the candidate-turn association links them.
Only one clip identity may reserve a candidate turn. Concurrent changed
reservations cannot both commit.

### `PUT /live/v1/activities/{activityId}/clips/{clipId}/content`

The request body is the audio byte stream. Metadata and fencing use headers:

```http
Content-Type: audio/mp4
Content-Length: 12345
X-Content-SHA256: <64 lowercase hex>
X-Live-Operation-Id: <stable-id>
X-Live-Holder-Id: <uuid-v4>
X-Live-Holder-Session-Id: <stable-id>
X-Live-Fencing-Token: <positive integer>
```

The headers must exactly match the staged metadata. For a nonavailable clip,
the Worker claims the D1 row as `uploading`; it then streams to private R2 with
checksum enforcement and
rechecks the immutable association and current lease fence in the D1
finalization transaction. Only then does status become `available` and a
receipt become visible. A post-expiry holder may take over an unfinished claim;
the former fence cannot finalize it. Upload failure records `failed` when the
same fence is still current and preserves the pair. The exact operation can
retry from `failed`. A fresh operation against an already available clip still
consumes and validates the supplied stream before its receipt commits, while
the prior available metadata/object remains authoritative on validation
failure.

Checksum/size failures return `422 clip_checksum_mismatch` or
`clip_size_mismatch`, retryable `true`. A competing upload from the same writer
under another operation returns `409 clip_upload_in_progress`, retryable
`true`. `abandoned` is terminal metadata reserved for explicit cleanup; v1 has
no implicit abandonment transition.

### `GET /live/v1/activities/{activityId}/clips/{clipId}/content`

Streams only an owner-scoped `available` object. It supports one RFC 7233
single byte range (`Range: bytes=start-end`, `start-`, or `-suffix`) and returns
`206` with `Content-Range`; an unsatisfiable or malformed range receives `416`.
An absent, non-available, wrong-owner, or missing R2 object is
`404 clip_not_found`. No redirect or storage URL is returned.

## Fenced commands

### `POST /live/v1/activities/{activityId}/commands`

Every command starts with:

```ts
type CommandBase = FencedLeaseRequest & {
  command:
    | "start"
    | "pause"
    | "finish"
    | "set_result"
    | "clear_result"
    | "confirm_candidate_evidence"
    | "finish-next";
  expectedWorkbenchRevision: Revision;
};
```

Command-specific schemas are:

```ts
type StartOrPause = CommandBase & {
  command: "start" | "pause";
  expectedTimerRevision: Revision;
};

type SetResult = CommandBase & {
  command: "set_result";
  expectedResultRevision: Revision;
  result: Result;
};

type ClearResult = CommandBase & {
  command: "clear_result";
  expectedResultRevision: Revision;
};

type ConfirmCandidateEvidence = CommandBase & {
  command: "confirm_candidate_evidence";
  pairId: StableId;
};

type Finish = CommandBase & {
  command: "finish";
  expectedTimerRevision: Revision;
  expectedResultRevision: Revision;
};

type FinishNext = CommandBase & {
  command: "finish-next";
  expectedTimerRevision: Revision;
  expectedResultRevision: Revision;
  nextActivityId?: StableId;
  // Required when a target exists. A caller may omit it only to discover the
  // side-effect-free no_next_activity terminal case.
  expectedNextTimerRevision?: Revision;
};
```

`start` preserves the single-active-stopwatch invariant, starts/resumes the
parent session when present, pauses competing activity/session instruments,
and moves focus. `pause` pauses the activity while leaving its parent session
running. Completed timers are permanently locked.

Result commands persist only the explicit enum choice and never infer an
outcome. Revision zero denotes an absent result. Clearing deletes the result
and returns revision zero. If a completed result changes, review metadata is
reconciled with the existing review cadence.

`confirm_candidate_evidence` applies only to an unconfirmed
`possible_contamination` pair. It records an immutable confirmation and updates
the pair's evidence projection in the same transaction.

`finish` requires all of the following before any side effect:

- current open-workbench, timer, result, and lease revisions;
- a started, unfinished timer;
- an explicitly saved result;
- at least one satisfied Live candidate-text pair;
- no blocking Voice delivery, canonical-transcript, audio, decision, deletion,
  or conflict guard.

Pending unclassified Voice envelopes are discarded only inside the successful
finish transaction. Finish also closes the activity timer, updates
publication/review state, finishes its parent session when no unfinished child
remains, updates focus, and releases the current activity lease atomically.

`finish-next` enforces the same gates. With `nextActivityId`, the target must be
a different unfinished practice activity in the same open workbench. Without
it, D1 chooses the first unfinished practice child after the current child in
the persisted parent-session `activityIds` order. A standalone or terminal
child receives `409 no_next_activity` without a receipt or any state change.
Success finishes current, pauses competing instruments, starts only the chosen
activity and its parent session, updates focus, and releases only the current
lease. It does not lease the next activity.

Command responses add:

```ts
type CommandResponse = MutationResponse & {
  selectedNextActivityId: StableId | null;
  confirmation: { pairId: StableId; confirmedAt: EpochMilliseconds } | null;
  today: TodayProjection;
};
```

## Error and retry policy

All structured errors use `ErrorBody`. Clients retry only when both the status
and `retryable` semantics permit it, and they reread the authoritative
projection before retrying optimistic conflicts.

| HTTP | Code | Retryable | Meaning |
| --- | --- | --- | --- |
| 400 | `invalid_request` | false | Malformed JSON, ID, field, header, command, range metadata, or unsupported limit. |
| 401 | `unauthorized` | false | Token missing, malformed, unknown, or revoked. |
| 404 | `activity_not_found` | false | No owner-visible System Design activity in the open workbench. |
| 404 | `receipt_not_found` | false | No receipt for this owner/activity/operation. |
| 404 | `pair_not_found` | false | Confirmation pair is absent in this owner/activity. |
| 404 | `clip_not_found` | false | Clip metadata/object is absent or not available. |
| 409 | `idempotency_conflict` | false | Stable operation or immutable identity was reused with changed content. |
| 409 | `lease_held` | false | Another unexpired holder/session owns the lease. |
| 409 | `lease_conflict` | true | Fence is expired, stale, or foreign. Reread and reacquire. |
| 409 | `revision_conflict` | true | Workbench, timer, result, transcript order, or other CAS input changed. |
| 409 | `clip_upload_in_progress` | true | Same writer has another immutable stream claim. |
| 409 | `timer_completed`, `timer_not_running`, `timer_not_finishable`, `session_completed` | false | Command violates locked timer/session state. |
| 409 | `result_required` | false | Finish has no explicit saved result. |
| 409 | `candidate_evidence_required` | false | Finish has no satisfied candidate text evidence. |
| 409 | `voice_delivery_blocked` | false | Voice evidence requires user/recovery action. |
| 409 | `next_activity_unavailable`, `no_next_activity` | false | Finish-next target is invalid or absent. |
| 422 | `candidate_evidence_required` | false | `no_candidate` cannot create a pair. |
| 422 | `clip_checksum_mismatch`, `clip_size_mismatch` | true | Stream does not match staged immutable bytes. |
| 503 | `clip_upload_failed` | true | Private R2 transfer failed; retain local recovery bytes. |

Unhandled `5xx` failures have no implied mutation result. Use receipt lookup,
then reread activity/Today before deciding whether to retry.

## Owner invalidations and missed-event recovery

After each non-duplicate commit, the Worker best-effort publishes through the
existing integration-token-authenticated WebSocket at `GET /events` using the
`interview-arc-live` subprotocol. The only Live invalidation envelope is:

```ts
type LiveInvalidation = {
  type: "practice_changed";
  revision: Revision; // positive and owner-monotonic within scope "live"
  scope: "live";
  occurredAt: EpochMilliseconds;
};
```

The event contains no activity/prompt/transcript text, result, clip status,
object key/URL/bytes, token, holder identity, or provider state. It is a hint to
reread, never a mutation record. Event publication occurs after D1 commit and
an outage cannot change a successful mutation response.

Clients compare revisions only against prior `scope: "live"` invalidations,
discard stale/invalid Live revisions, and reread `/live/v1/today` plus the open
activity. Other browser/Voice scopes have independent invalidation sequences.
When disconnected, clients reconnect with bounded backoff and use the shared
REST fallback starting at 15 seconds, doubling to a 120-second maximum.
Visibility/wake and explicit user actions may trigger an immediate reread. The
returned `ownerRevision` (which remains monotonic even with no open workbench)
closes missed Live-event gaps.

## Privacy, compatibility, and handoff

- All D1 predicates and private R2 keys are owner scoped from the resolved
  token. Object keys remain server-only.
- Live stores only opaque installation/room identities, never a device name.
- Live clips are optional private attachments, not Voice delivery evidence.
- v1 does not expose browser `/api/state`, `/api/mutations`, Voice-v2 routes,
  MCP tools, provider threads, board/editor state, or partial model streams.
- Additive fields and additive non-breaking enum use require clients to ignore
  what they do not understand. Removing/renaming a field, changing required
  behavior, narrowing a previously valid request, or changing receipt meaning
  requires `/live/v2`.
- The hosted Worker/API must deploy before a client depending on this contract
  merges. The client releases its Live lease and completes receipt/upload
  recovery before cross-surface handoff.
