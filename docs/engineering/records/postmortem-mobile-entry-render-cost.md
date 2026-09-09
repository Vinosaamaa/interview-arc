---
schemaVersion: 1
id: postmortem-mobile-entry-render-cost
revision: 1
type: postmortem
status: closed
title: Flatten phone readers and reduce workspace entry rendering
repository: interview-arc
capabilityIds: ["arc-connected-practice"]
createdAt: 2026-09-08
reconstructed: false
confidence: verified
unknowns: ["Historical per-request traces cannot prove whether the reported resource limit was CPU or memory, or attribute it exclusively to the preceding UI change.", "Physical iPhone acceptance remains with the owner."]
modules: ["website-navigation", "practice-readers", "website-entry"]
interfaces: ["workspace-bootstrap", "content-index", "practice-record-reader"]
seams: ["Authenticated entry to dashboard rendering", "Phone width to list and reader geometry"]
adapters: ["app/home-bootstrap.tsx", "app/api/content-index/route.ts", "app/workspace-responsive.css"]
relatedRecords: ["postmortem-mobile-reader-content-overflow@1"]
decisions: []
incidents: []
features: []
capabilities: ["arc-connected-practice"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Mobile audit #347","url":"https://github.com/Vinosaamaa/interview-arc/issues/347","kind":"issue"}]
verification: {"state":"verified","evidenceRefs":["scripts/check-mobile-ui.mjs", "scripts/check-mobile-readers.mjs", "scripts/check-entry-budget.mjs"]}
visibility: public-safe
publicationEligibility: eligible
issue: 347
pr: null
release: null
run: null
---
# Flatten phone readers and reduce workspace entry rendering

Phone navigation and controls stay horizontal, transcripts become a direct document, and authenticated entry no longer server-renders the entire dashboard and serializes the full Engineering journal into HTML.

## Impact and evidence

Owner screenshots exposed cumulative reader padding, overlapping Conversation labels, wrapped navigation, and a Worker resource-limit failure after login. Historical Worker metrics confirmed failures in the reported interval. Earlier sampled intervals contained no resource-limit errors, but had already expensive successful requests. Timing establishes association with the preceding deployment, not an exclusive cause.

The production content projection contained only the public question catalog. The landing route nevertheless loaded the entire content index and passed the complete generated Engineering journal into server-rendered dashboard props. An isolated production build emitted 1,486,256 bytes of entry HTML; a warm local request took approximately 189 milliseconds. Historical per-request traces were unavailable, so the exact CPU-versus-memory failure remains unknown.

## Repair

The server returns a small bootstrap. Browser chunks load the dashboard and versioned Git journal; a separate authenticated endpoint reads the existing D1 content projection with private, no-store caching. Failures show an explicit retry instead of silently opening an empty workspace or retrying in a loop. The Access verification path is unchanged. Worker observability is enabled for future invocation outcome and resource evidence; no transcript or request-body logging is added.

At phone widths only, the brand, workspace switch and controls occupy one compact row. Bottom navigation and filter/action rails stay horizontal and scroll sideways when needed. List titles use available width with truncation; full titles remain in readers. List actions share one strip. WebKit list painting does not depend on deferred content visibility. Reviews and Banks retain their 580-pixel minimum result height.

Phone readers retain the full visible viewport but remove nested card borders and accumulating horizontal padding. Conversation labels do not overlap. Every original transcript turn and code block remains intact. Larger layouts retain their existing geometry.

## Verification and limits

The rebuilt entry measured 13,320 bytes, approximately 99 percent smaller. Warm local requests measured 4–6 milliseconds. These are local wall times, not Cloudflare CPU measurements or physical-phone acceptance. The content endpoint remained private and no-store; the production Access gate rejected both entry and content requests carrying an untrusted identity header.

The browser regressions cover all 17 destinations, populated conversation and code readers across three specialties and three origins, horizontal code, wrapping, copying, expansion, resizing and close restoration. The entry regression exercises built HTML size, transient failure, explicit retry and a preserved Engineering deep link. A scroll-test failure was isolated to clicking before the arrival transition completed; the test now waits for that transition.

No data migration or credential change is involved. Revert this change to restore the prior entry and phone presentation. Production verification must distinguish a successful protected-entry redirect from a fully authenticated phone load.
