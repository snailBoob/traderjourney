"use client";

import { useEffect, useState } from "react";
import { Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MCP_SETTINGS_CHANGED,
  MCP_SETTINGS_ENDPOINT,
  type McpSettingsData,
} from "@/lib/mcp-settings";
import { postJson, useApi } from "@/lib/use-api";

export function useMcpAccess(visible: boolean) {
  const { data, refresh } = useApi<McpSettingsData>(visible ? MCP_SETTINGS_ENDPOINT : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.addEventListener(MCP_SETTINGS_CHANGED, refresh);
    return () => window.removeEventListener(MCP_SETTINGS_CHANGED, refresh);
  }, [refresh]);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await postJson(MCP_SETTINGS_ENDPOINT, { enabled }, "PATCH");
      window.dispatchEvent(new Event(MCP_SETTINGS_CHANGED));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change MCP access.");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (iconOnly = false) => {
    if (!data || (!data.connections.length && !data.legacyReadEnabled)) return null;
    const { enabled, canManage } = data;
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          variant={enabled ? "secondary" : "outline"}
          className={iconOnly ? "h-9 w-9 rounded-lg p-0" : "w-full justify-start gap-2"}
          role="switch"
          aria-label="MCP access"
          aria-checked={enabled}
          disabled={busy || !canManage}
          title={
            canManage
              ? "Turn all MCP access on or off"
              : "Set an installation password in Security to manage MCP access"
          }
          onClick={() => void setEnabled(!enabled)}
        >
          {enabled ? <Plug /> : <Unplug />}
          {!iconOnly && (
            <>
              MCP<span className="ml-auto text-xs">{enabled ? "On" : "Off"}</span>
            </>
          )}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  };
}
