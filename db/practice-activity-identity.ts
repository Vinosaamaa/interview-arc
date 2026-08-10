import { and, eq } from "drizzle-orm";
import type { JournalActivity } from "../app/content-types";
import { loadContentIndex } from "./content";
import { getDb } from "./index";
import { extraActivities } from "./schema";

function activityIdentity(activity: JournalActivity) {
  return {
    activityId: activity.id,
    specialty: activity.type,
    phase: activity.status === "planned"
      ? "fresh_attempt" as const
      : activity.status === "completed"
        ? "review" as const
        : "active_attempt" as const,
  };
}

export async function readPracticeActivityIdentity(ownerId: string, activityId: string) {
  const rows = await getDb().select({ payload: extraActivities.payload })
    .from(extraActivities)
    .where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, activityId),
    ))
    .limit(1);
  const ownerActivity = rows[0]?.payload as JournalActivity | undefined;
  if (ownerActivity?.id === activityId) return activityIdentity(ownerActivity);

  // Daily/versioned activities are shared content rather than owner rows.
  // Only this bounded fallback needs the content projection.
  const content = await loadContentIndex();
  const published = content.journals
    .flatMap((journal) => journal.activities)
    .find((activity) => activity.id === activityId);
  return published ? activityIdentity(published) : null;
}
