import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import document0 from "../.agents/skills/run-interview-practice/SKILL.md";
import document1 from "../.agents/skills/run-interview-practice/references/interviewer-engine.md";
import document2 from "../.agents/skills/run-interview-practice/references/coaching-and-evaluation.md";
import document3 from "../.agents/skills/run-interview-practice/references/behavioral-interviewer.md";
import document4 from "../.agents/skills/run-interview-practice/references/system-design-interviewer.md";
import document5 from "../.agents/skills/run-interview-practice/references/coding-interviewer.md";
import document6 from "../practice/AGENTS.md";
import document7 from "../practice/behavioral/AGENTS.md";
import document8 from "../practice/system-design/AGENTS.md";
import document9 from "../practice/leetcode/AGENTS.md";
import document10 from "../.agents/skills/interview-arc-system-design/SKILL.md";
import document11 from "../.agents/skills/interview-arc-system-design/references/reference-preflight.md";
import document12 from "../.agents/skills/interview-arc-system-design/references/solution-template.md";
import document13 from "../docs/contracts/practice-coaching-handoff.md";
import document14 from "../docs/contracts/solution-profiles.md";
import document15 from "../docs/contracts/practice-solution-publication.md";
const documents = {
  "skill": { path: ".agents/skills/run-interview-practice/SKILL.md", text: document0 },
  "engine": { path: ".agents/skills/run-interview-practice/references/interviewer-engine.md", text: document1 },
  "evaluation": { path: ".agents/skills/run-interview-practice/references/coaching-and-evaluation.md", text: document2 },
  "behavioral": { path: ".agents/skills/run-interview-practice/references/behavioral-interviewer.md", text: document3 },
  "system-design": { path: ".agents/skills/run-interview-practice/references/system-design-interviewer.md", text: document4 },
  "coding": { path: ".agents/skills/run-interview-practice/references/coding-interviewer.md", text: document5 },
  "shared": { path: "practice/AGENTS.md", text: document6 },
  "behavioral-arc": { path: "practice/behavioral/AGENTS.md", text: document7 },
  "system-design-arc": { path: "practice/system-design/AGENTS.md", text: document8 },
  "coding-arc": { path: "practice/leetcode/AGENTS.md", text: document9 },
  "design-skill": { path: ".agents/skills/interview-arc-system-design/SKILL.md", text: document10 },
  "design-preflight": { path: ".agents/skills/interview-arc-system-design/references/reference-preflight.md", text: document11 },
  "design-solution": { path: ".agents/skills/interview-arc-system-design/references/solution-template.md", text: document12 },
  "handoff": { path: "docs/contracts/practice-coaching-handoff.md", text: document13 },
  "solutions": { path: "docs/contracts/solution-profiles.md", text: document14 },
  "publication": { path: "docs/contracts/practice-solution-publication.md", text: document15 },
};
const documentId = z.enum(["skill","engine","evaluation","behavioral","system-design","coding","shared","behavioral-arc","system-design-arc","coding-arc","design-skill","design-preflight","design-solution","handoff","solutions","publication"]);
export function registerCoachingTools(server: McpServer) {
  server.registerTool("get_practice_coaching_guide", {
    title: "Read shared practice coaching",
    description: "Read the exact repository coaching skill and AGENTS.md used by Codex, for connected ChatGPT too. At new practice preparation read required documents and every page, using sha256 for subsequent pages. Reuse unchanged documents within this conversation. Read evaluation before review/closure and design-solution before design finalization. Includes text-to-Live handoff; hidden tool results are not guaranteed Voice context. No personal evidence or activity creation.",
    inputSchema: {
      specialty: z.enum(["coding", "system-design", "behavioral"]),
      document: documentId.default("skill"),
      offset: z.number().int().min(0).default(0),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ specialty, document, offset, expectedSha256 }) => {
    const selected = documents[document];
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(selected.text))).toString("hex");
    if (offset > selected.text.length || (offset > 0 && expectedSha256 !== sha256) || (expectedSha256 && expectedSha256 !== sha256)) {
      return { isError: true, content: [{ type: "text" as const, text: "Guide changed or invalid page. Read this document again from offset 0 before continuing." }] };
    }
    const end = Math.min(offset + 16000, selected.text.length);
    const result = {
      version: 1, specialty, document, path: selected.path, sha256,
      offset, totalCharacters: selected.text.length, nextOffset: end < selected.text.length ? end : null,
      text: selected.text.slice(offset, end),
      requiredDocuments: ["skill", "engine", specialty, "shared", specialty + "-arc", "handoff",
        ...(specialty === "system-design" ? ["design-skill", "design-preflight"] : [])],
      reviewDocuments: ["evaluation", "solutions", "publication", ...(specialty === "system-design" ? ["design-solution"] : [])],
      documents: Object.entries(documents).map(([id, doc]) => ({ id, path: doc.path })),
    };
    return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
