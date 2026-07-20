import { asc } from "drizzle-orm";
import { getDb } from "./index";
import { contentArtifacts, contentBank, contentJournals, contentStories } from "./schema";
import type {
  ContentArtifact,
  ContentIndex,
  DailyJournal,
  QuestionBankItem,
  QuestionBanks,
  StoryProject,
} from "../app/content-types";

// Reconstructs the ContentIndex shape the app consumes from the D1 content
// tables (populated by scripts/import-content.mjs). Ordering mirrors the
// build-time index: journals/artifacts by date, bank/stories by stored `ord`.
export async function loadContentIndex(): Promise<ContentIndex> {
  const db = getDb();
  const [journalRows, artifactRows, storyRows, bankRows] = await Promise.all([
    db.select().from(contentJournals),
    db.select().from(contentArtifacts),
    db.select().from(contentStories).orderBy(asc(contentStories.ord)),
    db.select().from(contentBank).orderBy(asc(contentBank.category), asc(contentBank.ord)),
  ]);

  const journals = journalRows
    .map((row) => row.payload as DailyJournal)
    .sort((left, right) => right.date.localeCompare(left.date));

  const artifacts = artifactRows
    .map((row) => row.payload as ContentArtifact)
    .sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title));

  const stories = storyRows.map((row) => row.payload as StoryProject);

  const questionBanks: QuestionBanks = { leetcode: [], systemDesign: [], behavioral: [] };
  for (const row of bankRows) {
    const category = row.category as keyof QuestionBanks;
    if (questionBanks[category]) questionBanks[category].push(row.payload as QuestionBankItem);
  }

  return { journals, artifacts, stories, questionBanks };
}
