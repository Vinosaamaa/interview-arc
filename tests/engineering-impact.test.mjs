import assert from "node:assert/strict";
import test from "node:test";

import { validateEngineeringImpact } from "../scripts/validate-engineering-impact.mjs";

const checks = {
  none: "- [x] None — reason: This change only corrects non-engineering copy.",
  review: "- [x] Architecture Review",
};

test("forward changes require exactly one PR impact classification", () => {
  assert.throws(
    () => validateEngineeringImpact({ body: "", changedFiles: ["README.md"], recordTypes: [] }),
    /exactly one/,
  );
  assert.throws(
    () => validateEngineeringImpact({ body: `${checks.none}\n${checks.review}`, changedFiles: ["README.md"], recordTypes: [] }),
    /exactly one/,
  );
});

test("None requires a concrete reason and cannot hide a canonical record", () => {
  assert.throws(
    () => validateEngineeringImpact({ body: "- [x] None — reason: TODO", changedFiles: ["README.md"], recordTypes: [] }),
    /concrete reason/,
  );
  assert.equal(
    validateEngineeringImpact({ body: checks.none, changedFiles: ["README.md"], recordTypes: [] }).classification,
    "none",
  );
  assert.throws(
    () => validateEngineeringImpact({ body: checks.none, changedFiles: ["docs/engineering/records/review.md"], recordTypes: ["architecture-review"] }),
    /cannot be `None`/,
  );
});

test("rich classifications require one matching canonical record type", () => {
  assert.equal(
    validateEngineeringImpact({
      body: checks.review,
      changedFiles: ["docs/engineering/records/review.md"],
      recordTypes: ["architecture-review"],
    }).classification,
    "architecture-review",
  );
  assert.throws(
    () => validateEngineeringImpact({ body: checks.review, changedFiles: ["app/page.tsx"], recordTypes: [] }),
    /requires a matching/,
  );
  assert.throws(
    () => validateEngineeringImpact({
      body: checks.review,
      changedFiles: ["docs/engineering/records/postmortem.md"],
      recordTypes: ["postmortem"],
    }),
    /does not match/,
  );
});
