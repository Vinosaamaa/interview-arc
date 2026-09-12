# Connected ChatGPT practice: text and Live boundaries

Assessment: **2026-09-11**. Provider setup, account linking and connected-text
practice reads/writes were verified in the
[2026-09-10 release receipt](https://github.com/Vinosaamaa/interview-arc/issues/453#issuecomment-5626730580).
The Windows connection's rejected OAuth grant was cleared by reconnecting on
2026-09-11. Authenticated bank reads and complete specialist-guide retrieval
then passed; see the [specialist verification report](../engineering/reports/2026-09-11-specialist-e2e-neetcode-150.md).
That receipt covers this connection at the recorded time. Physical Voice
acceptance is still pending.

The intended daily flow is text preparation from the connected private bank,
Live conversation in the same chat where supported, then direct text save.
There is no routine file download, attachment or website import.

## Connection design

The separate `/chatgpt/mcp` endpoint uses Cloudflare Access Managed OAuth.
Access owns discovery, client registration, authorization-code/PKCE exchange,
refresh and revocation. Arc validates the signed Access assertion's issuer,
audience, signature and lifetime, then resolves the same normalized owner
identity as the website. An explicit tool allowlist limits this connection to
practice. Existing personal-token `/mcp` clients keep their current behavior.
MCP initialization includes the canonical practice guide as server instructions,
so the connected client receives the current checked-in guide without an
attachment or pasted setup. Read its declared version rather than assuming a
historical number.

Managed OAuth needs a separate Access application with the owner's existing
identity policy, approved ChatGPT redirect URIs and a dedicated audience.
The MCP Worker needs `CHATGPT_ACCESS_TEAM_DOMAIN` and `CHATGPT_ACCESS_AUD`.
Without those configured values or a valid assertion, the endpoint returns 401.
Provider discovery is served by Access before the request reaches the Worker.
The isolated path-scoped application has been configured with the existing
owner identity policy and dedicated Worker configuration. Its OAuth 401
challenge leads to resource metadata (200), then authorization-server metadata
(200) advertising S256 PKCE and dynamic client registration. The legacy route
retains its previous authentication response.

This deliberately avoids implementing an authorization server or issuing
another manually copied API key. OAuth compatibility follows the
[OpenAI authentication contract](https://developers.openai.com/plugins/build/auth)
and [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

## Supported server surface and remaining proof

| Workflow | Server support | Boundary |
| --- | --- | --- |
| Private bank and progress | Bounded search and exact fetch; owner isolation | Account must expose and successfully call the connector. |
| Add a question | Insert-only private question with durable operation receipt; canonical matches reused | No implicit activity, timer, result or prompt overwrite. |
| Text practice timers/results | Existing guarded planning, timer, mode and result handlers | Requires actual text tool calls and current revisions. |
| Exact exchanges and code review | Existing exchange/code-attempt handlers and saved-status readback | No code execution or external judge submission is implied. |
| Reusable answers and solution profiles | Native finalization and later solution-publication batches | Save historical practice first, then publish or reuse a complete profile through `publish_practice_solutions`; verify each receipt. Backfill alone does not promote a Solution. Original coaching is not an official editorial. |
| Behavioral materials | Existing preflight, accepted evidence/stories/project references, current resume library/revisions and activity-bound resume context | Missing facts remain gaps; no career administration or filesystem access. |
| Live historical save | Strict preview/apply importer with immutable receipt and source fidelity | Exact available transcript only; incomplete evidence stays pending. |
| Excalidraw | Read saved scenes or exported links in guarded fragments; attach exported drawings to completed practice | Arc does not control a canvas. `save_practice_drawing` stores the editable snapshot; generated references use `assistant_reference`. A separately connected canvas has its own export receipt. |
| Live tool invocation | Not established | A working text connector does not prove tools are callable in Voice. |

The ChatGPT Developer-mode form was inspected and OAuth discovery was missing
before implementation. After provider setup and refreshed discovery, ChatGPT
connector creation succeeded and entered the owner sign-in flow. Later
connected-text and website acceptance verified saved solution batches, exact
retries, unchanged original Practice Record fingerprints, and the deployed
coaching guide, as recorded in the release receipt above. Those account
observations are separate from local cryptographic, SQL and MCP transport
tests. A new connection must still pass its own authenticated read. Model, plan and
surface restrictions still apply. The current consumer Voice documentation
excludes connected apps/plugins; it does not establish this custom connector as
a Live tool route. The same-chat transition must also succeed on the account.
[Consumer Voice help](https://help.openai.com/en/articles/20001274).

## Timing and source preservation

For ordinary Live preparation, select and fetch questions without starting a
backend activity. Spoken Start/Pause/Resume/Finish commands are logical state.
Use complete supplied boundaries when available; otherwise accept one rough
active-minute estimate at Finish or unknown. Never infer server timer intervals
from spoken pauses, a generated recap, word count or pacing.

After Voice, copy only available source turns into the direct save packet.
Keep user code, speaker order, review attribution, missing coverage and time
basis intact. Voice text is not verbatim audio. A summary cannot become raw
dialogue. No reviewed documentation establishes automatic recovery of
unavailable audio, truncated context, or other chats.

Explicit backend-timed text practice uses one real activity throughout.
Its exchange and finalization tools update that same activity; historical
backfill must not create a second completed attempt. The importer also detects
same-question/Pacific-day occupancy and retains conflicting evidence as pending.

## Acceptance after configuration

Verify the configured endpoint's OAuth metadata, exact redirect/resource flow,
successful owner sign-in and one real bank ID/prompt read in ChatGPT. Verify
that the old personal-token endpoint still works. Exercise only synthetic
practice for create, preview/apply, replay and permission tests.

Then test text preparation → Voice → text save on the actual account. Compare
the available transcript and receipt, including estimated/unknown time. Confirm
which write tools the current plan/model exposes before claiming it supports
the entire workflow. See the [practice guide](../agents/chatgpt-practice-prompt.md).
