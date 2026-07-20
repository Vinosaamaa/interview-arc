import type { PublicationStatusValue } from "./live-state";

export function derivePublicationStatus({
  hasArtifact,
  storedPublication,
  completed,
}: {
  hasArtifact: boolean;
  storedPublication?: PublicationStatusValue;
  completed: boolean;
}): PublicationStatusValue {
  // A specialist may report the local artifact path before the daily branch is
  // merged. Only content imported from Git is truly readable on the website.
  if (hasArtifact) return "published";
  if (storedPublication === "published") return "ready";
  if (completed || storedPublication === "ready") return "ready";
  return "draft";
}
