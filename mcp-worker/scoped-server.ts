import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// The authenticated ChatGPT surface reuses the existing practice handlers.
// New tools are excluded until explicitly reviewed for this connection.
export const CHATGPT_PRACTICE_TOOLS = new Set([
  "open_study_resource_uploader",
  "search_study_resources", "get_study_resource", "get_study_resource_image", "get_study_resource_original", "save_study_resource_file", "link_study_resource",
  "save_learning_lesson_revision", "query_learning_workspace", "create_learning_session", "query_learning_sessions",
  "open_practice_lecture_player", "generate_lecture_audio_section",
  "get_practice_coaching_guide",
  "list_practice_lectures", "save_practice_lecture", "get_practice_lecture", "save_lecture_position",
  "open_coding_editor", "get_coding_draft", "save_coding_draft", "submit_coding_draft", "get_coding_submission",
  "read_excalidraw_link",
  "get_leetcode_connection", "get_leetcode_problem", "get_leetcode_recent_submissions", "get_leetcode_submission", "get_leetcode_editorial",
  "save_practice_drawing", "get_practice_drawing",
  "backfill_practice_editorial", "get_practice_editorial",
  "publish_practice_solutions", "get_practice_solution_batch",
  "upsert_behavioral_evidence_item", "query_behavioral_evidence_candidates", "review_behavioral_evidence_candidates", "set_behavioral_claim_status",
  "search", "fetch", "create_practice_question", "preview_practice_backfill", "apply_practice_backfill", "get_practice_backfill_receipt",
  "get_practice_interaction_mode", "set_practice_interaction_mode", "save_practice_exchange",
  "get_problem_solution_profile", "get_activity_practice_record", "add_practice_note", "schedule_practice_review",
  "save_specialist_finalization", "get_specialist_write_status",
  "save_leetcode_code_attempt", "save_provisional_solution_profile", "get_behavioral_practice_preflight",
  "get_system_design_checkpoint",
  "get_resume_library", "get_resume_revision",
  "query_behavioral_evidence", "query_behavioral_stories", "get_behavioral_foundation_status", "query_behavioral_project_deep_dives", "get_activity_resume_context",
  "query_practice_catalog", "plan_today_practice", "control_practice_timer", "control_practice_session_timer", "set_practice_result", "get_today_practice",
]);

export class ScopedMcpServer extends McpServer {
  override registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
    name: string,
    config: { title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs; annotations?: ToolAnnotations; _meta?: Record<string, unknown> },
    cb: ToolCallback<InputArgs>,
  ) {
    const registered = super.registerTool(name, config, cb);
    // remove() is the SDK's public API: omitted tools are neither listed nor
    // callable. Registration itself never invokes a handler or accesses data.
    if (!CHATGPT_PRACTICE_TOOLS.has(name)) registered.remove();
    return registered;
  }
}
