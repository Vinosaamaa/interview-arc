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
- CDP endpoint: `http://127.0.0.1:9223`
- Client: Playwright `chromium.connectOverCDP`
- Browser state: exactly one persistent automation-owned LeetCode problem or
  current-submission tab
- Language: Java

The controller does not require the Chrome Companion extension. Playwright's
`chromium` API attaches to the fixed regular Google Chrome process; it does not
launch Playwright's bundled Chromium.

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

```bash
node scripts/leetcode-playwright-controller.mjs ensure
node scripts/leetcode-playwright-controller.mjs navigate \
  https://leetcode.com/problems/two-sum/ \
  --title "Two Sum"
node scripts/leetcode-playwright-controller.mjs submit \
  https://leetcode.com/problems/two-sum/ \
  practice/leetcode/solutions/0001-two-sum.java \
  --title "Two Sum"
node scripts/leetcode-playwright-controller.mjs retry \
  https://leetcode.com/problems/two-sum/ \
  practice/leetcode/solutions/0001-two-sum.java \
  --title "Two Sum"
```

`ensure` resolves Playwright, checks `/json/version`, launches the fixed Chrome
only when the endpoint is absent, restores the previously active macOS app,
and reacquires exactly one existing LeetCode tab. A newly launched browser may
hold the fixed problem-set staging page until `navigate` assigns its first
canonical problem. `navigate` reuses that page
and records a problem-specific preflight receipt. Run both while the user is
reading or coding, before an interactive submit request.

`submit` and `retry` require a current preflight receipt for the same Chrome
browser instance and problem. They fail closed when the receipt or endpoint is
stale; they never install dependencies, discover executables, launch Chrome,
create a tab, generate controller source, or repair controller code on the hot
path.

The structured controller result is authoritative. A successful result ends
the operation. A structured failure is reported exactly and ends the operation;
the specialist does not attempt repair or recovery in that submission turn.

**No side diagnostics:** specialists must not run direct `curl`, `ps`, `pgrep`,
process inspection, browser enumeration, extension control, manual
Playwright/CDP code, or another automation tool around these commands. A shell
sandbox's inability to reach loopback is not controller evidence and must not
trigger `ensure`, navigation, browser launch, or process discovery.

If `submit` output is lost or ambiguous, an attempt may already have been sent.
Never resend `submit` or run `retry` automatically. Report the missing verdict
receipt and wait for explicit user direction. Run `retry` only after revised
source and a separate explicit user request; a non-Accepted verdict alone does
not authorize it.

## Exact submission transaction

For one explicit submit request, the controller:

1. validates the canonical URL, matching title, visible Java state, and exactly
   one Monaco model whose URI ends in `.java` and whose language is Java;
2. reads the supplied UTF-8 file once immediately before editor mutation;
3. invokes exactly one Monaco `model.setValue(exactSource)` operation;
4. reads the model back and requires exact string equality, reporting UTF-8 byte
   counts and the first differing byte offset on mismatch;
5. focuses the editor through DOM state without foregrounding Chrome;
6. captures the scoped prior-attempt identity and sends one `Meta+Enter`;
7. accepts only a new attempt-specific transition and a verdict from the scoped
   current-submission result region.

The controller never scans the whole document body, reuses an old visible
verdict, inspects unrelated panels, submits transformed code, or automatically
resubmits.

## Retry recovery

When the one tab is on a result URL, `retry` first uses browser Back. If Back
does not restore the verified canonical editable Java problem, it navigates the
same page directly to the verified canonical URL. Both paths re-run all identity
and model checks before mutation. If recovery fails, no submit gesture is sent.

## Cleanup and timing

Every command owns one Playwright CDP connection and releases it in `finally`.
For a browser attached with `connectOverCDP`, Playwright closes that controller
transport without closing the independently launched Chrome process, persistent
profile, or tab. Timeouts clear their timers and release the same connection;
they never trigger an automatic retry.

The five-second budget covers the warm local path from exact file read through
the single `Meta+Enter`. The LeetCode attempt-specific verdict wait has a
separate 60-second bound. Structured output reports local stage timings, warm
submit duration through the verdict, and total user-visible command duration;
none of those values may be substituted for another.

## Release verification

Mocked integration tests own failure, ambiguity, equality, transition,
recovery, cleanup, and timing cases. Release verification additionally uses the
fixed headed Chrome/profile to reuse one authenticated tab across two canonical
problems and one explicit retry. The smoke test must confirm that cleanup leaves
the Chrome process and tab running. It must not attach browser plumbing to a
practice transcript.
