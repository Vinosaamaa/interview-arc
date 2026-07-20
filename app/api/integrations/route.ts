import {
  createIntegrationToken,
  listIntegrationTokens,
  revokeIntegrationToken,
} from "../../../db/integrations";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const rows = await listIntegrationTokens(ownerId);
    return Response.json({
      integrations: rows.map((row) => ({
        id: row.tokenHash,
        label: row.label,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      })),
    });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const body = (await request.json().catch(() => ({}))) as { label?: string };
    const token = await createIntegrationToken(ownerId, body.label ?? "Codex and Chrome companion");
    return Response.json({
      token,
      message: "Copy this token now. Interview Arc stores only its secure digest and cannot show it again.",
    });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const body = (await request.json()) as { id?: string };
    if (!body.id) return Response.json({ error: "Integration id is required." }, { status: 400 });
    await revokeIntegrationToken(ownerId, body.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
