import { readActivityPracticeRecord } from "../../../db/durable-practice";
import { codeAttemptReviewForDisplay } from "../../../db/code-attempt-review";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const activityId = new URL(request.url).searchParams.get("activityId")?.trim();
    if (!activityId) return Response.json({ error: "An activityId is required." }, { status: 400 });
    const ownerId = await resolveOwnerId(request);
    const record = await readActivityPracticeRecord(ownerId, activityId);
    return Response.json({
      finalization: record.finalization,
      finalAnswer: record.finalAnswer,
      finalAnswerMarkdown: record.finalAnswerMarkdown,
      finalAnswerHtml: record.finalAnswerHtml,
      resumeContext: record.resumeContext,
      resumeContextMarkdown: record.resumeContextMarkdown,
      resumeContextHtml: record.resumeContextHtml,
      practiceScenarios: record.practiceScenarios,
      practiceScenariosMarkdown: record.practiceScenariosMarkdown,
      practiceScenariosHtml: record.practiceScenariosHtml,
      behavioralAnalysis: record.behavioralAnalysis,
      behavioralAnalysisMarkdown: record.behavioralAnalysisMarkdown,
      behavioralAnalysisHtml: record.behavioralAnalysisHtml,
      turns: record.turns.map((turn) => ({
        activityId: turn.activityId,
        turnId: turn.turnId,
        specialty: turn.specialty,
        speaker: turn.speaker,
        body: turn.body,
        source: turn.source,
        sequence: turn.sequence,
        occurredAt: turn.occurredAt,
        updatedAt: turn.updatedAt,
      })),
      notes: record.notes.map((note) => ({
        id: note.id,
        activityId: note.activityId,
        date: note.date,
        body: note.body,
        kind: note.kind,
        pinned: note.pinned,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      audioClips: record.audioClips.map((clip) => ({
        id: clip.id,
        activityId: clip.activityId,
        transcriptTurnId: clip.transcriptTurnId,
        filename: clip.filename,
        mimeType: clip.mimeType,
        label: clip.label,
        durationSeconds: clip.durationSeconds,
        status: clip.status,
      })),
      deliveryAnalyses: record.deliveryAnalyses.map((analysis) => ({
        id: analysis.id,
        activityId: analysis.activityId,
        audioClipId: analysis.audioClipId,
        transcriptTurnId: analysis.transcriptTurnId,
        specialty: analysis.specialty,
        status: analysis.status,
        payload: analysis.payload,
        error: analysis.error,
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      })),
      codeAttempts: record.codeAttempts.map((attempt) => ({
        id: attempt.id,
        activityId: attempt.activityId,
        originatingTurnId: attempt.originatingTurnId,
        sequence: attempt.sequence,
        language: attempt.language,
        code: attempt.code,
        lineCount: attempt.lineCount,
        occurredAt: attempt.occurredAt,
        review: codeAttemptReviewForDisplay(attempt.review),
        reviewResponseTurnId: attempt.reviewResponseTurnId,
        observedCorrectness: attempt.observedCorrectness,
        concreteFindings: attempt.concreteFindings,
        edgeCases: attempt.edgeCases,
        complexity: attempt.complexity,
        finalDeclaration: attempt.finalDeclaration,
      })),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
