import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyLearningChatgptFlow(client) {
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
    return result.structuredContent;
  };
  for (const document of ["specialist", "contract", "chatgpt"]) {
    const guide = await call("get_learning_coaching_guide", { document });
    assert.equal(guide.text, await readFile(new URL(`../../${guide.path}`, import.meta.url), "utf8"));
    assert.equal(guide.nextOffset, null);
    assert.equal((await client.callTool({ name: "get_learning_coaching_guide", arguments: { document, expectedSha256: "0".repeat(64) } })).isError, true);
  }
  const courseId = "chatgpt-learning-course", lessonId = "chatgpt-learning-lesson", sessionId = "chatgpt-learning-session";
  const blueprint = { courseId, state: "draft", title: "Synthetic network foundations", goal: "Distinguish a name from an address.", intendedOutcome: "Explain the request path using source evidence.", modules: [{ moduleId: "request-path", title: "Request path", order: 0, objective: "Trace one request.", lessons: [{ lessonId, title: "Names and addresses", order: 0, kind: "lesson", objective: "Distinguish names and addresses." }] }] };
  const create = { operationId: "learning-chat-create", authorization: "learning_specialist", blueprint };
  assert.equal((await call("create_learning_course_blueprint", create)).blueprintRevision, 1);
  assert.equal((await call("create_learning_course_blueprint", create)).duplicate, true);
  const revised = { ...blueprint, intendedOutcome: "Explain the request path and its failure boundary." };
  await call("revise_learning_course_blueprint", { operationId: "learning-chat-revise", authorization: "learning_specialist", courseId, expectedRevision: 1, blueprint: revised });
  await call("approve_learning_course_enrollment", { operationId: "learning-chat-approve", authorization: "explicit_user_instruction", courseId, enrollmentId: "chatgpt-learning-enrollment", expectedBlueprintRevision: 2 });
  const scope = { kind: "course", courseId, enrollmentId: "chatgpt-learning-enrollment", moduleId: "request-path", blueprintRevision: 2 };
  const lesson = { lessonId, state: "active", title: "Names and addresses", objective: "Trace the distinction.", sections: [{ sectionId: "concept", heading: "Names and addresses", body: "A name identifies a destination to a person; an address identifies a network endpoint." }], exercises: [{ exerciseId: "explain", prompt: "Explain a name lookup." }], homework: [{ homeworkId: "lookup-note", prompt: "Write the distinction in your own words." }], checkpoints: [{ checkpointId: "distinguish", label: "Distinguish a name from an address", description: "Explain the distinction with an example.", required: true }] };
  await call("save_learning_lesson_revision", { operationId: "learning-chat-lesson", expectedRevision: 0, authorization: "learning_specialist", scope, lesson });
  let receipt = await call("create_learning_session", { operationId: "learning-chat-session", authorization: "learning_specialist", scope, lessonId, lessonRevision: 1, sessionId });
  for (const action of ["start", "pause", "resume"]) receipt = await call("control_learning_session", { operationId: `learning-chat-${action}`, authorization: "explicit_user_instruction", sessionId, expectedRevision: receipt.revision, action });
  const turns = [{ turnId: "learning-chat-teacher", sequence: 0, speaker: "specialist", source: "typed", body: "How does a name differ from an address?", occurredAt: Date.now() }, { turnId: "learning-chat-learner", sequence: 1, speaker: "learner", source: "typed", body: "A name is a readable identifier; a lookup returns an address used to reach the endpoint.", occurredAt: Date.now() + 1 }];
  const transcript = { operationId: "learning-chat-transcript", sessionId, expectedTranscriptRevision: 0, writer: "learning_specialist", turns };
  await call("append_learning_transcript", transcript);
  assert.equal((await call("append_learning_transcript", transcript)).duplicate, true);
  await call("attach_learning_artifact", { operationId: "learning-chat-artifact", artifactId: "learning-chat-note", authorization: "learning_specialist", lessonId, sessionId, homeworkId: "lookup-note", kind: "written", label: "Synthetic answer", mediaType: "text/plain", content: turns[1].body });
  await call("set_learning_homework_state", { operationId: "learning-chat-homework", authorization: "explicit_user_instruction", lessonId, homeworkId: "lookup-note", expectedRevision: 1, state: "completed" });
  const before = (await call("query_learning_sessions", { sessionId })).sessions[0];
  assert.deepEqual(before.turns.map(({turnId, sequence, speaker, source, body, occurredAt}) => ({turnId, sequence, speaker, source, body, occurredAt})), turns);
  const finished = await call("finish_learning_session", { operationId: "learning-chat-finish", authorization: "explicit_user_instruction", sessionId, expectedRevision: before.session.revision, expectedTranscriptRevision: before.session.transcriptRevision, finalization: { recap: "The synthetic learner explained names and addresses.", recommendedNextAction: "Review lookup failures next.", checkpointResults: [{ checkpointId: "distinguish", status: "demonstrated", rationale: "The exact learner turn explains readable identity and network address.", evidence: [{ kind: "transcript_turn", turnId: turns[1].turnId }] }] } });
  assert.equal(finished.state, "completed");
  const evidence = await call("query_learning_evidence", { lessonId });
  assert.equal(evidence.homework[0].state, "completed");
  assert.ok(!JSON.stringify(evidence).includes("privateLocator"));
  await call("query_learning_workspace", { courseId });
  await call("query_learning_journey", { courseId });
  await call("query_learning_analytics", { courseId });
}
