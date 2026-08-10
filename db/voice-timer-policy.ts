export function voiceWorkbenchActivityProjection(
  sessions: Array<{ id: string; activityIds: string[] }>,
  availableActivityIds: string[],
) {
  const available = new Set(availableActivityIds);
  const seen = new Set<string>();
  const activityIds: string[] = [];
  const sessionIdByActivityId: Record<string, string> = {};

  for (const session of sessions) {
    for (const activityId of session.activityIds) {
      if (!available.has(activityId) || seen.has(activityId)) continue;
      seen.add(activityId);
      activityIds.push(activityId);
      sessionIdByActivityId[activityId] = session.id;
    }
  }
  for (const activityId of availableActivityIds) {
    if (seen.has(activityId)) continue;
    seen.add(activityId);
    activityIds.push(activityId);
  }

  return { activityIds, sessionIdByActivityId };
}
