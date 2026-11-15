"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJson, useApi } from "@/lib/use-api";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type SecuritySettings as Settings,
} from "@/lib/security-settings";

export function SecuritySettings() {
  const { data, error, refresh } = useApi<Settings>("/api/settings/security");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");

  async function save(action: "set" | "remove") {
    if (busy) return;
    setFailure("");
    setSaved("");
    if (data?.configured && !currentPassword) {
      setFailure("Enter your current password.");
      return;
    }
    if (action === "set" && newPassword !== confirmPassword) {
      setFailure("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await postJson(
        "/api/settings/security",
        { action, currentPassword, newPassword, confirmPassword },
        "PUT",
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (action === "set") window.location.assign("/login");
      else {
        setSaved("Password removed. Login is no longer required.");
        refresh();
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save password settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data && !error && (
          <p className="text-sm text-muted-foreground">Loading password settings…</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data?.managedByEnvironment ? (
          <p className="text-sm text-muted-foreground">
            Password is managed by server configuration (JOURNAL_PASSWORD). Change it there and
            restart the server.
          </p>
        ) : (
          data && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save("set");
              }}
            >
              <p className="text-sm text-muted-foreground">
                {data.configured
                  ? "Password protection is enabled."
                  : "No password is set. Anyone who can reach this journal can open it."}{" "}
                Saving a password signs out all sessions, including this one.
              </p>
              {data.configured && (
                <div className="space-y-1">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={MAX_PASSWORD_LENGTH}
                    value={currentPassword}
                    disabled={busy}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={newPassword}
                  disabled={busy}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={confirmPassword}
                  disabled={busy}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              {failure && (
                <p role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              )}
              {saved && (
                <p role="status" className="text-sm text-muted-foreground">
                  {saved}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : data.configured ? "Change password" : "Set password"}
                </Button>
                {data.configured && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void save("remove")}
                  >
                    Remove password
                  </Button>
                )}
              </div>
            </form>
          )
        )}
      </CardContent>
    </Card>
  );
}
