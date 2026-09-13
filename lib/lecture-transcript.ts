// Preserve the original text exactly; segments are navigation targets, never a summary.
export function lectureTranscriptSegments(text: string) {
  return [...text.matchAll(/[\s\S]+?(?:[.!?](?=\s|$)|\n{2,}|$)/g)]
    .map(match => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
}
