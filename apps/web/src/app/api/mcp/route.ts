import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handler } from "@/server/api";
import { createJournalMcpServer } from "@/server/journal-mcp";
import { authorizeMcp } from "@/server/mcp-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function authorize(request: Request) {
  // This endpoint is for non-browser clients. Reject browser origins regardless of Host.
  if (request.headers.has("Origin")) return new Response(null, { status: 403, headers: noStore });
  const access = authorizeMcp(request.headers.get("Authorization"));
  if (access === "disabled") return new Response(null, { status: 404, headers: noStore });
  if (access === "unauthorized")
    return new Response(null, {
      status: 401,
      headers: { ...noStore, "WWW-Authenticate": "Bearer" },
    });
  return access;
}

// Called only after the independent MCP credential check. Keep the existing
// data-access lock (e.g. while the SQLite database is being restored).
const handleMessage = handler(
  async (request: Request) => {
    const access = authorize(request);
    if (access instanceof Response) return access;
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const publicUrl = new URL(request.url);
    // Next may use its internal listener hostname in request.url.
    publicUrl.host = request.headers.get("host") ?? publicUrl.host;
    const server = createJournalMcpServer(access, publicUrl.origin);
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", noStore["Cache-Control"]);
      return new Response(response.body, { status: response.status, headers });
    } finally {
      await server.close();
    }
  },
  { public: true },
);

// Stateless JSON mode does not offer a standalone SSE stream or session deletion.
export const POST = handleMessage;
export const GET = handler(
  (request: Request) => {
    const access = authorize(request);
    return access instanceof Response
      ? access
      : new Response(null, { status: 405, headers: { ...noStore, Allow: "POST" } });
  },
  { public: true },
);

export const DELETE = GET;
