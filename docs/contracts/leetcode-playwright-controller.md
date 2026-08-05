# LeetCode Playwright Controller

This contract owns deterministic browser navigation and submission for the
LeetCode specialist. `scripts/leetcode-playwright-controller.mjs` is the **only
supported browser-automation and submission path**. Specialists must not build
temporary controllers, use raw CDP submission scripts, type multiline source,
or fall back to another browser, profile, port, tab, or automation framework.

The controller complements the workflow owned by parent issue #103 and the
specialist documentation in PR #129. It does not replace Interview Arc timer or
result controls and does not publish practice data.

## Fixed identity

- Application: `/Applications/Google Chrome.app`
- Profile: `browser-profiles/leetcode-submitter` beside the repository
- Controller state: `.interview-arc-controller/` inside that dedicated profile
- CDP endpoint: `http://127.0.0.1:9223`
- Client: Playwright `chromium.connectOverCDP`
- Browser state: exactly one persistent automation-owned LeetCode problem or
  current-submission tab
- Language: Java

The controller does not require the Chrome Companion extension. Playwright's
`chromium` API attaches to the fixed regular Google Chrome process; it does not
launch Playwright's bundled Chromium.

The profile-local state directory owns the controller lock and preflight
receipt. Do not use `~/Library/Caches` or another home-directory path: the
specialist sandbox may read those locations without permission to create the
lock. If the fixed profile itself is unwritable, fail before browser action with
`controller_state_unwritable` and report the profile-local directory.

## Mandatory specialist route

Run only these commands from the repository root. This is the complete
specialist route; controller implementation details are not an alternate
runbook.

The canonical checkout has one pinned coordinator-owned dependency bootstrap:

```bash
npm exec --yes pnpm@9.15.9 -- install --frozen-lockfile
```

Run it once after a merged `package.json` or `pnpm-lock.yaml` change, before
assigning controller work, and then execute the real local `ensure`. Do not
substitute mocked tests or fresh hosted CI for this long-lived-checkout
readiness check. Dependency bootstrap is forbidden on the interactive
`submit` and `retry` paths. If Playwright cannot load, the controller returns
`playwright_import_failed` with this exact `recoveryCommand` and performs no
browser navigation or submission.

The `ensure`, `navigate`, `editorial`, `submit`, and `retry` commands require GUI and
loopback-CDP authority. A Codex `exec_command` invocation uses
`sandbox_permissions: "require_escalated"` from its first attempt, with the
narrow reusable command prefix
`["node", "scripts/leetcode-playwright-controller.mjs"]`. Do not probe the
controller in a restricted shell first: sandbox denial can hide a live endpoint
or block LaunchServices. A denied fixed-Chrome launch returns
`chrome_launch_failed` with `requiredSandboxPermission: "require_escalated"`.
The read-only `receipt` command needs no browser authority.

```bash
node scripts/leetcode-playwright-controller.mjs ensure
node scripts/leetcode-playwright-controller.mjs navigate \
  https://leetcode.com/problems/two-sum/ \
  --title "Two Sum"
node scripts/leetcode-playwright-controller.mjs editorial \
  https://leetcode.com/problems/two-sum/ \
  --title "Two Sum"
node scripts/leetcode-playwright-controller.mjs submit \
  https://leetcode.com/problems/two-sum/ \
  practice/leetcode/solutions/0001-two-sum.java \
  --title "Two Sum" \
  --invocation-id "submit-two-sum-20260804-01"
node scripts/leetcode-playwright-controller.mjs retry \
  https://leetcode.com/problems/two-sum/ \
  practice/leetcode/solutions/0001-two-sum.java \
  --title "Two Sum" \
  --invocation-id "retry-two-sum-20260804-01"
node scripts/leetcode-playwright-controller.mjs receipt \
  --invocation-id "submit-two-sum-20260804-01"
```

`ensure` resolves Playwright, checks `/json/version`, launches the fixed Chrome
only when the endpoint is absent, restores the previously active macOS app,
and reacquires exactly one existing LeetCode tab. A newly launched browser may
hold the fixed problem-set staging page until `navigate` assigns its first
canonical problem. `navigate` reuses that page
and records a problem-specific preflight receipt. Run both while the user is
reading or coding, before an interactive submit request.

`editorial` is a read-only, post-attempt research command. It requires the same
live browser and problem preflight as `submit` and `retry`, reuses the one
automation-owned tab, verifies the current same-problem route (including
description, Editorial, solutions, and submission result pages), then navigates
that tab directly to the canonical Editorial URL in one visible-page navigation.
It does not navigate through the problem editor first.
It never launches Chrome, opens a tab, submits code, or writes practice state.
The command verifies the visible Editorial page identity and rendered article
structure without returning or persisting Editorial prose or official code.
Its structured result includes `editorialUrl`, `availability`,
`contentAvailable`, and stage timings. `availability` is `available` only when
actual Editorial content is rendered; `premium_locked` and `unavailable` are
honest fail-closed results that must not be cited as consulted research.

`submit` and `retry` require a current preflight receipt for the same Chrome
browser instance and problem. They fail closed when the receipt or endpoint is
stale; they never install dependencies, discover executables, launch Chrome,
create a tab, generate controller source, or repair controller code on the hot
path.

Each `submit` and `retry` also requires a caller-chosen unique invocation ID.
Before any browser action, the controller reserves that ID under the existing
profile-local state directory. A reused ID fails closed. The terminal success
or structured failure envelope is written atomically before the CLI emits it.
`receipt` reads only the exact named invocation; it does not acquire the
controller lock, connect to Chrome, navigate, edit source, or submit.

The structured controller result is authoritative. A successful result ends
the operation. A structured failure is reported exactly and ends the operation;
the specialist does not attempt repair or recovery in that submission turn.

**No side diagnostics:** specialists must not run direct `curl`, `ps`, `pgrep`,
process inspection, browser enumeration, extension control, manual
Playwright/CDP code, or another automation tool around these commands. A shell
sandbox's inability to reach loopback is not controller evidence and must not
trigger `ensure`, navigation, browser launch, or process discovery.

If `submit` or `retry` output is lost or ambiguous, an attempt may already have
been sent. Run `receipt` exactly once with the same invocation ID from the
original command. A recovered terminal envelope is authoritative. Pending,
missing, or corrupt receipt state remains ambiguous and never authorizes a new
ID, a resent `submit`, or an automatic `retry`. Run `retry` only after revised
source and a separate explicit user request; a non-Accepted verdict alone does
not authorize it. Never resend `submit` or run `retry` automatically.

## Exact submission transaction

For one explicit submit request, the controller:

1. exclusively reserves the supplied invocation ID in durable local state;
2. validates the canonical URL, matching title, visible Java state, and exactly
   one Monaco model whose URI ends in `.java` and whose language is Java;
3. reads the supplied UTF-8 file once immediately before editor mutation;
4. invokes exactly one Monaco `model.setValue(exactSource)` operation;
5. reads the model back and requires exact string equality, reporting UTF-8 byte
   counts and the first differing byte offset on mismatch;
6. focuses the editor through DOM state without foregrounding Chrome;
7. captures the scoped prior-attempt identity and sends one `Meta+Enter`;
8. accepts only a new attempt-specific transition and a verdict from the scoped
   current-submission result region; and
9. atomically stores the terminal result envelope under the reserved invocation
   ID before writing the same envelope to stdout or stderr.

The controller never scans the whole document body, reuses an old visible
verdict, inspects unrelated panels, submits transformed code, or automatically
resubmits.

## Retry recovery

When the one tab is on a result URL, `retry` first uses browser Back. If Back
does not restore the verified canonical editable Java problem, it navigates the
same page directly to the verified canonical URL. Both paths re-run all identity
and model checks before mutation. If recovery fails, no submit gesture is sent.

## Cleanup and timing

Every browser command owns one Playwright CDP connection and releases it in
`finally`.
For a browser attached with `connectOverCDP`, Playwright closes that controller
transport without closing the independently launched Chrome process, persistent
profile, or tab. Timeouts clear their timers and release the same connection;
they never trigger an automatic retry.

The five-second budget covers the warm local path from exact file read through
the single `Meta+Enter`. The LeetCode attempt-specific verdict wait has a
separate 60-second bound. Editorial content verification has a separate
30-second bound. Structured output reports local stage timings, warm submit
duration through the verdict, Editorial page latency/content-verification
timings, and total user-visible command duration;
none of those values may be substituted for another.

Terminal receipt files are private local controller state, not practice
transcript data or Git artifacts. The invocation ID validation prevents path
traversal. Atomic replacement ensures recovery sees either the complete pending
reservation or the complete terminal envelope, never a partially replaced
result. Terminal receipts are retained for 30 days with a maximum of the newest
200. Cleanup runs before a later receipt-backed browser action and fails closed
if it cannot enforce the policy. Pending or malformed safety evidence is never
deleted automatically. A pruned exact ID returns `controller_receipt_missing`;
invocation IDs remain globally unique by contract and must not be reused after
pruning. Pending state explicitly means the submit outcome remains ambiguous.

## Release verification

Mocked integration tests own failure, ambiguity, equality, transition,
recovery, cleanup, and timing cases. Release verification additionally uses the
fixed headed Chrome/profile to reuse one authenticated tab across two canonical
problems, one explicit retry, and one non-submitting Editorial research command.
The Editorial smoke must confirm that the same tab is reused, content
availability is reported honestly, no submit gesture occurs, and cleanup leaves
the Chrome process and tab running. It must not attach browser plumbing to a
practice transcript.
