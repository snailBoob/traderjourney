"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_MCP_CONNECTIONS,
  MCP_GUIDE,
  MCP_SETTINGS_CHANGED,
  MCP_SETTINGS_ENDPOINT as endpoint,
  REVIEW_FOLDER,
  type McpAccess,
  type McpSettingsData,
} from "@/lib/mcp-settings";
import { postJson, useApi } from "@/lib/use-api";

interface Connection {
  id: string;
  name: string;
  access: McpAccess;
}
const accessLabel = (access: McpAccess) => (access === "read" ? "Read" : "Read/Write");

function SetupPrompt({ url }: { url: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("");
  const prompt = `Help me connect TraderJourney to this MCP client. The server URL is ${url}. It uses Streamable HTTP with Bearer token authentication. Tell me where to enter the token securely in this client. Do not ask me to paste it into this chat. Once connected, verify the connection by retrieving the TraderJourney MCP guide without changing anything. If this client does not support the required transport or authentication, or cannot reach the server, explain what is blocking the connection.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Setup prompt copied.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus("Text selected. Copy it with Ctrl+C or ⌘C.");
    }
  }

  return (
    <details className="basis-full">
      <summary className="cursor-pointer font-medium">Setup prompt</summary>
      <div className="mt-2 space-y-2">
        <textarea
          ref={field}
          aria-label="MCP setup prompt"
          readOnly
          rows={7}
          value={prompt}
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          Copy setup prompt
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      </div>
    </details>
  );
}

export function McpSettings() {
  const { data, error, refresh } = useApi<McpSettingsData>(endpoint);
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL("/api/mcp", window.location.origin).href);
    window.addEventListener(MCP_SETTINGS_CHANGED, refresh);
    return () => window.removeEventListener(MCP_SETTINGS_CHANGED, refresh);
  }, [refresh]);
  const atCapacity = (data?.connections.length ?? 0) >= MAX_MCP_CONNECTIONS;
  const [name, setName] = useState("");
  const [access, setAccess] = useState<McpAccess>("read");
  const [created, setCreated] = useState<{ connection: Connection; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [failure, setFailure] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    setTestPassed(false);
    try {
      setCreated(await postJson(endpoint, { name: name.trim(), access }));
      setName("");
      setAccess("read");
      window.dispatchEvent(new Event(MCP_SETTINGS_CHANGED));
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not create the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(token: string) {
    setTesting(true);
    setTestPassed(false);
    setFailure("");
    try {
      await postJson(endpoint, { token }, "PUT");
      setTestPassed(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setFailure("");
    try {
      await postJson(endpoint, { id }, "DELETE");
      if (created?.connection.id === id) setCreated(null);
      setPendingRevoke(null);
      window.dispatchEvent(new Event(MCP_SETTINGS_CHANGED));
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not revoke the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="mcp-settings">
      <CardHeader>
        <CardTitle>MCP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>
          Connect your AI assistant to TraderJourney. TraderJourney does not need a model provider
          key.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>Read:</strong> read trades, trade notes and daily journal notes.
          </li>
          <li>
            <strong>Read/Write:</strong> also save new reviews to Notes → {REVIEW_FOLDER}. Cannot
            change trades or edit or delete existing notes.
          </li>
        </ul>
        <details>
          <summary className="cursor-pointer font-medium">Open MCP guide</summary>
          <dl className="mt-2 space-y-3 text-muted-foreground">
            {MCP_GUIDE.map(({ title, text }) => (
              <div key={title}>
                <dt className="font-semibold">{title}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </details>
        {data?.legacyReadEnabled && (
          <p className="text-muted-foreground">
            The server-configured token is active with Read access. Manage it on the server.
          </p>
        )}
        {data && !data.canManage && (
          <p>Set an installation password in Security first to create and manage connections.</p>
        )}
        {data?.canManage && (
          <p>
            {data.connections.length} / {MAX_MCP_CONNECTIONS} connections
            {atCapacity ? " · Revoke a connection to free a slot." : ""}
          </p>
        )}
        {data?.enabled === false && <p>MCP access is off. Your connections are still saved.</p>}
        {data?.canManage && (
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="mcp-name">Connection name</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your connection"
                maxLength={80}
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="mcp-access">Access</Label>
              <select
                id="mcp-access"
                className="h-9 rounded-md border border-input bg-background px-2"
                value={access}
                onChange={(e) => setAccess(e.target.value as McpAccess)}
              >
                <option value="read">Read</option>
                <option value="read-write">Read/Write</option>
              </select>
            </div>
            <Button disabled={busy || atCapacity || !name.trim() || Boolean(created)}>
              Create connection
            </Button>
          </form>
        )}
        {created && (
          <div className="space-y-2 rounded-md border p-3">
            <p>
              Copy this token now. It won’t be shown again. Enter it in your MCP client’s secure
              settings, not in chat. The setup prompt is available under the connection below.
            </p>
            <Label htmlFor="mcp-token">Connection token</Label>
            <Input
              id="mcp-token"
              readOnly
              value={created.token}
              onFocus={(e) => e.target.select()}
              className="font-mono"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || testing}
                onClick={() => void testConnection(created.token)}
              >
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={testing}
                onClick={() => setCreated(null)}
              >
                Hide token
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This checks the token in TraderJourney. To verify your client setup, ask your
              assistant to retrieve the TraderJourney MCP guide.
            </p>
            <div role="status">{testPassed && "TraderJourney accepted the token."}</div>
          </div>
        )}
        {data?.connections.length ? (
          <ul className="space-y-2">
            {data.connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
              >
                <span className="break-all">
                  {connection.name} · {accessLabel(connection.access)}
                </span>
                {pendingRevoke === connection.id ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={busy || testing}
                      onClick={() => void revoke(connection.id)}
                    >
                      Confirm revoke
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingRevoke(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || testing || !data.canManage}
                    onClick={() => setPendingRevoke(connection.id)}
                  >
                    Revoke
                  </Button>
                )}
                {url && <SetupPrompt url={url} />}
              </li>
            ))}
          </ul>
        ) : null}
        {(failure || error) && (
          <p role="alert" className="text-destructive">
            {failure || error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
