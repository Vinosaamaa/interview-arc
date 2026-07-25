export type QuestionMetadataReference = {
  title: string;
  url: string;
  accessedAt: string;
};

export type CompanySignal = {
  company: string;
  window: string;
  frequencyScore: number;
  frequencyScale: number;
  capturedAt: string;
};

export type LeetCodeQuestionMetadata = {
  problemNumber?: number;
  difficulty?: "easy" | "medium" | "hard";
  acceptanceRate?: number;
  topics?: string[];
  companyTags?: string[];
  companySignals?: CompanySignal[];
  capturedAt: string;
  sources: QuestionMetadataReference[];
};

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
  if (metadata.problemNumber !== undefined && (!Number.isInteger(metadata.problemNumber) || metadata.problemNumber <= 0)) {
    throw new Error("LeetCode problemNumber must be a positive integer.");
  }
  if (metadata.acceptanceRate !== undefined && (!Number.isFinite(metadata.acceptanceRate) || metadata.acceptanceRate < 0 || metadata.acceptanceRate > 100)) {
    throw new Error("LeetCode acceptanceRate must be between 0 and 100.");
  }
  if (!Number.isFinite(Date.parse(metadata.capturedAt))) {
    throw new Error("LeetCode metadata capturedAt must be a valid date-time.");
  }
  if (metadata.sources.length === 0) {
    throw new Error("LeetCode metadata must cite at least one source actually consulted.");
  }
  for (const source of metadata.sources) {
    if (!source.title.trim() || !source.url.trim() || !Number.isFinite(Date.parse(source.accessedAt))) {
      throw new Error("Every LeetCode metadata source needs a title, URL, and valid access time.");
    }
  }
  for (const signal of metadata.companySignals ?? []) {
    if (!signal.company.trim() || !signal.window.trim() || signal.frequencyScore < 0 || signal.frequencyScale < 1 || signal.frequencyScore > signal.frequencyScale) {
      throw new Error("Company signals need a company, window, and a score within their positive scale.");
    }
    if (!Number.isFinite(Date.parse(signal.capturedAt))) {
      throw new Error("Company signal capturedAt must be a valid date-time.");
    }
  }
}

export function mergePersonalLeetCodeQuestionMetadata(
  existing: StoredQuestionMetadata,
  incoming: LeetCodeQuestionMetadata,
): StoredQuestionMetadata {
  validateLeetCodeQuestionMetadata(incoming);
  return {
    problemNumber: incoming.problemNumber ?? existing.problemNumber,
    difficulty: incoming.difficulty ?? existing.difficulty,
    acceptanceRate: incoming.acceptanceRate ?? existing.acceptanceRate,
    topics: trimmedUnique([...(existing.topics ?? []), ...(incoming.topics ?? [])]),
    companyTags: trimmedUnique([...(existing.companyTags ?? []), ...(incoming.companyTags ?? [])]),
    companySignals: mergeCompanySignals(existing.companySignals ?? [], incoming.companySignals ?? []),
    metadataReferences: mergeReferences(existing.metadataReferences ?? [], incoming.sources),
    metadataCapturedAt: Date.parse(incoming.capturedAt),
  };
}
