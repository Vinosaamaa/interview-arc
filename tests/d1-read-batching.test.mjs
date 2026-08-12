import assert from "node:assert/strict";
import test from "node:test";

import {
  d1MaximumBoundParameters,
  d1ReadReservedParameterCount,
  d1SafeInClauseBatches,
  d1SafeInClauseBatchSize,
  readD1RowsInBatches,
} from "../db/d1-read-batching.ts";

test("D1-safe read batches preserve first-seen identity beyond 200 IDs", () => {
  const ids = Array.from({ length: 205 }, (_, index) => `activity-${String(index).padStart(3, "0")}`);
  const batches = [...d1SafeInClauseBatches([ids[0], "", ...ids, ids.at(-1)])];

  assert.equal(d1MaximumBoundParameters, 100);
  assert.equal(d1ReadReservedParameterCount, 20);
  assert.equal(d1SafeInClauseBatchSize, 80);
  assert.deepEqual(batches.map((batch) => batch.length), [80, 80, 45]);
  assert.deepEqual(batches.flat(), ids);
  assert.equal(batches.every((batch) => batch.length <= d1SafeInClauseBatchSize), true);
  assert.deepEqual([...d1SafeInClauseBatches([])], []);
  assert.deepEqual(
    [...d1SafeInClauseBatches(ids.slice(0, d1SafeInClauseBatchSize))].map((batch) => batch.length),
    [d1SafeInClauseBatchSize],
  );
  assert.deepEqual(
    [...d1SafeInClauseBatches(ids.slice(0, d1SafeInClauseBatchSize + 1))].map((batch) => batch.length),
    [d1SafeInClauseBatchSize, 1],
  );
});

test("batched D1 reads fail as one operation instead of returning a partial prefix", async () => {
  const attempted = [];
  await assert.rejects(
    readD1RowsInBatches(
      Array.from({ length: d1SafeInClauseBatchSize * 2 + 1 }, (_, index) => `id-${index}`),
      async (batch) => {
        attempted.push(batch);
        if (attempted.length === 2) throw new Error("simulated D1 batch failure");
        return batch;
      },
    ),
    /simulated D1 batch failure/,
  );
  assert.deepEqual(attempted.map((batch) => batch.length), [d1SafeInClauseBatchSize, d1SafeInClauseBatchSize]);
});
