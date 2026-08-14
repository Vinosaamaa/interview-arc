type ReaderSection = { title: string; body: string };

export type PreferredImplementation = {
  label: "Java" | "Python";
  language: string;
  code: string;
};

const fencedCodePattern = /```([^\n]*)\n([\s\S]*?)```/g;

export function extractPreferredImplementations(section: ReaderSection) {
  if (!/reference implementations?|preferred implementations?|complete reference/i.test(section.title)) return null;
  const blocks = [...section.body.matchAll(fencedCodePattern)].map((match) => ({
    language: match[1].trim().toLowerCase(),
    code: match[2].trim(),
  }));
  const java = blocks.find((block) => block.language === "java");
  const python = blocks.find((block) => block.language === "python" || block.language === "py");
  if (!java || !python) return null;
  return {
    introduction: section.body.replace(fencedCodePattern, "").replace(/\n{3,}/g, "\n\n").trim(),
    implementations: [
      { label: "Java" as const, language: java.language, code: java.code },
      { label: "Python" as const, language: python.language, code: python.code },
    ],
  };
}

export function solutionProfileIsAvailable(profile?: { summary?: string; sections?: unknown[] } | null) {
  return Boolean(profile?.summary?.trim() && profile.sections?.length);
}

export function latestSolutionActionLabel(revision: number) {
  return `Open latest solution · Revision ${revision}`;
}
