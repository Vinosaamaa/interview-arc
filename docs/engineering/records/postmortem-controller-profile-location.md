---
schemaVersion: 1
id: postmortem-controller-profile-location
revision: 1
type: postmortem
status: proposed
title: Keep the LeetCode controller profile inside its canonical repository
repository: interview-arc
capabilityIds: ["arc-connected-practice"]
createdAt: 2026-09-09
reconstructed: false
confidence: verified
unknowns: ["Live profile adoption and authenticated readiness remain pending."]
modules: ["leetcode-playwright-controller"]
interfaces: ["controller-cli", "dedicated-browser-identity"]
seams: ["Linked worktree to canonical profile ownership", "Legacy profile adoption to durable receipt recovery"]
adapters: ["scripts/leetcode-playwright-controller.mjs"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["arc-connected-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Profile ownership issue #447","url":"https://github.com/Vinosaamaa/interview-arc/issues/447","kind":"issue"},{"label":"Controller profile repair PR #448","url":"https://github.com/Vinosaamaa/interview-arc/pull/448","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["tests/leetcode-controller-profile.test.mjs", "tests/leetcode-playwright-controller.test.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 447
pr: 448
release: null
run: null
---
# Controller profile location did not follow its repository contract

- Owning issue: [#447](https://github.com/Vinosaamaa/interview-arc/issues/447)
- Change: [PR #448](https://github.com/Vinosaamaa/interview-arc/pull/448)
- Status: source repair; live adoption and release verification pending

## Impact and detection

During a specialist setup audit, source inspection showed that the controller
would create browser state outside Interview Arc. The current contract already
described a repository-root profile, but executable path selection still used
the checkout's parent. Arbitrary linked worktree locations could also select
different profiles for the same fixed browser port. No profile loss, accidental
submission, or live authentication failure was demonstrated in this audit.

## Timeline and evidence

- 2026-09-09: setup inspection identified the parent-derived profile path.
- 2026-09-09: issue #447 scoped the repository-owned path and preservation repair.
- 2026-09-09: disposable Git fixtures reproduced primary/worktree path behavior;
  regression coverage added legacy coexistence, pending/terminal receipt
  preservation, symlink containment, and unavailable browser identity checks.

## Root cause and contributing factors

The controller encoded an older outer-workspace convention and special-cased
only one worktree directory name. The existing profile-path test checked the
suffix, so it could not detect an incorrect owning directory. In addition,
unavailable browser command-line verification was treated as informational;
that cannot establish that a fixed-port browser belongs to a relocated profile.

## Repair and prevention

Resolve one primary repository through shared Git metadata. Keep its profile
and receipt directories ignored, and reject linked state directories. Detect
the exact old profile locations before any writes and require explicit offline
adoption of the original profile, preserving its durable receipts. Reject
unverified browser identity before page access and bind new preflight receipts
to the canonical profile. Real Git fixtures now exercise primary, linked, and
symlinked checkout imports rather than checking only a path suffix.

## Release verification and remaining work

The PR does not migrate live profiles, restart Chrome, submit code, or change
practice state. The coordinator must perform the adoption/readiness steps in
`docs/contracts/leetcode-playwright-controller.md` after merge authorization.
Keep issue #447 open until the required live receipts exist. Rollback must
preserve the current profile and receipts; reverting source alone does not
authorize recreating an old profile or automatically resending any attempt.

## Terms

- Canonical repository: the primary checkout whose `.git` directory is shared
  by its linked issue worktrees.
- CDP: Chrome DevTools Protocol, used here only through the fixed Playwright
  controller to verify and operate the dedicated browser.
- Preflight: a saved binding of one profile, browser instance, and problem
  required before submission.
