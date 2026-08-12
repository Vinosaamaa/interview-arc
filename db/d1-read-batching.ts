// Cloudflare D1 accepts at most 100 bound parameters per query. Keep
// owner-scoped IN reads below that ceiling while reserving parameters for
// owner, status, and future predicates.
export const d1MaximumBoundParameters = 100;
export const d1ReadReservedParameterCount = 20;
export const d1SafeInClauseBatchSize = d1MaximumBoundParameters - d1ReadReservedParameterCount;

export function d1SafeInClauseBatches(ids: readonly string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const batches: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += d1SafeInClauseBatchSize) {
    batches.push(uniqueIds.slice(index, index + d1SafeInClauseBatchSize));
  }
  return batches;
}

export async function readD1RowsInBatches<Row>(
  ids: readonly string[],
  readBatch: (batch: string[]) => PromiseLike<readonly Row[]>,
) {
  const rows: Row[] = [];
  for (const batch of d1SafeInClauseBatches(ids)) {
    rows.push(...await readBatch(batch));
  }
  return rows;
}
