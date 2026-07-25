import { z } from "zod";

export const questionMetadataReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  accessedAt: z.string().datetime(),
});

export const companySignalSchema = z.object({
  company: z.string().min(1),
  window: z.string().min(1),
  frequencyScore: z.number().min(0),
  frequencyScale: z.number().positive(),
  capturedAt: z.string().datetime(),
}).refine((signal) => signal.frequencyScore <= signal.frequencyScale, {
  message: "frequencyScore cannot exceed frequencyScale",
});

export const leetCodeQuestionMetadataSchema = z.object({
  problemNumber: z.number().int().positive().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  acceptanceRate: z.number().min(0).max(100).optional(),
  topics: z.array(z.string().min(1)).max(64).optional(),
  companyTags: z.array(z.string().min(1)).max(64).optional(),
  companySignals: z.array(companySignalSchema).max(64).optional(),
  capturedAt: z.string().datetime(),
  sources: z.array(questionMetadataReferenceSchema).min(1).max(32),
});

export type QuestionMetadataReference = z.infer<typeof questionMetadataReferenceSchema>;
export type CompanySignal = z.infer<typeof companySignalSchema>;
export type LeetCodeQuestionMetadata = z.infer<typeof leetCodeQuestionMetadataSchema>;

export type StoredQuestionMetadata = {
  problemNumber: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  acceptanceRate: number | null;
  topics: string[];
  companyTags: string[];
  companySignals: CompanySignal[];
  metadataReferences: QuestionMetadataReference[];
  metadataCapturedAt: number | null;
};

export function readStoredQuestionMetadata(row: {
  problemNumber: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  acceptanceRate: number | null;
  topics: unknown;
  companyTags: unknown;
  companySignals: unknown;
  metadataReferences: unknown;
  metadataCapturedAt: number | null;
}): StoredQuestionMetadata {
  return {
    problemNumber: row.problemNumber,
    difficulty: row.difficulty,
    acceptanceRate: row.acceptanceRate,
    topics: Array.isArray(row.topics) ? row.topics as string[] : [],
    companyTags: Array.isArray(row.companyTags) ? row.companyTags as string[] : [],
    companySignals: Array.isArray(row.companySignals) ? row.companySignals as CompanySignal[] : [],
    metadataReferences: Array.isArray(row.metadataReferences) ? row.metadataReferences as QuestionMetadataReference[] : [],
    metadataCapturedAt: row.metadataCapturedAt,
  };
}

export function questionMetadataUpdateFields(metadata: StoredQuestionMetadata) {
  return {
    problemNumber: metadata.problemNumber,
    difficulty: metadata.difficulty,
    acceptanceRate: metadata.acceptanceRate,
    topics: metadata.topics,
    companyTags: metadata.companyTags,
    companySignals: metadata.companySignals,
    metadataReferences: metadata.metadataReferences,
    metadataCapturedAt: metadata.metadataCapturedAt,
  };
}

function trimmedUnique(values: string[], limit = 64) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  }).slice(0, limit);
}

function mergeReferences(
  existing: QuestionMetadataReference[],
  incoming: QuestionMetadataReference[],
) {
  const byUrl = new Map<string, QuestionMetadataReference>();
  for (const reference of [...existing, ...incoming]) {
    const url = reference.url.trim();
    if (!url) continue;
    byUrl.set(url, {
      title: reference.title.trim(),
      url,
      accessedAt: reference.accessedAt,
    });
  }
  return [...byUrl.values()].slice(0, 32);
}

function mergeCompanySignals(existing: CompanySignal[], incoming: CompanySignal[]) {
  const byIdentity = new Map<string, CompanySignal>();
  for (const signal of [...existing, ...incoming]) {
    const normalized = {
      ...signal,
      company: signal.company.trim(),
      window: signal.window.trim(),
    };
    if (!normalized.company || !normalized.window) continue;
    byIdentity.set(
      `${normalized.company.toLocaleLowerCase()}\u0000${normalized.window.toLocaleLowerCase()}\u0000${normalized.capturedAt}`,
      normalized,
    );
  }
  return [...byIdentity.values()].slice(0, 64);
}

export function validateLeetCodeQuestionMetadata(metadata: LeetCodeQuestionMetadata) {
  const result = leetCodeQuestionMetadataSchema.safeParse(metadata);
  if (!result.success) {
    throw new Error(`Invalid LeetCode question metadata: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
}

export function mergePersonalLeetCodeQuestionMetadata(
  existing: StoredQuestionMetadata,
  incoming: LeetCodeQuestionMetadata,
): StoredQuestionMetadata {
  validateLeetCodeQuestionMetadata(incoming);
  const incomingCapturedAt = Date.parse(incoming.capturedAt);
  const acceptsIncomingScalars = existing.metadataCapturedAt === null
    || incomingCapturedAt >= existing.metadataCapturedAt;
  return {
    problemNumber: acceptsIncomingScalars ? incoming.problemNumber ?? existing.problemNumber : existing.problemNumber,
    difficulty: acceptsIncomingScalars ? incoming.difficulty ?? existing.difficulty : existing.difficulty,
    acceptanceRate: acceptsIncomingScalars ? incoming.acceptanceRate ?? existing.acceptanceRate : existing.acceptanceRate,
    topics: trimmedUnique([...(existing.topics ?? []), ...(incoming.topics ?? [])]),
    companyTags: trimmedUnique([...(existing.companyTags ?? []), ...(incoming.companyTags ?? [])]),
    companySignals: mergeCompanySignals(existing.companySignals ?? [], incoming.companySignals ?? []),
    metadataReferences: mergeReferences(existing.metadataReferences ?? [], incoming.sources),
    metadataCapturedAt: Math.max(existing.metadataCapturedAt ?? 0, incomingCapturedAt),
  };
}
