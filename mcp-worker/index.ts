import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadContentIndex } from "../db/content";
import { resolveIntegrationOwner } from "../db/integrations";
import {
  applyTimerAction,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  upsertExtraActivity,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
} from "../db/live-state";
import { buildPracticeSnapshot, buildPublicationQueue, dateInPracticeTimeZone } from "../db/practice-snapshot";

interface Env {
  DB: D1Database;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = origin.startsWith("chrome-extension://") ? origin : "";
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(request: Request, body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders(request), "cache-control": "no-store", ...init.headers },
  });
}

function normalizeLeetCodeUrl(value: string) {
  try {
    const url = new URL(value);
    const match = url.hostname.endsWith("leetcode.com") && url.pathname.match(/^\/problems\/([a-z0-9-]+)/i);
    return match ? `https://leetcode.com/problems/${match[1].toLowerCase()}/` : "";
  } catch {
    return "";
  }
}

function titleFromLeetCodeUrl(value: string) {
  const normalized = normalizeLeetCodeUrl(value);
  const slug = normalized.match(/\/problems\/([^/]+)/)?.[1] ?? "leetcode-problem";
  const acronyms: Record<string, string> = { lru: "LRU", bfs: "BFS", dfs: "DFS", sql: "SQL", xor: "XOR" };
  return slug.split("-").map((word) => acronyms[word] ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

async function companionState(ownerId: string, request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? dateInPracticeTimeZone();
  const problemUrl = normalizeLeetCodeUrl(url.searchParams.get("url") ?? "");
  const snapshot = await buildPracticeSnapshot(ownerId, date);
  const currentActivity = problemUrl
    ? snapshot.activities.find((activity) => normalizeLeetCodeUrl(activity.url ?? "") === problemUrl) ?? null
    : null;
  return json(request, { ...snapshot, currentActivity });
}

async function companionMutation(ownerId: string, request: Request) {
  const body = (await request.json()) as {
    date?: string;
    mutation?:
      | { type: "timer"; activityId: string; action: TimerAction }
      | { type: "outcome"; activityId: string; outcome: OutcomeValue | null }
      | { type: "publication-status"; activityId: string; status: PublicationStatusValue }
      | { type: "activity-note"; activityId: string; note: string }
      | { type: "add-leetcode"; url: string };
  };
  const date = body.date ?? dateInPracticeTimeZone();
  const mutation = body.mutation;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !mutation) {
    return json(request, { error: "A valid date and mutation are required." }, { status: 400 });
  }
  const now = Date.now();
  if (mutation.type === "timer") {
    if (!mutation.activityId || !["start", "pause", "finish"].includes(mutation.action)) {
      return json(request, { error: "Invalid timer mutation." }, { status: 400 });
    }
    const snapshot = await buildPracticeSnapshot(ownerId, date);
    const activity = snapshot.activities.find((candidate) => candidate.id === mutation.activityId);
    const session = activity?.sessionId
      ? snapshot.sessions.find((candidate) => candidate.id === activity.sessionId)
      : undefined;
    if (mutation.action === "start" && session && !snapshot.sessionTimers[session.id]?.completed) {
      await applyTimerAction(ownerId, session.id, "session", "start", now, { activityIds: session.activityIds });
    }
    await applyTimerAction(ownerId, mutation.activityId, "activity", mutation.action, now, {
      sessionId: activity?.sessionId,
    });
  } else if (mutation.type === "outcome") {
    const snapshot = await buildPracticeSnapshot(ownerId, date);
    const activity = snapshot.activities.find((candidate) => candidate.id === mutation.activityId);
    await setOutcome(ownerId, mutation.activityId, mutation.outcome, now, activity?.sessionId);
  } else if (mutation.type === "publication-status") {
    if (!["draft", "ready", "published"].includes(mutation.status)) {
      return json(request, { error: "Invalid publication status." }, { status: 400 });
    }
    await setPublicationStatus(ownerId, mutation.activityId, date, mutation.status, now);
  } else if (mutation.type === "activity-note") {
    if (mutation.note.length > 20_000) return json(request, { error: "Note is too long." }, { status: 400 });
    await setActivityNote(ownerId, mutation.activityId, date, mutation.note, now);
  } else if (mutation.type === "add-leetcode") {
    const normalizedUrl = normalizeLeetCodeUrl(mutation.url);
    if (!normalizedUrl) return json(request, { error: "A public LeetCode problem URL is required." }, { status: 400 });
    const content = await loadContentIndex();
    const known = content.questionBanks.leetcode.find(
      (question) => normalizeLeetCodeUrl(question.url ?? "") === normalizedUrl,
    );
    const id = `${date}-extra-${normalizedUrl.match(/\/problems\/([^/]+)/)?.[1] ?? "leetcode"}-${now.toString(36)}`;
    await upsertExtraActivity(ownerId, {
      schemaVersion: 2,
      id,
      date,
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: known?.title ?? titleFromLeetCodeUrl(normalizedUrl),
      url: normalizedUrl,
      allocatedSeconds: (known?.targetMinutes ?? 30) * 60,
      timerGroupId: id,
      timingSource: "website",
      status: "planned",
      ...(known?.topics.length ? { notes: known.topics.join(", ") } : {}),
    }, now);
  }
  return companionState(ownerId, new Request(new URL(`/companion/state?date=${date}`, request.url), {
    headers: request.headers,
  }));
}

function createServer(ownerId: string) {
  const server = new McpServer({ name: "Interview Arc", version: "1.0.0" });

  server.registerTool(
    "get_today_practice",
    {
      description: "Read the authenticated owner's Interview Arc plan, timers, outcomes, notes, and publication state for one day.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ date }) => {
      const snapshot = await buildPracticeSnapshot(ownerId, date);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    "get_publication_queue",
    {
      description: "Read every activity ready for publication, grouped by America/Los_Angeles completion date. Failed attempts remain eligible for a postmortem.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ date }) => {
      const result = await buildPublicationQueue(ownerId, date);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { date: date ?? null, ...result },
      };
    },
  );

  server.registerTool(
    "mark_activities_published",
    {
      description: "Mark finalized Interview Arc activities as published after their repository artifacts have actually been written.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        activities: z.array(z.object({ activityId: z.string().min(1), artifactPath: z.string().min(1) })).min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ date, activities }) => {
      const now = Date.now();
      for (const activity of activities) {
        await setPublicationStatus(ownerId, activity.activityId, date, "published", now, activity.artifactPath);
      }
      return {
        content: [{ type: "text", text: `Marked ${activities.length} activit${activities.length === 1 ? "y" : "ies"} published.` }],
        structuredContent: { date, published: activities },
      };
    },
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (url.pathname === "/health") return json(request, { ok: true, service: "interview-arc-mcp" });

    const ownerId = await resolveIntegrationOwner(bearerToken(request));
    if (!ownerId) {
      return json(request, { error: "Unauthorized" }, {
        status: 401,
        headers: { "www-authenticate": "Bearer realm=\"Interview Arc\"" },
      });
    }

    if (url.pathname === "/companion/state" && request.method === "GET") {
      return companionState(ownerId, request);
    }
    if (url.pathname === "/companion/mutations" && request.method === "POST") {
      return companionMutation(ownerId, request);
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return createMcpHandler(createServer(ownerId))(request, env, ctx);
    }
    return json(request, { error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
