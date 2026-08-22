import {
  websiteAddLoopRoundSchema,
  websiteCreateLoopSchema,
  type WebsiteAddLoopRoundInput,
  type WebsiteCreateLoopInput,
} from "./loop-policy.ts";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function calendarDateAtNoonUtc(value: string) {
  return Date.parse(`${value}T12:00:00.000Z`);
}

function explicitAmbiguities(unknowns: WebsiteCreateLoopInput["unknowns"]) {
  const labels: Record<WebsiteCreateLoopInput["unknowns"][number], string> = {
    location: "Location is not yet known.",
    openedOn: "The hiring process opened date is not yet known.",
    stages: "Interview stages are not yet known.",
    jobDescriptionText: "Job-description text has not been supplied; only its source may be recorded.",
  };
  return unknowns.map((unknown) => labels[unknown]);
}

async function stableServerId(ownerId: string, operationId: string, scope: string) {
  return (await sha256(`${scope}\u001f${ownerId}\u001f${operationId}`)).slice(0, 32);
}

export async function buildWebsiteLoopCommand(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = websiteCreateLoopSchema.parse(inputValue);
  const loopId = `loop-${await stableServerId(ownerId, input.operationId, "loop")}`;
  const source = input.jobDescription.text
    ? {
      kind: input.jobDescription.sourceUrl ? "public_posting" as const : "pasted_jd" as const,
      displayLocator: input.jobDescription.sourceUrl ?? "Pasted job description",
      capturedAt: nowMs,
      jdText: input.jobDescription.text,
    }
    : {
      kind: "public_posting_reference" as const,
      displayLocator: input.jobDescription.sourceUrl!,
      capturedAt: nowMs,
    };
  const stages = await Promise.all(input.stages.map(async (stage, index) => ({
    stageId: `stage-${await stableServerId(ownerId, input.operationId, `stage-${index}`)}`,
    label: stage.label,
    order: index,
    status: stage.status,
    ...(stage.scheduledOn ? { scheduledAt: calendarDateAtNoonUtc(stage.scheduledOn) } : {}),
    ...(stage.format ? { format: stage.format } : {}),
  })));
  return {
    operationId: input.operationId,
    authorization: "website_owner",
    loop: {
      loopId,
      state: "active",
      company: input.company,
      roleTitle: input.roleTitle,
      ...(input.jobDescription.sourceUrl ? { jobReference: input.jobDescription.sourceUrl } : {}),
      ...(input.location ? { location: input.location } : {}),
      status: "active",
      ...(input.openedOn ? { openedAt: calendarDateAtNoonUtc(input.openedOn) } : {}),
      outcome: null,
      stages,
    },
    roleBrief: {
      label: `${input.company} · ${input.roleTitle}`,
      state: "active",
      company: input.company,
      roleTitle: input.roleTitle,
      ...(input.location ? { location: input.location } : {}),
      responsibilities: [],
      requiredQualifications: [],
      preferredQualifications: [],
      competencySignals: [],
      seniorityIndicators: [],
      domainVocabulary: [],
      verifiedCompanySignals: [],
      unresolvedAmbiguities: explicitAmbiguities(input.unknowns),
      ownerNotes: [],
      source,
    },
  } as const;
}

export async function createLoopFromWebsite(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const command = await buildWebsiteLoopCommand(ownerId, inputValue, nowMs);
  const { createLoopCommand } = await import("./loops.ts");
  const result = await createLoopCommand(ownerId, command, nowMs);
  const input = websiteCreateLoopSchema.parse(inputValue);
  return { ...result, receiptId: input.operationId };
}

export async function buildWebsiteAddRoundCommand(
  ownerId: string,
  inputValue: unknown,
) {
  const input = websiteAddLoopRoundSchema.parse(inputValue);
  return {
    operationId: input.operationId,
    loopId: input.loopId,
    expectedLoopRevision: input.expectedLoopRevision,
    authorization: "website_owner",
    stage: {
      stageId: `stage-${await stableServerId(ownerId, input.operationId, "round")}`,
      label: input.label,
      status: input.status,
      ...(input.scheduledOn ? { scheduledAt: calendarDateAtNoonUtc(input.scheduledOn) } : {}),
      ...(input.format ? { format: input.format } : {}),
    },
  } as const;
}

export async function addLoopRoundFromWebsite(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const command = await buildWebsiteAddRoundCommand(ownerId, inputValue);
  const { addLoopRoundCommand } = await import("./loops.ts");
  const result = await addLoopRoundCommand(ownerId, command, nowMs);
  const input = websiteAddLoopRoundSchema.parse(inputValue) as WebsiteAddLoopRoundInput;
  return { ...result, receiptId: input.operationId };
}
