import type { ActivityType } from "./live-types";

export const BANK_INITIAL_VISIBLE_COUNT = 36;
export const BANK_VISIBLE_CHUNK_SIZE = 36;

type BankAttemptIdentity = {
  type: ActivityType;
  questionId?: string;
  title: string;
  url?: string;
  date: string;
  endedAt?: string;
};

type BankQuestionIdentity = {
  id: string;
  title: string;
  url?: string;
};

export type LatestBankAttemptIndex<T extends BankAttemptIdentity> = {
  byId: Map<string, T>;
  byUrl: Map<string, T>;
  byTitle: Map<string, T>;
};

function normalizedIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedUrl(value: string) {
  return value.replace(/\/$/, "").toLowerCase();
}

function attemptTimestamp(attempt: BankAttemptIdentity) {
  const timestamp = Date.parse(attempt.endedAt ?? `${attempt.date}T23:59:59Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newest<T extends BankAttemptIdentity>(left: T | undefined, right: T) {
  return !left || attemptTimestamp(right) > attemptTimestamp(left) ? right : left;
}

export function buildLatestBankAttemptIndex<T extends BankAttemptIdentity>(attempts: T[]): LatestBankAttemptIndex<T> {
  const index: LatestBankAttemptIndex<T> = {
    byId: new Map(),
    byUrl: new Map(),
    byTitle: new Map(),
  };
  for (const attempt of attempts) {
    if (attempt.questionId) {
      const key = `${attempt.type}:${attempt.questionId}`;
      index.byId.set(key, newest(index.byId.get(key), attempt));
    }
    if (attempt.url) {
      const key = `${attempt.type}:${normalizedUrl(attempt.url)}`;
      index.byUrl.set(key, newest(index.byUrl.get(key), attempt));
    }
    const titleKey = `${attempt.type}:${normalizedIdentity(attempt.title)}`;
    index.byTitle.set(titleKey, newest(index.byTitle.get(titleKey), attempt));
  }
  return index;
}

export function findLatestBankAttempt<T extends BankAttemptIdentity>(
  index: LatestBankAttemptIndex<T>,
  type: ActivityType,
  question: BankQuestionIdentity,
) {
  const candidates = [
    index.byId.get(`${type}:${question.id}`),
    question.url ? index.byUrl.get(`${type}:${normalizedUrl(question.url)}`) : undefined,
    index.byTitle.get(`${type}:${normalizedIdentity(question.title)}`),
  ].filter((candidate): candidate is T => Boolean(candidate));
  return candidates.reduce<T | undefined>((latest, candidate) => newest(latest, candidate), undefined);
}

export function nextBankVisibleCount(current: number, total: number) {
  return Math.min(total, current + BANK_VISIBLE_CHUNK_SIZE);
}
