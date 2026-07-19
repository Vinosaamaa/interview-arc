#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const options = { capturedAt: new Date().toISOString().slice(0, 10) };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--bank") options.bank = argv[++index];
    else if (value === "--captured-at") options.capturedAt = argv[++index];
    else if (!options.snapshot) options.snapshot = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (!options.snapshot || !options.bank) {
    throw new Error("Usage: import_bugfree_behavior.mjs <encrypted-api-response.json> --bank <questions.json> [--captured-at YYYY-MM-DD]");
  }
  return options;
}

function decryptPayload(payload) {
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from("dn46yP7NX92rFqLx", "utf8"),
    Buffer.from(payload.iv, "base64"),
  );
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(payload.ct, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const options = parseArgs(process.argv);
const encrypted = JSON.parse(await readFile(options.snapshot, "utf8"));
const decoded = decryptPayload(encrypted);
const sourceQuestions = decoded.mock_questions ?? [];
const seen = new Set();
const questions = [];

for (const source of sourceQuestions) {
  const id = String(source.mock_question_id ?? source.slug ?? "").trim().toLowerCase();
  if (!id || seen.has(id)) continue;
  const title = String(source.title ?? source.question ?? "").trim();
  if (!title) continue;
  questions.push({
    id,
    title,
    prompt: String(source.question ?? title).trim(),
    url: `https://bugfree.ai/behavior/${id}`,
    source: "Bugfree.ai",
    difficulty: String(source.difficulty ?? "medium").toLowerCase(),
    frequency: String(source.freq ?? "medium").toLowerCase(),
    answerFormat: String(source.answer_format ?? "STAR").toUpperCase(),
    solutionReference: true,
    referenceAccess: source.is_free ? "public" : "may_require_sign_in",
    topics: unique([source.domain ?? source.category, ...(source.criteria ?? [])]),
    targetMinutes: 60,
    active: true,
  });
  seen.add(id);
}

if (questions.length !== 74) {
  throw new Error(`Expected 74 unique behavioral questions, found ${questions.length}`);
}

await mkdir(path.dirname(options.bank), { recursive: true });
await writeFile(options.bank, `${JSON.stringify({
  schemaVersion: 1,
  type: "behavioral",
  updatedAt: options.capturedAt,
  questions,
}, null, 2)}\n`);

console.log(JSON.stringify({ sourceRows: sourceQuestions.length, imported: questions.length }));
