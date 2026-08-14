export type ReaderMemory = {
  groups: Record<string, boolean>;
  anchorId?: string;
  anchorOffset?: number;
  scrollTop?: number;
};

export type ReaderMemoryState = Record<string, ReaderMemory>;

export function rememberReaderGroup(
  memory: ReaderMemoryState,
  readerKey: string,
  groupId: string,
  open: boolean,
): ReaderMemoryState {
  const currentReader = memory[readerKey];
  if (currentReader?.groups[groupId] === open) return memory;

  return {
    ...memory,
    [readerKey]: {
      ...(currentReader ?? { groups: {} }),
      groups: {
        ...(currentReader?.groups ?? {}),
        [groupId]: open,
      },
    },
  };
}

export function rememberEveryReaderGroup(
  memory: ReaderMemoryState,
  readerKey: string,
  groupIds: readonly string[],
  open: boolean,
): ReaderMemoryState {
  if (groupIds.every((groupId) => memory[readerKey]?.groups[groupId] === open)) {
    return memory;
  }

  return {
    ...memory,
    [readerKey]: {
      ...(memory[readerKey] ?? { groups: {} }),
      groups: {
        ...(memory[readerKey]?.groups ?? {}),
        ...Object.fromEntries(groupIds.map((groupId) => [groupId, open])),
      },
    },
  };
}
