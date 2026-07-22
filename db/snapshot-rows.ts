export function dedupeSnapshotRows<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  rows.forEach((row) => byId.set(row.id, row));
  return [...byId.values()];
}
