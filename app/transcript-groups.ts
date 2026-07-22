import type { TranscriptTurn } from "./live-types";

export type TranscriptGroup =
  | { kind: "voice_answer"; id: string; turns: TranscriptTurn[] }
  | { kind: "turn"; id: string; turn: TranscriptTurn };

export function groupTranscriptTurns(turns: TranscriptTurn[]): TranscriptGroup[] {
  return turns.reduce<TranscriptGroup[]>((groups, turn) => {
    if (turn.speaker === "user" && turn.source === "audio_transcript") {
      const previous = groups.at(-1);
      if (previous?.kind === "voice_answer") {
        previous.turns.push(turn);
        return groups;
      }
      groups.push({ kind: "voice_answer", id: `voice-${turn.turnId}`, turns: [turn] });
      return groups;
    }

    groups.push({ kind: "turn", id: `turn-${turn.turnId}`, turn });
    return groups;
  }, []);
}
