---
schemaVersion: 1
id: postmortem-access-team-domain-change
revision: 1
type: postmortem
status: accepted
title: Restore login after an Access team domain change
repository: interview-arc
capabilityIds: ["website-access-authentication"]
createdAt: 2026-09-07
reconstructed: false
confidence: verified
unknowns: ["The time and origin of the team-domain change were not established."]
modules: ["Website authentication"]
interfaces: ["Cloudflare Access signed login tokens"]
seams: ["Google OAuth callback to Cloudflare Access", "Access token issuer to Worker configuration"]
adapters: ["wrangler.jsonc", "worker/index.ts"]
relatedRecords: []
decisions: []
incidents: []
features: []
capabilities: ["website-access-authentication"]
amends: []
supersedes: []
learningRefs: []
sources: [{"label":"Login incident #431","url":"https://github.com/Vinosaamaa/interview-arc/issues/431","kind":"issue"},{"label":"Pull request #432","url":"https://github.com/Vinosaamaa/interview-arc/pull/432","kind":"pull-request"}]
verification: {"state":"verified","evidenceRefs":["issue:431","pull-request:432"]}
visibility: public-safe
publicationEligibility: eligible
issue: 431
pr: 432
release: null
run: null
---
# Restore login after an Access team domain change

Restored website login by aligning the Google callback and trusted Worker issuer with the current Cloudflare Access team domain, while preserving token validation and access policies.

## Impact and cause

Google rejected login with `redirect_uri_mismatch` after the live Access team domain diverged from the registered callback. Updating the Google callback allowed sign-in to complete, but the website then returned `Unauthorized`: its deployed `TEAM_DOMAIN` still named the former issuer. The existing exact issuer check correctly rejected that mismatch. The checked-in deployment configuration also retained the former domain.

## Repair and evidence

The owner corrected the Google callback. The production repair changed only the Worker's trusted team-domain binding. Cloudflare settings read-back confirmed the other bindings and runtime settings were preserved, and the owner confirmed the dashboard opened. This PR makes the same binding correction durable in source.

A focused test exercised the existing verifier using generated RSA-signed tokens: the old binding reproduced rejection and the corrected binding accepted the valid current-team token. Wrong issuer, wrong audience, expired, tampered, and missing tokens remained rejected. The incident involved denied access; authentication validation was not bypassed and no data mutation was part of the repair.

## Prevention and rollback

Treat a team-domain rename as one coordinated configuration change: update the Google callback, the checked-in Worker binding, and the deployed binding, then complete an authenticated dashboard load. A settings-only emergency repair must be followed by the matching source change before the next deployment. Revert the binding only together with an intentional Access team rollback; reverting it alone recreates the outage.

The initial settings PATCH was rejected without mutation because this endpoint accepts only the literal `latest` for inherited bindings. The successful request first verified that the latest version was the active deployment. Full source-merge and release verification remain tracked in issue #431.
