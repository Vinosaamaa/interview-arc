// Shared content reader used by `import-content.mjs` to mirror durable Git
// journals, artifacts, stories, and question banks into the D1 read model.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function filesIn(root, relativeDirectory, extension) {
  const directory = path.join(root, relativeDirectory);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => path.join(relativeDirectory, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function parseScalar(value) {
  const clean = value.trim();
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (clean === "null") return null;
  if (/^-?\d+$/.test(clean)) return Number(clean);
  if (clean.startsWith("[") && clean.endsWith("]")) {
    return clean
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return clean.replace(/^['"]|['"]$/g, "");
}

function parseMarkdown(source, relativePath, fallbackType) {
  const normalized = source.replace(/\r\n/g, "\n");
  const frontmatter = {};
  let body = normalized;

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end !== -1) {
      for (const line of normalized.slice(4, end).split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        frontmatter[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
      }
      body = normalized.slice(end + 5).trim();
    }
  }

  const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const sections = [];
  const sectionPattern = /^##\s+(.+)$/gm;
  const matches = [...body.matchAll(sectionPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    sections.push({
      title: match[1].trim(),
      body: body.slice(start, end).trim(),
    });
  }

  const filenameDate = path.basename(relativePath).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return {
    path: relativePath,
    type: String(frontmatter.type ?? fallbackType),
    title: String(frontmatter.title ?? firstHeading ?? path.basename(relativePath, ".md")),
    date: String(frontmatter.date ?? filenameDate ?? "unknown"),
    activityId: String(frontmatter.activity_id ?? ""),
    status: String(frontmatter.status ?? "published"),
    audioFile: String(frontmatter.audio_file ?? ""),
    audioAvailability: String(frontmatter.audio_availability ?? ""),
    sections,
  };
}

async function hydrateBankSolution(root, question) {
  if (!question.solutionPath) return question;
  const parsed = parseMarkdown(
    await readFile(path.join(root, question.solutionPath), "utf8"),
    question.solutionPath,
    "solution",
  );
  const summary = parsed.sections.find((section) => /short answer|summary/i.test(section.title))?.body
    ?? parsed.sections[0]?.body
    ?? question.prompt;
  return {
    ...question,
    solutionProfile: {
      schemaVersion: 1,
      summary,
      sections: parsed.sections,
      tags: question.topics ?? [],
      references: question.url
        ? [{ title: question.source ?? "Original question", url: question.url, accessedAt: "2026-07-21" }]
        : [],
    },
  };
}

// Reads every Git-tracked content source and returns the same shape the app
// consumes: { journals, artifacts, stories, questionBanks }.
export async function readContent(root) {
  const dailyFiles = await filesIn(root, "data/daily", ".json");
  const journals = await Promise.all(dailyFiles.map((relativePath) => readJson(root, relativePath)));
  journals.sort((left, right) => right.date.localeCompare(left.date));

  const leetcodeBank = await readJson(root, "practice/leetcode/bank/questions.json");
  const systemDesignBank = await readJson(root, "practice/system-design/bank/questions.json");
  const behavioralBank = await readJson(root, "practice/behavioral/bank/questions.json");
  const questionBanks = {
    leetcode: leetcodeBank.questions.map((question) => ({
      id: question.id,
      problemNumber: question.problemNumber,
      title: question.title,
      url: question.url,
      difficulty: question.difficulty,
      acceptanceRate: question.acceptanceRate,
      topics: question.topics ?? [],
      companyTags: question.companyTags ?? [],
      companySignals: question.companySignals ?? [],
      targetMinutes: question.targetMinutes ?? 30,
      active: question.active ?? true,
    })),
    systemDesign: await Promise.all(systemDesignBank.questions.map((question) => hydrateBankSolution(root, question))),
    behavioral: await Promise.all(behavioralBank.questions.map((question) => hydrateBankSolution(root, question))),
  };

  const artifactDirectories = [
    ["practice/leetcode/attempts", "leetcode"],
    ["practice/system-design/sessions", "system_design"],
    ["practice/behavioral/sessions", "behavioral"],
    ["audio-answers", "audio_review"],
  ];

  const artifacts = [];
  for (const [directory, type] of artifactDirectories) {
    for (const relativePath of await filesIn(root, directory, ".md")) {
      if (relativePath.endsWith("/README.md")) continue;
      const source = await readFile(path.join(root, relativePath), "utf8");
      artifacts.push(parseMarkdown(source, relativePath, type));
    }
  }
  artifacts.sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title));

  const storyFiles = await filesIn(root, "practice/behavioral/story-bank/projects", ".md");
  const stories = await Promise.all(
    storyFiles.map(async (relativePath) => {
      const parsed = parseMarkdown(await readFile(path.join(root, relativePath), "utf8"), relativePath, "story");
      return { ...parsed, projectId: path.basename(relativePath, ".md") };
    }),
  );

  return { journals, artifacts, stories, questionBanks };
}
