export type RoleBriefSourcePayload = {
  loopId: string;
  roleBriefRevision: number;
  label: string;
  company: string;
  roleTitle: string;
  source: {
    kind: "pasted_jd" | "public_posting";
    displayLocator: string;
    capturedAt: number;
    jdText: string;
    fingerprint: string;
  };
  createdAt: number;
};

export type JobDescriptionBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export async function fetchRoleBriefSource(
  loopId: string,
  revision: number,
  includeArchived: boolean,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const parameters = new URLSearchParams({
    loopId,
    roleBriefRevision: String(revision),
    includeArchived: String(includeArchived),
  });
  const response = await fetcher(`/api/loops/role-brief-source?${parameters}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json() as RoleBriefSourcePayload & { error?: string };
  if (!response.ok) throw new Error(body.error || "The full job description is unavailable.");
  return body;
}

export function parseJobDescription(value: string): JobDescriptionBlock[] {
  const blocks: JobDescriptionBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };
  value.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      return;
    }
    if (text.startsWith("- ")) {
      flushParagraph();
      list.push(text.slice(2));
      return;
    }
    flushList();
    paragraph.push(text);
  });
  flushParagraph();
  flushList();
  return blocks;
}
