# Companion Network Recovery Regression

## Summary

Interview Arc Companion 1.1.4 correctly preserved its saved token when a
network request failed, but it could remain stuck on **Failed to fetch** after
the production bridge recovered. The Retry control repeated the same
side-panel request path that had already failed, so it was not an independent
recovery mechanism.

Issue: [#82](https://github.com/Vinosaamaa/interview-arc/issues/82)

## User impact

The Companion could not load the current coding activity or synchronize timer,
result, star, and note changes. The valid personal integration token remained
safe, but the Companion was unusable until its network context recovered.

No D1 records, timer state, result state, notes, or credentials were lost or
modified by the failure.

## Detection

The user reported that Companion 1.1.4 displayed **Failed to fetch** and that
**Recheck connection** did not recover. This was a recurrence of the
automatic-recovery acceptance criterion in issue #82.

## Timeline

- Companion 1.1.4 was released to preserve valid credentials during transient
  bridge failures and distinguish HTTP 401 from transport failures.
- The user reloaded the unpacked extension.
- The panel continued to report **Failed to fetch** after Retry.
- Production health, authenticated state, and CORS checks all succeeded.
- Issue #82 was reopened and the recovery path was moved to the extension
  service worker.

## Relevant architecture

Before this repair, `sidepanel.js` called the cross-origin Companion API
directly. The Retry button called the same function again in the same page
execution context.

After this repair:

1. The side panel sends a constrained internal request message.
2. The extension service worker validates that message.
3. The service worker performs the authenticated bridge request.
4. It returns a structured HTTP response or a classified transport failure.
5. The side panel renders the result without receiving or exposing raw browser
   fetch exceptions.

Only `/companion/state` and `/companion/mutations` are accepted by the broker.

## Evidence

- `GET /health` returned HTTP 200.
- An authenticated `GET /companion/state` returned HTTP 200, 41,651 bytes, in
  approximately 0.5 seconds using the same saved integration credential.
- An extension-origin preflight returned HTTP 204 with the expected origin,
  headers, and methods.
- The HTTP 401 path also returned the correct extension-origin CORS headers.
- The panel displayed the browser-native `Failed to fetch` message, proving no
  HTTP response reached its `api()` response-classification branch.
- Source inspection confirmed that Retry reused the same direct side-panel
  fetch path.

## Root cause

The architectural root cause was a single transport path owned by the
side-panel page. A browser-level rejection in that page context left no
independent recovery route; Retry only repeated the failed path.

The lower-level Chrome trigger for the page-context rejection was not directly
observable in the available environment. The production service, credential,
response size, response time, and CORS contract were all ruled out.

## Contributing factors

- The initial repair tested network and HTTP classification with source-level
  assertions but did not exercise a second execution context.
- The error UI surfaced the browser's generic exception text without a
  transport code.
- Retry was treated as a user-interface action rather than a separate recovery
  boundary.

## Failed approaches

- Reloading the unpacked extension did not restore connectivity.
- Repeating the direct side-panel fetch did not recover.
- Replacing or regenerating the token was unnecessary; the saved token
  authenticated successfully outside the extension.

## Resolution

- Broker Companion requests through the extension service worker.
- Constrain broker requests to the two Companion endpoints and GET/POST.
- Add a 15-second timeout and stable `network`, `timeout`, `worker`, and
  `invalid-request` transport classifications.
- Keep 401 handling separate from transport failures so a network error cannot
  delete the saved token.
- Bump the unpacked extension to version 1.1.5.

## Regression prevention

Automated coverage now verifies:

- authenticated broker response forwarding;
- browser-level `Failed to fetch` classification;
- credential omission from transport-error envelopes;
- rejection of unknown broker endpoints before fetch;
- side-panel routing through `chrome.runtime.sendMessage`;
- service-worker ownership of Companion API fetches.

The complete repository build, test suite, lint, CI, deployed production
smoke test, and reloaded unpacked-extension flow remain required before issue
closure.

## Merged-release verification

Pending the follow-up pull request, main deployment, extension reload, and
production Companion smoke test.

## Follow-up issues

No separate follow-up issue is required at implementation time. Any recurrence
will reopen issue #82 with the extension version, Chrome error evidence, and
the failed transport code.

## Technical glossary

- **Side panel:** The visible Interview Arc Companion document inside Chrome.
- **Service worker:** The extension's background execution context, which
  wakes for messages and owns privileged extension operations.
- **Transport failure:** A request that fails before an HTTP response exists.
- **CORS:** Browser rules and response headers governing cross-origin requests.
- **Broker:** The constrained service-worker boundary that performs API
  requests on behalf of the side panel.
