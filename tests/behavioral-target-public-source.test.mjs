import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralTargetProfileInputSchema,
  behavioralTargetProfileStateWriteSchema,
} from "../db/behavioral-target-profile-policy.ts";
import {
  classifyPostingFreshness,
  extractPostingText,
  fetchPublicBehavioralTargetSource,
  normalizePublicPostingUrl,
  postingChangeState,
} from "../db/behavioral-target-public-source.ts";

const baseTarget = {
  targetId: "target-example-platform",
  label: "Example Platform",
  state: "active",
  company: "Example",
  roleTitle: "Senior Platform Engineer",
  source: {
    kind: "public_posting",
    displayLocator: "https://jobs.example.com/platform/42",
    capturedAt: 1_786_464_000_000,
    jdText: "Build reliable platform services.",
  },
  responsibilities: [],
  requiredQualifications: [],
  preferredQualifications: [],
  competencySignals: [],
  seniorityIndicators: [],
  domainVocabulary: [],
  verifiedCompanySignals: [],
  unresolvedAmbiguities: [],
  ownerNotes: [],
};

test("Target Profiles accept public postings without weakening exact state operations", () => {
  assert.equal(behavioralTargetProfileInputSchema.parse(baseTarget).source.kind, "public_posting");
  assert.deepEqual(behavioralTargetProfileStateWriteSchema.parse({
    operationId: "target-archive-example-1",
    targetId: baseTarget.targetId,
    expectedRevision: 1,
    state: "archived",
  }), {
    operationId: "target-archive-example-1",
    targetId: baseTarget.targetId,
    expectedRevision: 1,
    state: "archived",
  });
});

test("public posting URLs are HTTPS, credential-free, and public-host only", () => {
  assert.equal(
    normalizePublicPostingUrl("https://jobs.example.com/roles/42?utm_source=mail#apply"),
    "https://jobs.example.com/roles/42",
  );
  for (const unsafe of [
    "http://jobs.example.com/42",
    "https://user:secret@jobs.example.com/42",
    "https://localhost/42",
    "https://127.0.0.1/42",
    "https://[::1]/42",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://jobs.example.local/42",
    `https://jobs.example.com/${"a".repeat(240)}`,
  ]) assert.throws(() => normalizePublicPostingUrl(unsafe), /public HTTPS job-posting URL/);
});

test("posting extraction removes executable markup and preserves bounded visible text", () => {
  const text = extractPostingText(`<!doctype html><html><head><style>.secret{}</style><script>ignore()</script></head>
    <body><h1>Senior Platform Engineer</h1><p>Build &amp; operate reliable systems.</p></body></html>`);
  assert.equal(text, "Senior Platform Engineer Build & operate reliable systems.");
  assert.equal(text.includes("ignore"), false);
  assert.throws(() => extractPostingText("<html><body> </body></html>"), /usable job-posting text/);
});

test("posting state distinguishes changed content and stale saved captures", () => {
  assert.equal(postingChangeState("same", "same"), "unchanged");
  assert.equal(postingChangeState("old", "new"), "changed");
  assert.equal(postingChangeState(undefined, "new"), "new");
  assert.equal(classifyPostingFreshness(1_000, 1_000 + 7 * 86_400_000), "current");
  assert.equal(classifyPostingFreshness(1_000, 1_000 + 7 * 86_400_000 + 1), "stale");
});

test("public import returns bounded inert content and revalidates redirects", async () => {
  const result = await fetchPublicBehavioralTargetSource({
    url: "https://jobs.example.com/platform/42",
    expectedFingerprint: "0".repeat(64),
  }, async () => new Response("<main><h1>Platform Engineer</h1><p>Build reliable systems.</p></main>", {
    headers: { "content-type": "text/html" },
  }), 1_786_464_000_000);
  assert.equal(result.status, "available");
  assert.equal(result.change, "changed");
  assert.equal(result.source.jdText, "Platform Engineer Build reliable systems.");
  assert.match(result.source.fingerprint, /^[a-f0-9]{64}$/);

  let requests = 0;
  await assert.rejects(() => fetchPublicBehavioralTargetSource({
    url: "https://jobs.example.com/platform/42",
  }, async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } });
  }), /public HTTPS job-posting URL/);
  assert.equal(requests, 1);
});
