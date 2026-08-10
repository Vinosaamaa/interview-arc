import { readLiveState } from "../../db/live-state";
import {
  executePracticeStateCommand,
  PracticeStateCommandInputError,
  type PracticeStateCommand,
} from "../../db/practice-state-commands";

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const body = request.method === "POST"
        ? await request.json() as {
            ownerId?: string;
            date?: string;
            now?: number;
            command?: PracticeStateCommand;
          }
        : {};
      const ownerId = body.ownerId ?? url.searchParams.get("ownerId") ?? "";
      const date = body.date ?? url.searchParams.get("date") ?? "";
      if (!ownerId || !date) return Response.json({ error: "Missing test scope." }, { status: 400 });
      if (request.method === "GET" && url.pathname === "/state") {
        return Response.json(await readLiveState(ownerId, date));
      }
      if (request.method === "POST" && url.pathname === "/command" && body.command) {
        const result = await executePracticeStateCommand(ownerId, date, body.command, body.now ?? Date.now());
        return Response.json({
          ...(await readLiveState(ownerId, date)),
          ...(result.mutationReceipt ? { mutationReceipt: result.mutationReceipt } : {}),
        });
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      if (error instanceof PracticeStateCommandInputError) {
        return Response.json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
        }, { status: error.status });
      }
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
    }
  },
};

export default worker;
