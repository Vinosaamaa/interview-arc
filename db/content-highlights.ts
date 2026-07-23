import { and, eq } from "drizzle-orm";
import { getDb } from "./index";
import { contentHighlights } from "./schema";

export type HighlightScope = "activity" | "solution";

export async function readContentHighlights(ownerId: string, scopeType: HighlightScope, scopeId: string) {
  return getDb().select().from(contentHighlights).where(and(
    eq(contentHighlights.ownerId, ownerId),
    eq(contentHighlights.scopeType, scopeType),
    eq(contentHighlights.scopeId, scopeId),
  ));
}

export async function addContentHighlight(ownerId: string, input: Omit<typeof contentHighlights.$inferInsert, "ownerId">) {
  await getDb().insert(contentHighlights).values({ ownerId, ...input });
}

export async function deleteContentHighlight(ownerId: string, id: string) {
  await getDb().delete(contentHighlights).where(and(eq(contentHighlights.ownerId, ownerId), eq(contentHighlights.id, id)));
}

export async function updateContentHighlightNote(ownerId: string, id: string, note: string, timestamp: number) {
  const rows = await getDb().update(contentHighlights)
    .set({ note, updatedAt: timestamp })
    .where(and(eq(contentHighlights.ownerId, ownerId), eq(contentHighlights.id, id)))
    .returning();
  return rows[0];
}
