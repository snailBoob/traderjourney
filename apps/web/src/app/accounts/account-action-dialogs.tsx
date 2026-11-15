"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson } from "@/lib/use-api";
import type { AccountMessage, AccountRow } from "./types";
export function AccountConfirmationDialog({
  confirmAction,
  setConfirmAction,
  action,
  refresh,
  setMessage,
}: {
  confirmAction: { type: "delete" | "clear"; account: AccountRow } | null;
  setConfirmAction: (value: null) => void;
  action: (id: string, body: Record<string, unknown>) => Promise<unknown>;
  refresh: () => void;
  setMessage: (message: AccountMessage) => void;
}) {
  return (
    <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {confirmAction?.type === "delete" ? "Delete account?" : "Clear trades?"}
          </DialogTitle>
          <DialogDescription>
            {confirmAction?.type === "delete"
              ? `Delete “${confirmAction.account.name}” and all its trades? This cannot be undone.`
              : `Clear all trades from “${confirmAction?.account.name}”? The account stays.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setConfirmAction(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={async () => {
              if (!confirmAction) return;
              try {
                if (confirmAction.type === "delete") {
                  await postJson(`/api/accounts/${confirmAction.account.id}`, undefined, "DELETE");
                } else {
                  await action(confirmAction.account.id, { action: "clear" });
                }
                setConfirmAction(null);
                refresh();
              } catch (e) {
                setMessage({
                  title: "Action failed",
                  body: e instanceof Error ? e.message : "Action failed",
                });
              }
            }}
          >
            {" "}
            {confirmAction?.type === "delete" ? "Delete" : "Clear trades"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function AccountTransferDialog({
  transferSource,
  setTransferSource,
  transferTarget,
  setTransferTarget,
  data,
  action,
  setMessage,
}: {
  transferSource: AccountRow | null;
  setTransferSource: (value: null) => void;
  transferTarget: string;
  setTransferTarget: (id: string) => void;
  data?: { accounts: AccountRow[] } | null;
  action: (id: string, body: Record<string, unknown>) => Promise<unknown>;
  setMessage: (message: AccountMessage) => void;
}) {
  return (
    <Dialog
      open={transferSource !== null}
      onOpenChange={(open) => !open && setTransferSource(null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer data</DialogTitle>
          <DialogDescription>
            Transfer all data from “{transferSource?.name}” into another account.
          </DialogDescription>
        </DialogHeader>
        {transferSource && (
          <Select value={transferTarget} onValueChange={setTransferTarget}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data?.accounts
                .filter((candidate) => candidate.id !== transferSource.id)
                .map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setTransferSource(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={async () => {
              if (!transferSource || !transferTarget) return;
              try {
                await action(transferSource.id, {
                  action: "transfer",
                  toAccountId: transferTarget,
                });
                setTransferSource(null);
              } catch (e) {
                setMessage({
                  title: "Transfer failed",
                  body: e instanceof Error ? e.message : "Transfer failed",
                });
              }
            }}
          >
            Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
