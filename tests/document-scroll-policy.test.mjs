import assert from "node:assert/strict";
import test from "node:test";

import { acquireDocumentScrollLock, documentScrollLockRequired } from "../app/document-scroll-policy.ts";

const entered = {
  arrivalState: "entered",
  pastReaderOpen: false,
  bankReaderOpen: false,
  journeyReaderOpen: false,
  reviewReaderOpen: false,
};

test("arrival owns the document lock until the workspace is entered", () => {
  assert.equal(documentScrollLockRequired({ ...entered, arrivalState: "show", view: "today" }), true);
  assert.equal(documentScrollLockRequired({ ...entered, arrivalState: "leaving", view: "today" }), true);
  assert.equal(documentScrollLockRequired({ ...entered, view: "today" }), false);
});

test("only a reader visible in the active workspace can lock document scroll", () => {
  assert.equal(documentScrollLockRequired({ ...entered, view: "library", pastReaderOpen: true }), true);
  assert.equal(documentScrollLockRequired({ ...entered, view: "banks", bankReaderOpen: true }), true);
  assert.equal(documentScrollLockRequired({ ...entered, view: "journey", journeyReaderOpen: true }), true);
  assert.equal(documentScrollLockRequired({ ...entered, view: "reviews", reviewReaderOpen: true }), true);

  assert.equal(documentScrollLockRequired({ ...entered, view: "reviews", pastReaderOpen: true }), false);
  assert.equal(documentScrollLockRequired({ ...entered, view: "journey", pastReaderOpen: true }), false);
  assert.equal(documentScrollLockRequired({ ...entered, view: "reviews", bankReaderOpen: true }), false);
  assert.equal(documentScrollLockRequired({ ...entered, view: "library", journeyReaderOpen: true }), false);
  assert.equal(documentScrollLockRequired({ ...entered, view: "journey", reviewReaderOpen: true }), false);
});

test("rapid tab switching releases and reacquires the lock without discarding reader memory", () => {
  const retainedPastReader = { ...entered, pastReaderOpen: true };
  const states = ["library", "reviews", "journey", "library"].map((view) =>
    documentScrollLockRequired({ ...retainedPastReader, view })
  );

  assert.deepEqual(states, [true, false, false, true]);
});

test("overlapping scroll-lock leases restore overflow only after the final owner releases", () => {
  const style = { overflow: "auto" };
  const releaseReader = acquireDocumentScrollLock(style);
  const releaseDiagram = acquireDocumentScrollLock(style);
  assert.equal(style.overflow, "hidden");

  releaseReader();
  assert.equal(style.overflow, "hidden");
  releaseReader();
  assert.equal(style.overflow, "hidden", "release must be idempotent");

  releaseDiagram();
  assert.equal(style.overflow, "auto");
});
