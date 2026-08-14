import type { PublicationStatusValue } from "./live-state";

export function derivePublicationStatus({
  hasArtifact,
  hasPracticeRecord = false,
  storedPublication,
  completed,
}: {
  hasArtifact: boolean;
  hasPracticeRecord?: boolean;
  storedPublication?: PublicationStatusValue;
  completed: boolean;
}): PublicationStatusValue {
  // Owner-private immutable Practice Records are the current reader authority.
  // Their exact pointer/revision readback is publication completion even when
  // the legacy public Git projection has intentionally been removed.
  if (hasPracticeRecord) return "published";
  // A specialist may report the local artifact path before the daily branch is
  // merged. Only content imported from Git is truly readable on the website.
  if (hasArtifact) return "published";
  if (storedPublication === "published") return "ready";
  if (completed || storedPublication === "ready") return "ready";
  return "draft";
}
