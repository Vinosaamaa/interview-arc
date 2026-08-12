import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralProjectBindingWriteSchema,
  behavioralProjectProfileMissingRequirements,
  PROJECT_OVERVIEW_SECTION_KEYS,
  RESUME_CLAIM_SECTION_KEYS,
} from "../db/behavioral-project-deep-dive-policy.ts";

const overviewBinding = {
  projectId: "sample-platform",
  bindingRevision: 2,
  focus: "project_overview",
};

test("Project Deep Dive bindings require explicit stable identity and typed claim scope", () => {
  assert.doesNotThrow(() => behavioralProjectBindingWriteSchema.parse({
    operationId: "bind-sample-platform-1",
    questionId: "experience-map-sample-platform",
    expectedRevision: 0,
    projectId: "sample-platform",
    focus: "project_overview",
    state: "active",
    reason: "Bind the exact project overview.",
    authorization: "behavioral_specialist",
  }));
  assert.throws(() => behavioralProjectBindingWriteSchema.parse({
    operationId: "bind-claim-1",
    questionId: "sample-platform-claim",
    expectedRevision: 0,
    projectId: "sample-platform",
    focus: "resume_claim",
    reason: "Missing exact claim identity.",
    authorization: "behavioral_specialist",
  }));
  assert.throws(() => behavioralProjectBindingWriteSchema.parse({
    operationId: "bind-overview-claim-1",
    questionId: "experience-map-sample-platform",
    expectedRevision: 0,
    projectId: "sample-platform",
    focus: "project_overview",
    sourceClaimId: "claim-sample-platform",
    reason: "A project overview cannot impersonate a claim drill.",
    authorization: "behavioral_specialist",
  }));
});

test("overview and resume-claim profiles require stable keyed sections in contract order", () => {
  const overview = {
    projectDeepDive: overviewBinding,
    sections: PROJECT_OVERVIEW_SECTION_KEYS.map((sectionKey) => ({ sectionKey })),
  };
  assert.deepEqual(behavioralProjectProfileMissingRequirements(overview, overviewBinding), []);
  assert.deepEqual(
    behavioralProjectProfileMissingRequirements({
      ...overview,
      sections: [...overview.sections].reverse(),
    }, overviewBinding),
    ["required Project Deep Dive sections in contract order"],
  );
  assert.deepEqual(
    behavioralProjectProfileMissingRequirements({
      ...overview,
      sections: overview.sections.map(() => ({})),
    }, overviewBinding),
    ["stable sectionKey on every Project Deep Dive section"],
  );

  const claimBinding = {
    projectId: "sample-platform",
    bindingRevision: 3,
    focus: "resume_claim",
    sourceClaimId: "claim-sample-platform",
  };
  const claimProfile = {
    projectDeepDive: claimBinding,
    sections: RESUME_CLAIM_SECTION_KEYS.map((sectionKey) => ({ sectionKey })),
  };
  assert.deepEqual(behavioralProjectProfileMissingRequirements(claimProfile, claimBinding), []);
  assert.deepEqual(
    behavioralProjectProfileMissingRequirements(claimProfile, { ...claimBinding, bindingRevision: 4 }),
    ["current Project Deep Dive binding revision"],
  );
});

test("unbound Behavioral profiles cannot smuggle Project Deep Dive identity", () => {
  assert.deepEqual(behavioralProjectProfileMissingRequirements({
    projectDeepDive: overviewBinding,
    sections: PROJECT_OVERVIEW_SECTION_KEYS.map((sectionKey) => ({ sectionKey })),
  }, null), ["an active Project Deep Dive question binding"]);
});
