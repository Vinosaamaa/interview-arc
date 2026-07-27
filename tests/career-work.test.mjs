import assert from "node:assert/strict";
import test from "node:test";

import {
  careerHeatLevel,
  normalizeCareerSummary,
  normalizeJobPage,
  splitIntervalByPacificDate,
} from "../app/career-work.ts";

test("career intervals crossing Pacific midnight are split across both dates", () => {
  const parts = splitIntervalByPacificDate(
    Date.parse("2026-07-28T06:45:00.000Z"),
    Date.parse("2026-07-28T07:15:00.000Z"),
  );
  assert.deepEqual(parts, [
    { date: "2026-07-27", seconds: 900 },
    { date: "2026-07-28", seconds: 900 },
  ]);
});

test("career heat levels use the approved elapsed-minute legend", () => {
  assert.equal(careerHeatLevel(0), 0);
  assert.equal(careerHeatLevel(29 * 60), 1);
  assert.equal(careerHeatLevel(30 * 60), 2);
  assert.equal(careerHeatLevel(60 * 60), 3);
  assert.equal(careerHeatLevel(2 * 60 * 60), 4);
  assert.equal(careerHeatLevel(2 * 60 * 60 + 1), 5);
});

test("Job Journey summary preserves submitted semantics and rejects malformed totals", () => {
  const summary = normalizeCareerSummary({
    schemaVersion: 1,
    generatedAt: "2026-07-27T18:42:00.000Z",
    sourceUpdatedAt: "2026-07-27T18:40:18.000Z",
    timeZone: "America/Los_Angeles",
    range: { from: "2026-07-01", to: "2026-07-31" },
    totals: {
      submitted: 132,
      interviewing: 4,
      offers: 1,
      rejected: 28,
      applying: 3,
      needsAttention: 2,
      failed: 9,
      skipped: 71,
      awaitingReferral: 12,
      referred: 5,
    },
    currentStatusCounts: {
      saved: 14,
      applying: 3,
      needs_attention: 2,
      applied: 94,
      interview: 4,
      offer: 1,
      rejected: 28,
      failed: 9,
      skipped: 71,
      referral: 12,
      referred: 5,
    },
    daily: [{ date: "2026-07-27", submitted: 5, referred: 0 }],
    bySource: { linkedin: 31 },
  });
  assert.equal(summary.totals.submitted, 132);
  assert.throws(() => normalizeCareerSummary({ ...summary, totals: { ...summary.totals, submitted: -1 } }));
});

test("Job Journey job projection strips unapproved fields and validates status", () => {
  const page = normalizeJobPage({
    schemaVersion: 1,
    generatedAt: "2026-07-27T18:42:00.000Z",
    jobs: [{
      id: "job-1",
      externalJobId: "123456",
      company: "Google",
      title: "Software Engineer",
      location: "Mountain View, CA",
      source: "linkedin",
      status: "interview",
      referralOnly: false,
      jobUrl: "https://example.com/job/123456",
      postedAt: "2026-07-21T16:00:00.000Z",
      appliedAt: "2026-07-23T18:15:00.000Z",
      referredAt: null,
      statusUpdatedAt: "2026-07-26T20:10:00.000Z",
      timelineAt: "2026-07-23T18:15:00.000Z",
      privateNotes: "must never cross the boundary",
    }],
    page: { nextCursor: null, hasMore: false },
  });
  assert.equal(page.jobs[0].company, "Google");
  assert.equal("privateNotes" in page.jobs[0], false);
  assert.throws(() => normalizeJobPage({
    ...page,
    jobs: [{ ...page.jobs[0], status: "unknown_status" }],
  }));
});
