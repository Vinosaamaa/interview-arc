/**
 * Read-only catalog audit for #439. This does not connect a client, authenticate,
 * execute tools, classify transcripts, or prove end-to-end specialist readiness.
 * Pass the decoded result of MCP tools/list (or its JSON-RPC response).
 */
const commonWorkflows = [
  ["context", ["get_today_practice", "get_activity_practice_record", "get_problem_solution_profile"]],
  ["workbench", ["control_practice_workbench"]],
  ["planning", ["query_practice_catalog", "plan_today_practice", "remove_today_practice_activities"]],
  ["questions", ["upsert_personal_bank_question", "get_specialist_write_status"]],
  ["timers", ["control_practice_timer", "control_practice_session_timer"]],
  ["interaction_mode", ["get_practice_interaction_mode", "set_practice_interaction_mode"]],
  ["transcript_and_notes", ["save_practice_exchange", "add_practice_note"]],
  ["outcome", ["set_practice_result"]],
  ["solution_profile", ["get_problem_solution_profile", "save_provisional_solution_profile", "save_specialist_finalization"]],
  ["finalization_and_recovery", ["save_specialist_finalization", "get_specialist_write_status", "retry_specialist_writes", "schedule_practice_review"]],
  ["private_reconciliation", ["get_publication_queue", "get_activity_practice_record"]],
];

const specialtyWorkflows = {
  leetcode: [["code_attempts", ["save_leetcode_code_attempt"]]],
  system_design: [],
  behavioral: [["behavioral_evidence", ["get_behavioral_practice_preflight", "query_behavioral_evidence", "query_behavioral_stories"]]],
};

const runtimeRequirements = {
  leetcode: ["local_java_harness", "authorized_leetcode_controller", "exact_submission_receipt"],
  system_design: ["local_excalidraw_controller", "activity_scene_checkpoint", "immutable_design_assets"],
  behavioral: ["owner_evidence_access", "resume_story_provenance"],
};

const commonVerification = [
  "actual_chatgpt_live_tool_access",
  "owner_authentication_and_write_authorization",
  "portable_specialist_guide_and_context",
  "authoritative_lifecycle_readback",
  "chatgpt_transcript_only_provenance",
  "related_unrelated_mixed_uncertain_classification",
  "actual_finalized_response_parity",
  "incremental_durable_delivery",
  "multi_hour_reconnect_and_concurrency_recovery",
  "private_finalization_exact_readback",
];

function workflowsFor(specialty) {
  if (typeof specialty !== "string" || !Object.hasOwn(specialtyWorkflows, specialty)) {
    throw new TypeError("Unsupported practice specialty.");
  }
  return [...commonWorkflows, ...specialtyWorkflows[specialty]];
}

/** A fresh sorted inventory; mutating the result cannot change the audit. */
export function requiredSpecialistTools(specialty) {
  return [...new Set(workflowsFor(specialty).flatMap(([, tools]) => tools))].sort();
}

function readCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)
      || catalog.error != null) {
    throw new TypeError("Expected a successful MCP tools/list response.");
  }
  const result = Object.hasOwn(catalog, "result") ? catalog.result : catalog;
  if (!result || typeof result !== "object" || Array.isArray(result)
      || !Array.isArray(result.tools) || result.tools.length > 1024) {
    throw new TypeError("Expected a bounded MCP tools array.");
  }
  if (result.nextCursor != null
      && (typeof result.nextCursor !== "string" || !result.nextCursor.length)) {
    throw new TypeError("Invalid catalog pagination metadata.");
  }
  const names = new Set();
  for (const tool of result.tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)
        || typeof tool.name !== "string"
        || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name)
        || names.has(tool.name)) {
      throw new TypeError("Invalid or duplicate tool identity in supplied catalog.");
    }
    names.add(tool.name);
  }
  return { names, partial: result.nextCursor != null };
}

/**
 * Evidence is only caller-supplied catalog coverage. Even complete tool coverage
 * leaves integrationVerified false. Unseen tools on a paged result are not
 * declared absent. Descriptions, input schemas, tokens, and cursor values are
 * never copied into the report. No production mutation is performed.
 */
export function auditSpecialistCapabilities({ catalog, specialty } = {}) {
  const definitions = workflowsFor(specialty);
  const { names, partial } = readCatalog(catalog);
  const workflows = definitions.map(([id, requiredTools]) => {
    const unseenTools = requiredTools.filter((name) => !names.has(name));
    return {
      id,
      requiredTools: [...requiredTools],
      unseenTools,
      coverage: unseenTools.length === 0 ? "advertised"
        : partial ? "unknown_on_partial_catalog" : "missing_tools",
    };
  });
  return {
    schemaVersion: 1,
    scope: "supplied_catalog_only",
    specialty,
    catalogComplete: !partial,
    catalogCoverage: partial ? "incomplete_catalog"
      : workflows.every((workflow) => workflow.unseenTools.length === 0)
        ? "covered" : "missing_tools",
    integrationVerified: false,
    workflows,
    unverifiedRequirements: [...commonVerification, ...runtimeRequirements[specialty]],
  };
}
