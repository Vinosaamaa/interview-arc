import { env } from "cloudflare:workers";

export type CoverLetterFileFormat = "docx" | "pdf";

export interface CoverLetterFileIntegrity {
  format: CoverLetterFileFormat;
  sha256: string;
  byteSize: number;
  mimeType: string;
  filename: string;
}

export interface CoverLetterArtifactInput {
  operationId: string;
  artifactId: string;
  lineageId: string;
  parentRevisionId: string | null;
  requestFingerprint: string;
  company: string;
  role: string;
  sourceUrl: string | null;
  jobDescriptionSha256: string;
  resumeId: string;
  resumeRevisionId: string;
  evidenceFingerprint: string;
}

type ArtifactRow = {
  artifactId: string;
  lineageId: string;
  parentRevisionId: string | null;
  operationId: string;
  requestFingerprint: string;
  company: string;
  role: string;
  sourceUrl: string | null;
  jobDescriptionSha256: string;
  resumeId: string;
  resumeRevisionId: string;
  evidenceFingerprint: string;
  storageGeneration: string;
  state: "pending" | "ready" | "superseded";
  createdAt: number;
  readyAt: number | null;
  supersededAt: number | null;
  updatedAt: number;
};

type FileRow = CoverLetterFileIntegrity & { artifactId: string; createdAt: number };

const STORAGE_LEASE_MS = 2 * 60 * 1_000;

export class CoverLetterArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CoverLetterArtifactError";
  }
}

const ARTIFACT_SELECT = `SELECT
  artifact_id AS artifactId,
  lineage_id AS lineageId,
  parent_revision_id AS parentRevisionId,
  operation_id AS operationId,
  request_fingerprint AS requestFingerprint,
  company,
  role,
  source_url AS sourceUrl,
  job_description_sha256 AS jobDescriptionSha256,
  resume_id AS resumeId,
  resume_revision_id AS resumeRevisionId,
  evidence_fingerprint AS evidenceFingerprint,
  storage_generation AS storageGeneration,
  state,
  created_at AS createdAt,
  ready_at AS readyAt,
  superseded_at AS supersededAt,
  updated_at AS updatedAt
FROM cover_letter_artifacts`;

const FILE_SELECT = `SELECT
  artifact_id AS artifactId,
  format,
  sha256,
  byte_size AS byteSize,
  mime_type AS mimeType,
  filename,
  created_at AS createdAt
FROM cover_letter_artifact_files`;

function d1() {
  if (!env.DB) throw new CoverLetterArtifactError(
    "cover_letter_storage_unavailable",
    "Private Career Materials metadata storage is unavailable.",
    503,
    true,
  );
  return env.DB;
}

async function artifactByOperation(ownerId: string, operationId: string) {
  return d1().prepare(`${ARTIFACT_SELECT} WHERE owner_id = ? AND operation_id = ?`)
    .bind(ownerId, operationId).first<ArtifactRow>();
}

async function artifactById(ownerId: string, artifactId: string) {
  return d1().prepare(`${ARTIFACT_SELECT} WHERE owner_id = ? AND artifact_id = ?`)
    .bind(ownerId, artifactId).first<ArtifactRow>();
}

async function filesForArtifact(ownerId: string, artifactId: string) {
  const result = await d1().prepare(`${FILE_SELECT} WHERE owner_id = ? AND artifact_id = ? ORDER BY format`)
    .bind(ownerId, artifactId).all<FileRow>();
  return result.results;
}

function assertExact(row: ArtifactRow, input: CoverLetterArtifactInput) {
  if (row.requestFingerprint !== input.requestFingerprint || row.artifactId !== input.artifactId) {
    throw new CoverLetterArtifactError(
      "cover_letter_operation_conflict",
      "That operation identity was already used with different immutable input.",
      409,
      false,
    );
  }
}

function projectReceipt(row: ArtifactRow, files: FileRow[]) {
  return {
    schemaVersion: 1 as const,
    operationId: row.operationId,
    status: row.state === "pending" ? "staging" as const : "saved" as const,
    artifact: projectArtifact(row, files),
  };
}

function projectArtifact(row: ArtifactRow, files: FileRow[]) {
  return {
    id: row.artifactId,
    lineageId: row.lineageId,
    parentRevisionId: row.parentRevisionId,
    company: row.company,
    role: row.role,
    sourceUrl: row.sourceUrl,
    state: row.state,
    jobDescriptionSha256: row.jobDescriptionSha256,
    resumeId: row.resumeId,
    resumeRevisionId: row.resumeRevisionId,
    evidenceFingerprint: row.evidenceFingerprint,
    createdAt: new Date(row.createdAt).toISOString(),
    readyAt: row.readyAt === null ? null : new Date(row.readyAt).toISOString(),
    supersededAt: row.supersededAt === null ? null : new Date(row.supersededAt).toISOString(),
    files: files.map((file) => ({
      format: file.format,
      sha256: file.sha256,
      byteSize: file.byteSize,
      mimeType: file.mimeType,
      filename: file.filename,
      downloadPath: `/api/career-materials/cover-letters/${encodeURIComponent(row.artifactId)}/${file.format}`,
    })),
  };
}

async function replayReservation(
  ownerId: string,
  input: CoverLetterArtifactInput,
  replay: ArtifactRow,
  nowMs: number,
) {
  assertExact(replay, input);
  if (replay.state !== "pending" || replay.updatedAt > nowMs - STORAGE_LEASE_MS) {
    return {
      duplicate: true,
      ownsStorageLease: false,
      replacedStorageGeneration: null,
      row: replay,
      receipt: projectReceipt(replay, await filesForArtifact(ownerId, replay.artifactId)),
    };
  }

  const nextStorageGeneration = crypto.randomUUID();
  await d1().prepare(`UPDATE cover_letter_artifacts
    SET storage_generation = ?, updated_at = ?
    WHERE owner_id = ? AND artifact_id = ? AND operation_id = ?
      AND request_fingerprint = ? AND storage_generation = ?
      AND state = 'pending' AND updated_at = ?`)
    .bind(
      nextStorageGeneration,
      nowMs,
      ownerId,
      input.artifactId,
      input.operationId,
      input.requestFingerprint,
      replay.storageGeneration,
      replay.updatedAt,
    ).run();
  const claimed = await artifactByOperation(ownerId, input.operationId);
  if (!claimed) throw new CoverLetterArtifactError(
    "cover_letter_reservation_uncertain",
    "The cover-letter upload lease is not yet authoritative.",
    503,
    true,
  );
  assertExact(claimed, input);
  const ownsStorageLease = claimed.storageGeneration === nextStorageGeneration;
  return {
    duplicate: true,
    ownsStorageLease,
    replacedStorageGeneration: ownsStorageLease ? replay.storageGeneration : null,
    row: claimed,
    receipt: projectReceipt(claimed, await filesForArtifact(ownerId, claimed.artifactId)),
  };
}

export async function reserveCoverLetterArtifact(
  ownerId: string,
  input: CoverLetterArtifactInput,
  nowMs = Date.now(),
) {
  const replay = await artifactByOperation(ownerId, input.operationId);
  if (replay) {
    return replayReservation(ownerId, input, replay, nowMs);
  }

  if (await artifactById(ownerId, input.artifactId)) {
    throw new CoverLetterArtifactError(
      "cover_letter_artifact_conflict",
      "That immutable cover-letter artifact ID is already in use.",
      409,
      false,
    );
  }

  const resume = await d1().prepare(`SELECT 1 AS found FROM resume_revisions
    WHERE owner_id = ? AND resume_id = ? AND revision_id = ? LIMIT 1`)
    .bind(ownerId, input.resumeId, input.resumeRevisionId).first<{ found: number }>();
  if (!resume) {
    throw new CoverLetterArtifactError(
      "cover_letter_resume_revision_not_found",
      "The selected immutable résumé revision was not found.",
      409,
      false,
    );
  }

  if (input.parentRevisionId === null) {
    if (input.lineageId !== input.artifactId) {
      throw new CoverLetterArtifactError(
        "cover_letter_lineage_invalid",
        "An initial cover-letter revision must begin its own lineage.",
        409,
        false,
      );
    }
  } else {
    const parent = await artifactById(ownerId, input.parentRevisionId);
    if (!parent || parent.lineageId !== input.lineageId || parent.state !== "ready") {
      throw new CoverLetterArtifactError(
        "cover_letter_parent_invalid",
        "The parent cover-letter revision is unavailable or no longer current.",
        409,
        false,
      );
    }
  }

  const storageGeneration = crypto.randomUUID();
  try {
    await d1().prepare(`INSERT INTO cover_letter_artifacts (
      owner_id, artifact_id, lineage_id, parent_revision_id, operation_id,
      request_fingerprint, company, role, source_url, job_description_sha256,
      resume_id, resume_revision_id, evidence_fingerprint, storage_generation,
      state, visibility, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'owner_private', ?, ?)`)
      .bind(
        ownerId,
        input.artifactId,
        input.lineageId,
        input.parentRevisionId,
        input.operationId,
        input.requestFingerprint,
        input.company,
        input.role,
        input.sourceUrl,
        input.jobDescriptionSha256,
        input.resumeId,
        input.resumeRevisionId,
        input.evidenceFingerprint,
        storageGeneration,
        nowMs,
        nowMs,
      ).run();
  } catch {
    const raced = await artifactByOperation(ownerId, input.operationId);
    if (!raced) {
      throw new CoverLetterArtifactError(
        "cover_letter_reservation_conflict",
        "The cover-letter lineage changed while this revision was being reserved.",
        409,
        false,
      );
    }
    return replayReservation(ownerId, input, raced, nowMs);
  }

  const row = await artifactByOperation(ownerId, input.operationId);
  if (!row) throw new CoverLetterArtifactError(
    "cover_letter_reservation_uncertain",
    "The cover-letter reservation is not yet authoritative.",
    503,
    true,
  );
  return {
    duplicate: false,
    ownsStorageLease: true,
    replacedStorageGeneration: null,
    row,
    receipt: projectReceipt(row, []),
  };
}

export async function abandonCoverLetterArtifactReservation(
  ownerId: string,
  input: CoverLetterArtifactInput,
  storageGeneration: string,
) {
  await d1().prepare(`DELETE FROM cover_letter_artifacts
    WHERE owner_id = ? AND artifact_id = ? AND operation_id = ?
      AND request_fingerprint = ? AND storage_generation = ? AND state = 'pending'`)
    .bind(
      ownerId,
      input.artifactId,
      input.operationId,
      input.requestFingerprint,
      storageGeneration,
    ).run();
  const remaining = await artifactByOperation(ownerId, input.operationId);
  if (remaining?.state === "pending" && remaining.storageGeneration === storageGeneration) {
    throw new CoverLetterArtifactError(
      "cover_letter_reservation_uncertain",
      "The failed cover-letter upload lease could not be released authoritatively.",
      503,
      true,
    );
  }
}

export async function completeCoverLetterArtifact(
  ownerId: string,
  input: CoverLetterArtifactInput,
  storageGeneration: string,
  files: [CoverLetterFileIntegrity, CoverLetterFileIntegrity],
  nowMs = Date.now(),
) {
  const existing = await artifactByOperation(ownerId, input.operationId);
  if (!existing) throw new CoverLetterArtifactError(
    "cover_letter_reservation_not_found",
    "The cover-letter reservation was not found.",
    409,
    false,
  );
  assertExact(existing, input);
  if (existing.storageGeneration !== storageGeneration) throw new CoverLetterArtifactError(
    "cover_letter_storage_generation_conflict",
    "The cover-letter storage reservation changed.",
    409,
    false,
  );
  if (existing.state !== "pending") {
    return projectReceipt(existing, await filesForArtifact(ownerId, existing.artifactId));
  }

  const byFormat = new Map(files.map((file) => [file.format, file]));
  const docx = byFormat.get("docx");
  const pdf = byFormat.get("pdf");
  if (!docx || !pdf || byFormat.size !== 2) throw new CoverLetterArtifactError(
    "cover_letter_file_pair_invalid",
    "A complete DOCX/PDF pair is required.",
    400,
    false,
  );

  try {
    await d1().batch([
      ...[docx, pdf].map((file) => d1().prepare(`INSERT OR IGNORE INTO cover_letter_artifact_files (
        owner_id, artifact_id, format, sha256, byte_size, mime_type, filename, visibility, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'owner_private', ?)`)
        .bind(ownerId, input.artifactId, file.format, file.sha256, file.byteSize, file.mimeType, file.filename, nowMs)),
      d1().prepare(`UPDATE cover_letter_artifacts SET state = 'ready', ready_at = ?, updated_at = ?
        WHERE owner_id = ? AND artifact_id = ? AND operation_id = ?
          AND request_fingerprint = ? AND storage_generation = ? AND state = 'pending'
          AND 2 = (SELECT COUNT(*) FROM cover_letter_artifact_files
            WHERE owner_id = ? AND artifact_id = ?)
          AND EXISTS (SELECT 1 FROM cover_letter_artifact_files
            WHERE owner_id = ? AND artifact_id = ? AND format = 'docx'
              AND sha256 = ? AND byte_size = ? AND mime_type = ? AND filename = ?)
          AND EXISTS (SELECT 1 FROM cover_letter_artifact_files
            WHERE owner_id = ? AND artifact_id = ? AND format = 'pdf'
              AND sha256 = ? AND byte_size = ? AND mime_type = ? AND filename = ?)`)
        .bind(
          nowMs,
          nowMs,
          ownerId,
          input.artifactId,
          input.operationId,
          input.requestFingerprint,
          storageGeneration,
          ownerId,
          input.artifactId,
          ownerId,
          input.artifactId,
          docx.sha256,
          docx.byteSize,
          docx.mimeType,
          docx.filename,
          ownerId,
          input.artifactId,
          pdf.sha256,
          pdf.byteSize,
          pdf.mimeType,
          pdf.filename,
        ),
      ...(input.parentRevisionId ? [d1().prepare(`UPDATE cover_letter_artifacts
        SET state = 'superseded', superseded_at = ?, updated_at = ?
        WHERE owner_id = ? AND artifact_id = ? AND state = 'ready'
          AND EXISTS (SELECT 1 FROM cover_letter_artifacts child
            WHERE child.owner_id = ? AND child.artifact_id = ? AND child.state = 'ready')`)
        .bind(nowMs, nowMs, ownerId, input.parentRevisionId, ownerId, input.artifactId)] : []),
    ]);
  } catch {
    // Resolve an uncertain commit from authoritative D1 state below.
  }

  const completed = await artifactByOperation(ownerId, input.operationId);
  const storedFiles = await filesForArtifact(ownerId, input.artifactId);
  const expected = new Map(files.map((file) => [file.format, file]));
  const filesMatch = storedFiles.length === 2 && storedFiles.every((file) => {
    const wanted = expected.get(file.format);
    return wanted
      && wanted.sha256 === file.sha256
      && wanted.byteSize === file.byteSize
      && wanted.mimeType === file.mimeType
      && wanted.filename === file.filename;
  });
  if (!completed || completed.state !== "ready" || !filesMatch) {
    throw new CoverLetterArtifactError(
      "cover_letter_commit_uncertain",
      "The private cover-letter pair is staged but its metadata commit is not yet authoritative. Retry the exact operation.",
      503,
      true,
    );
  }
  return projectReceipt(completed, storedFiles);
}

export async function readCoverLetterOperation(ownerId: string, operationId: string) {
  const row = await artifactByOperation(ownerId, operationId);
  if (!row) return null;
  return projectReceipt(row, await filesForArtifact(ownerId, row.artifactId));
}

export async function readCoverLetterArtifactFile(
  ownerId: string,
  artifactId: string,
  format: CoverLetterFileFormat,
) {
  const row = await artifactById(ownerId, artifactId);
  if (!row || row.state === "pending") return null;
  const file = await d1().prepare(`${FILE_SELECT}
    WHERE owner_id = ? AND artifact_id = ? AND format = ?`)
    .bind(ownerId, artifactId, format).first<FileRow>();
  return file ? { artifact: row, file } : null;
}

export async function readCoverLetterLibrary(ownerId: string, limit = 100, cursor?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CoverLetterArtifactError(
    "cover_letter_limit_invalid",
    "The cover-letter page limit must be between 1 and 100.",
    400,
    false,
  );
  let boundary: { createdAt: number; artifactId: string } | null = null;
  if (cursor) {
    try {
      if (cursor.length > 2_048) throw new Error();
      const encoded = cursor.replace(/-/g, "+").replace(/_/g, "/");
      const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
      boundary = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
      if (!boundary
          || !Number.isInteger(boundary.createdAt)
          || boundary.createdAt < 0
          || typeof boundary.artifactId !== "string"
          || !/^[a-z0-9][a-z0-9._-]{0,199}$/.test(boundary.artifactId)) throw new Error();
    } catch {
      throw new CoverLetterArtifactError("cover_letter_cursor_invalid", "The cover-letter cursor is invalid.", 400, false);
    }
  }
  const boundarySql = boundary ? "AND (created_at < ? OR (created_at = ? AND artifact_id < ?))" : "";
  const bindings = boundary
    ? [ownerId, boundary.createdAt, boundary.createdAt, boundary.artifactId, limit + 1]
    : [ownerId, limit + 1];
  const result = await d1().prepare(`${ARTIFACT_SELECT}
    WHERE owner_id = ? AND state IN ('ready', 'superseded') ${boundarySql}
    ORDER BY created_at DESC, artifact_id DESC LIMIT ?`)
    .bind(...bindings).all<ArtifactRow>();
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const artifacts = await Promise.all(rows.map(async (row) => projectArtifact(row, await filesForArtifact(ownerId, row.artifactId))));
  const last = rows.at(-1);
  const nextCursor = hasMore && last
    ? btoa(JSON.stringify({ createdAt: last.createdAt, artifactId: last.artifactId })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : null;
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    artifacts,
    page: { hasMore, nextCursor },
  };
}
