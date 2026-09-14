import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import specialist from "../learn/AGENTS.md";
import contract from "../docs/contracts/learning-workspace.md";
import chatgpt from "../learn/chatgpt.md";

const documents = {
  specialist: { path: "learn/AGENTS.md", text: specialist },
  contract: { path: "docs/contracts/learning-workspace.md", text: contract },
  chatgpt: { path: "learn/chatgpt.md", text: chatgpt },
};

export function registerLearningCoachingTools(server: McpServer) {
  server.registerTool("get_learning_coaching_guide", {
    title: "Read the Learning Specialist guide",
    description: "Before planning, publishing or teaching any subject in Learn, read the shared Learning Specialist instructions, learning contract and ChatGPT workflow. Supports systematic Courses, standalone Quick Study, lesson guides, homework and evidence-based progress. Read all required documents and pages; reuse unchanged hashes in this chat. This is the deployed guide, not an assumption that ChatGPT loads local Codex skills. Does not create a course or start a session.",
    inputSchema: {
      document: z.enum(["specialist", "contract", "chatgpt"]).default("specialist"),
      offset: z.number().int().min(0).default(0),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ document, offset, expectedSha256 }) => {
    const selected = documents[document];
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(selected.text))).toString("hex");
    if (offset > selected.text.length || (offset > 0 && expectedSha256 !== sha256) || (expectedSha256 && expectedSha256 !== sha256)) {
      return { isError: true, content: [{ type: "text" as const, text: "Guide changed or invalid page. Read this document again from offset 0." }] };
    }
    const end = Math.min(offset + 16000, selected.text.length);
    const value = { version: 1, document, path: selected.path, sha256, offset, totalCharacters: selected.text.length, nextOffset: end < selected.text.length ? end : null, text: selected.text.slice(offset, end), requiredDocuments: Object.keys(documents) };
    return { structuredContent: value, content: [{ type: "text" as const, text: JSON.stringify(value) }] };
  });
}
