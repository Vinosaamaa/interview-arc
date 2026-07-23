import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./index";
import { contentHighlightNotes, contentHighlights } from "./schema";

export type HighlightScope = "activity" | "solution";

export async function readContentHighlights(ownerId: string, scopeType: HighlightScope, scopeId: string) {
  const highlights = await getDb().select().from(contentHighlights).where(and(
    eq(contentHighlights.ownerId, ownerId),
    eq(contentHighlights.scopeType, scopeType),
    eq(contentHighlights.scopeId, scopeId),
  ));
  if (!highlights.length) return [];
  const notes = await getDb().select().from(contentHighlightNotes).where(and(
    eq(contentHighlightNotes.ownerId, ownerId),
    inArray(contentHighlightNotes.highlightId, highlights.map((highlight) => highlight.id)),
  ));
  return highlights.map((highlight) => ({
    ...highlight,
    notes: notes
      .filter((note) => note.highlightId === highlight.id)
      .sort((left, right) => left.createdAt - right.createdAt),
  }));
}

export async function addContentHighlight(ownerId: string, input: Omit<typeof contentHighlights.$inferInsert, "ownerId">) {
  await getDb().insert(contentHighlights).values({ ownerId, ...input });
}

export async function deleteContentHighlight(ownerId: string, id: string) {
  await getDb().delete(contentHighlightNotes).where(and(
    eq(contentHighlightNotes.ownerId, ownerId),
    eq(contentHighlightNotes.highlightId, id),
  ));
  await getDb().delete(contentHighlights).where(and(eq(contentHighlights.ownerId, ownerId), eq(contentHighlights.id, id)));
}

export async function addContentHighlightNote(ownerId: string, input: Omit<typeof contentHighlightNotes.$inferInsert, "ownerId">) {
  const highlight = await getDb().select({ id: contentHighlights.id }).from(contentHighlights).where(and(
    eq(contentHighlights.ownerId, ownerId),
    eq(contentHighlights.id, input.highlightId),
  )).limit(1);
  if (!highlight.length) return undefined;
  const rows = await getDb().insert(contentHighlightNotes)
    .values({ ownerId, ...input })
    .returning();
  return rows[0];
}

export async function updateContentHighlightNote(ownerId: string, id: string, body: string, timestamp: number) {
  const rows = await getDb().update(contentHighlightNotes)
    .set({ body, updatedAt: timestamp })
    .where(and(eq(contentHighlightNotes.ownerId, ownerId), eq(contentHighlightNotes.id, id)))
    .returning();
  return rows[0];
}

export async function deleteContentHighlightNote(ownerId: string, id: string) {
  await getDb().delete(contentHighlightNotes).where(and(
    eq(contentHighlightNotes.ownerId, ownerId),
    eq(contentHighlightNotes.id, id),
  ));
}
