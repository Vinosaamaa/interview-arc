import { z } from "zod";

export const lectureId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/);
export const lectureSourceSchema = z.strictObject({
  label: z.string().trim().min(1).max(240),
  url: z.url({ protocol: /^https?$/ }).max(2000).refine(value => {
    const url = new URL(value); return !url.username && !url.password;
  }),
});
export const saveLectureSchema = z.strictObject({
  lectureId, title: z.string().trim().min(1).max(240),
  sources: z.array(lectureSourceSchema).min(1).max(30),
  sections: z.array(z.strictObject({
    id: lectureId, title: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(20000),
  })).min(1).max(60),
}).refine(value => new Set(value.sections.map(section => section.id)).size === value.sections.length, "Section IDs must be unique.")
  .refine(value => value.sections.reduce((sum, section) => sum + section.text.length, 0) <= 120000, "Lecture text exceeds 120,000 characters.");
export const lectureCursorSchema = z.strictObject({
  lectureId, operationId: lectureId, expectedRevision: z.number().int().nonnegative(),
  chunkIndex: z.number().int().min(0).max(199),
  offsetSeconds: z.number().finite().min(0).max(1800),
  characterOffset: z.number().int().min(0).max(3500).default(0),
});
export type LectureInput = z.infer<typeof saveLectureSchema>;
export type LectureCursorInput = z.infer<typeof lectureCursorSchema>;
export type LectureChunk = { index: number; sectionId: string; sectionTitle: string; text: string };
export function lectureSectionsFromMarkdown(script: string) {
  const sections: LectureInput["sections"] = [];
  let title = "Introduction", body: string[] = [], fence = "";
  const append = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ id: `section-${sections.length + 1}`, title, text });
    body = [];
  };
  for (const line of script.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      body.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
    } else if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1]; body.push(line);
    } else if (/^#{1,3}\s/.test(line)) {
      append(); title = line.replace(/^#{1,3}\s+/, "");
    } else body.push(line);
  }
  append(); return sections;
}
export class LectureError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
export async function lectureHash(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function chunkLecture(input: LectureInput): LectureChunk[] {
  const chunks: LectureChunk[] = [];
  for (const section of input.sections) {
    let remaining = section.text;
    while (remaining.length) {
      let end = Math.min(remaining.length, 3500);
      if (end < remaining.length) {
        const boundary = Math.max(remaining.lastIndexOf("\n", end - 1), remaining.lastIndexOf(" ", end - 1));
        if (boundary > 1750) end = boundary + 1;
        // Do not split a Unicode surrogate pair at the API boundary.
        if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      }
      chunks.push({ index: chunks.length, sectionId: section.id, sectionTitle: section.title, text: remaining.slice(0, end) });
      remaining = remaining.slice(end);
    }
  }
  if (chunks.length > 200) throw new LectureError("Lecture has too many audio chunks.", 400);
  return chunks;
}
export function lectureWordCount(input: LectureInput) {
  return input.sections.reduce((sum, section) => sum + (section.text.match(/\S+/g)?.length ?? 0), 0);
}
