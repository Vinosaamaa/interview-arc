// Some MCP hosts wrap tool errors in their own transport exception. Keep that
// implementation detail out of the player without weakening the revision guard.
export function lecturePlaybackError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/saved position changed|stale cursor|position changed elsewhere/i.test(message)) {
    return "Your position changed in another player. Reload the saved position, then press Play. Your newer progress is safe.";
  }
  if (/INVALID_ARGUMENT|RuntimeException|TextContent\(/.test(message)) {
    return "The player could not confirm your saved position. Reload it to try again.";
  }
  return message;
}
