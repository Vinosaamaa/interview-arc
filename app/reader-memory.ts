export type ReaderMemory = {
  groups: Record<string, boolean>;
  anchorId?: string;
  anchorOffset?: number;
  scrollTop?: number;
};

export type ReaderMemoryState = Record<string, ReaderMemory>;

export const MAX_READER_MEMORY_ENTRIES = 50;
const MAX_READER_GROUPS = 64;
const MAX_READER_KEY_LENGTH = 512;
const MAX_ANCHOR_ID_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeReaderMemory(value: unknown): ReaderMemory | null {
  if (!isRecord(value) || !isRecord(value.groups)) return null;
  const groupEntries = Object.entries(value.groups)
    .filter((entry): entry is [string, boolean] => entry[0].length > 0 && entry[0].length <= MAX_ANCHOR_ID_LENGTH && typeof entry[1] === "boolean")
    .slice(-MAX_READER_GROUPS);
  const anchorId = typeof value.anchorId === "string" && value.anchorId.length <= MAX_ANCHOR_ID_LENGTH
    ? value.anchorId
    : undefined;
  const anchorOffset = finiteNumber(value.anchorOffset);
  const scrollTop = finiteNumber(value.scrollTop);
  return {
    groups: Object.fromEntries(groupEntries),
    ...(anchorId ? { anchorId } : {}),
    ...(anchorOffset !== undefined ? { anchorOffset } : {}),
    ...(scrollTop !== undefined ? { scrollTop } : {}),
  };
}

function validReaderMemory(value: unknown): value is ReaderMemory {
  if (!isRecord(value) || !isRecord(value.groups)) return false;
  const knownKeys = new Set(["groups", "anchorId", "anchorOffset", "scrollTop"]);
  if (Object.keys(value).some((key) => !knownKeys.has(key))) return false;
  const groupEntries = Object.entries(value.groups);
  if (groupEntries.length > MAX_READER_GROUPS || groupEntries.some(([key, open]) =>
    !key || key.length > MAX_ANCHOR_ID_LENGTH || typeof open !== "boolean")) return false;
  if (value.anchorId !== undefined && (typeof value.anchorId !== "string" || value.anchorId.length > MAX_ANCHOR_ID_LENGTH)) return false;
  if (value.anchorOffset !== undefined && finiteNumber(value.anchorOffset) === undefined) return false;
  if (value.scrollTop !== undefined && finiteNumber(value.scrollTop) === undefined) return false;
  return true;
}

export function normalizeReaderMemoryState(value: unknown): ReaderMemoryState {
  if (!isRecord(value)) return {};
  const sourceEntries = Object.entries(value);
  const retained = sourceEntries
    .filter(([readerKey]) => readerKey.length > 0 && readerKey.length <= MAX_READER_KEY_LENGTH)
    .slice(-MAX_READER_MEMORY_ENTRIES);
  if (retained.length === sourceEntries.length && retained.every(([, memory]) => validReaderMemory(memory))) {
    return value as ReaderMemoryState;
  }
  return Object.fromEntries(retained.flatMap(([readerKey, memory]) => {
    const normalized = normalizeReaderMemory(memory);
    return normalized ? [[readerKey, normalized]] : [];
  }));
}

function writeReaderMemory(
  memory: ReaderMemoryState,
  readerKey: string,
  nextReader: ReaderMemory,
): ReaderMemoryState {
  const normalized = normalizeReaderMemoryState(memory);
  if (!readerKey || readerKey.length > MAX_READER_KEY_LENGTH) return normalized;
  const retained = Object.entries(normalized)
    .filter(([key]) => key !== readerKey)
    .slice(-(MAX_READER_MEMORY_ENTRIES - 1));
  return Object.fromEntries([
    ...retained,
    [readerKey, normalizeReaderMemory(nextReader) ?? { groups: {} }],
  ]);
}

export function rememberReaderGroup(
  memory: ReaderMemoryState,
  readerKey: string,
  groupId: string,
  open: boolean,
): ReaderMemoryState {
  const normalized = normalizeReaderMemoryState(memory);
  const currentReader = normalizeReaderMemory(normalized[readerKey]) ?? { groups: {} };
  if (normalized === memory && currentReader.groups[groupId] === open) return memory;

  return writeReaderMemory(normalized, readerKey, {
    ...currentReader,
    groups: {
      ...currentReader.groups,
      [groupId]: open,
    },
  });
}

export function rememberEveryReaderGroup(
  memory: ReaderMemoryState,
  readerKey: string,
  groupIds: readonly string[],
  open: boolean,
): ReaderMemoryState {
  const normalized = normalizeReaderMemoryState(memory);
  const currentReader = normalizeReaderMemory(normalized[readerKey]) ?? { groups: {} };
  if (normalized === memory && groupIds.every((groupId) => currentReader.groups[groupId] === open)) {
    return memory;
  }

  return writeReaderMemory(normalized, readerKey, {
    ...currentReader,
    groups: {
      ...currentReader.groups,
      ...Object.fromEntries(groupIds.map((groupId) => [groupId, open])),
    },
  });
}

export function rememberReaderPosition(
  memory: ReaderMemoryState,
  readerKey: string,
  position: Pick<ReaderMemory, "scrollTop" | "anchorId" | "anchorOffset">,
): ReaderMemoryState {
  const normalized = normalizeReaderMemoryState(memory);
  const currentReader = normalizeReaderMemory(normalized[readerKey]) ?? { groups: {} };
  return writeReaderMemory(normalized, readerKey, {
    ...currentReader,
    ...position,
  });
}
