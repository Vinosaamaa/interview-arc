import assert from "node:assert/strict";
import test from "node:test";

import { ReaderDiagnosticBuffer, readerDiagnosticEnabled } from "../app/reader-render-diagnostics.ts";

test("reader diagnostics are explicitly opt-in", () => {
  assert.equal(readerDiagnosticEnabled("?readerDebug=1"), true);
  assert.equal(readerDiagnosticEnabled("?readerDebug=0"), false);
  assert.equal(readerDiagnosticEnabled(""), false);
});

test("reader diagnostics are bounded and redact arbitrary text", () => {
  const buffer = new ReaderDiagnosticBuffer();
  for (let index = 0; index < 340; index += 1) {
    buffer.record({
      at: index + 0.12345,
      kind: index === 339 ? "unsafe event with spaces" : "commit",
      surface: index === 339 ? "private/activity/id" : "past",
      detail: {
        count: index,
        privateText: "candidate@example.com",
        phase: "mounted",
      },
    });
  }

  const snapshot = buffer.snapshot();
  assert.equal(snapshot.events.length, 300);
  assert.equal(snapshot.frozen, false);
  assert.equal(snapshot.events[0].detail?.count, 40);
  assert.equal(snapshot.events.at(-1)?.kind, "unknown");
  assert.equal(snapshot.events.at(-1)?.surface, "unknown");
  assert.equal(snapshot.events.at(-1)?.detail?.privateText, "unknown");
  assert.equal(snapshot.events.at(-1)?.detail?.phase, "mounted");
  assert.doesNotMatch(JSON.stringify(snapshot), /candidate@example\.com|private\/activity/);
});

test("mark flash freezes the preceding rolling window until reset", () => {
  const buffer = new ReaderDiagnosticBuffer();
  buffer.record({ at: 1, kind: "visual-state", surface: "past-attempt" });
  buffer.markFlash("past-attempt");
  buffer.record({ at: 2, kind: "visual-state", surface: "past-attempt" });

  assert.equal(buffer.snapshot().frozen, true);
  assert.deepEqual(buffer.snapshot().events.map((event) => event.kind), [
    "visual-state",
    "flash-marker-manual",
  ]);

  const restored = new ReaderDiagnosticBuffer(buffer.snapshot());
  assert.equal(restored.snapshot().frozen, true);
  assert.equal(restored.snapshot().events.length, 2);

  restored.reset();
  restored.record({ at: 3, kind: "reader-open", surface: "banks-solution" });
  assert.equal(restored.snapshot().frozen, false);
  assert.deepEqual(restored.snapshot().events.map((event) => event.kind), ["reader-open"]);
});

test("a reset trace accepts a fresh baseline before a later flash marker", () => {
  const buffer = new ReaderDiagnosticBuffer();
  buffer.recordVisualHeartbeat("past-attempt", { mounted: true }, 1);
  buffer.resetWithBaseline("past-attempt", { mounted: true, runningPetalAnimations: 0 }, 2);
  buffer.captureFlash("past-attempt", { mounted: true, opacity: 1 }, false, 3);

  assert.deepEqual(buffer.snapshot().events.map((event) => event.kind), [
    "trace-reset",
    "visual-baseline",
    "flash-capture",
    "flash-marker-manual",
  ]);
  assert.equal(buffer.snapshot().events[1].detail?.mounted, true);
  assert.equal(buffer.snapshot().events[2].detail?.opacity, 1);
  assert.equal(buffer.snapshot().frozen, true);

  buffer.recordVisualHeartbeat("past-attempt", { opacity: 0 }, 4);
  assert.equal(buffer.snapshot().events.length, 4);
});
