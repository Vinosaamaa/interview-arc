export { foldElapsed, nextTimerState, type StoredTimer } from "./timer-state.ts";

export function orderContiguousTurns<T extends { sequence: number }>(turns: T[], expectedFirst?: number) {
  const ordered = [...turns].sort((left, right) => left.sequence - right.sequence);
  const contiguous = ordered.length > 0
    && (expectedFirst === undefined || ordered[0].sequence === expectedFirst)
    && ordered.every((turn, index) => index === 0 || turn.sequence === ordered[index - 1].sequence + 1);
  return { ordered, contiguous };
}
