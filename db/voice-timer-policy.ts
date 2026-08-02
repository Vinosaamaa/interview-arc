export function voiceTimerActivityIds(
  sessionActivityIds: string[] | null,
  focusedActivityId: string | null,
): string[] {
  return sessionActivityIds ?? (focusedActivityId ? [focusedActivityId] : []);
}
