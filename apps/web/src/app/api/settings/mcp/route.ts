import { z } from "zod";
import {
  InitializeResultSchema,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import { POST as handleMcpRequest } from "@/app/api/mcp/route";
import { MAX_MCP_CONNECTIONS, MCP_ACCESS } from "@/lib/mcp-settings";
import { bad, handler, ok } from "@/server/api";
import { passwordConfigured } from "@/server/auth";
import {
  createMcpConnection,
  listMcpConnections,
  revokeMcpConnection,
  setMcpEnabled,
} from "@/server/mcp-connections";

const newConnection = z.strictObject({
  name: z.string().trim().min(1).max(80),
  access: z.enum(MCP_ACCESS),
});
const connectionId = z.strictObject({ id: z.string().min(1).max(80) });
const connectionCheck = z.strictObject({ token: z.string().regex(/^[a-fA-F0-9]{64}$/) });

export const GET = handler(() => ok(listMcpConnections()));

function permitChange(request: Request) {
  if (!passwordConfigured()) return bad("Set an installation password in Security first.", 403);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  // Next's internal request URL may name the loopback server behind a proxy.
  // Match the browser's origin against the actual Host header, not forwarded headers.
  if (!origin || !host || !["https://", "http://"].some((scheme) => origin === scheme + host))
    return bad("Use TraderJourney Settings to manage this connection.", 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return bad("Expected a JSON request.", 415);
  return null;
}

export const POST = handler(async (request: Request) => {
  const denied = permitChange(request);
  if (denied) return denied;
  const body = newConnection.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Enter a connection name and select Read or Read/Write.");
  const created = createMcpConnection(body.data.name, body.data.access);
  return created
    ? ok(created, { status: 201 })
    : bad(`Maximum of ${MAX_MCP_CONNECTIONS} connections reached. Revoke one first.`, 409);
});

export const PATCH = handler(async (request: Request) => {
  const denied = permitChange(request);
  if (denied) return denied;
  const body = z
    .strictObject({ enabled: z.boolean() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Choose whether MCP access is on or off.");
  const { connections, legacyReadEnabled } = listMcpConnections();
  if (!connections.length && !legacyReadEnabled) return bad("Create an MCP connection first.", 409);
  setMcpEnabled(body.data.enabled);
  return ok({ enabled: body.data.enabled });
});

export const PUT = handler(async (request: Request) => {
  const denied = permitChange(request);
  if (denied) return denied;
  const body = connectionCheck.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Invalid MCP token.");
  if (!listMcpConnections().enabled) return bad("MCP is off. Turn it on before testing.", 409);

  // Exercise the real MCP handler in process: no outbound request, client-provided
  // URL or proxy headers. A handshake cannot invoke journal read or write tools.
  const response = await handleMcpRequest(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.data.token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "traderjourney-settings", version: "1" },
        },
      }),
    }),
  );
  if (response.status === 401 || response.status === 404)
    return bad("MCP rejected this token. Check that the connection is still active.", 422);
  if (response.ok) {
    const payload = await response.json().catch(() => null);
    if (InitializeResultSchema.safeParse(payload?.result).success) return ok({ connected: true });
  }
  return bad("The MCP server did not complete the connection test. Try again.", 502);
});

export const DELETE = handler(async (request: Request) => {
  const denied = permitChange(request);
  if (denied) return denied;
  const body = connectionId.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Choose a connection to revoke.");
  if (!revokeMcpConnection(body.data.id)) return bad("Connection not found.", 404);
  return ok({ revoked: true });
});
