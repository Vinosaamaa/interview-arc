import type { LocalDraft } from "./live-types";
import type { PracticeStateCommand } from "../db/practice-state-commands";

// The display cache is not a creation log. Only an explicitly queued write
// may retain an optimistic row after an authoritative read.
export function reconcileWorkbenchCache(server: LocalDraft, local: LocalDraft, queue: readonly PracticeStateCommand[]) {
  const currentId = server.workbench?.id;
  const historicalIds = new Set([
    ...server.historyActivities,
    ...server.historySessions,
    ...server.historyFocusBlocks,
  ].filter((row) => row.workbenchId && row.workbenchId !== currentId).map((row) => row.id));
  const mutations = queue.filter((mutation) => {
    const row = mutation.type === "extra-upsert" ? mutation.activity
      : mutation.type === "session-upsert" ? mutation.session
        : mutation.type === "focus-block-upsert" ? mutation.block : null;
    if (!row) return true;
    const originatingWorkbench = row.workbenchId ?? local.workbench?.id;
    return !historicalIds.has(row.id) && (!originatingWorkbench || originatingWorkbench === currentId);
  });
  const extraActivities = new Map(server.extraActivities.map((row) => [row.id, row]));
  const sessions = new Map(server.sessions.map((row) => [row.id, row]));
  const focusBlocks = new Map(server.focusBlocks.map((row) => [row.id, row]));
  for (const mutation of mutations) {
    if (mutation.type === "extra-upsert") extraActivities.set(mutation.activity.id, mutation.activity);
    if (mutation.type === "session-upsert") sessions.set(mutation.session.id, mutation.session);
    if (mutation.type === "focus-block-upsert") {
      const row = local.focusBlocks.find((block) => block.id === mutation.block.id);
      if (row) focusBlocks.set(row.id, row);
    }
  }
  return {
    mutations,
    merged: {
      ...server,
      extraActivities: [...extraActivities.values()],
      sessions: [...sessions.values()],
      focusBlocks: [...focusBlocks.values()],
    },
  };
}
