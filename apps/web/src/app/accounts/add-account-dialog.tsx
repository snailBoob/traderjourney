"use client";
import { requestJson } from "@/lib/request-json";

import { Button } from "@/components/ui/button";
import { BrokerLogo } from "@/components/broker-logo";
import { brokerDetails, syncSummary } from "@/lib/brokers";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson } from "@/lib/use-api";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { AccountMessage } from "./types";
export function AddAccountDialog({
  refresh,
  setMessage,
}: {
  refresh: () => void;
  setMessage: (message: AccountMessage) => void;
}) {
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addAccountType, setAddAccountType] = useState<"broker" | "manual" | null>(null);
  const [brokerId, setBrokerId] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [brokerCredentials, setBrokerCredentials] = useState<Record<string, string>>({});
  const [syncStartAt, setSyncStartAt] = useState("");
  const [syncDateValid, setSyncDateValid] = useState(true);
  const [manualName, setManualName] = useState("");
  const [manualCurrency, setManualCurrency] = useState("USD");
  const [manualInitialBalance, setManualInitialBalance] = useState("");
  const [manualProfitCalcMethod, setManualProfitCalcMethod] = useState<"fifo" | "lifo" | "wavg">(
    "fifo",
  );
  const [brokers, setBrokers] = useState<
    {
      id: string;
      displayName: string;
      credentials: { key: string; label: string; secret?: boolean }[];
      readOnlySetup: string;
    }[]
  >([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addPhase, setAddPhase] = useState<"creating" | "syncing" | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const loadBrokers = async () => {
    try {
      const json = await requestJson<{ brokers: typeof brokers }>("/api/brokers");
      setBrokers(json.brokers);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not load brokers");
    }
  };

  const resetAddAccount = () => {
    setAddAccountType("broker");
    setBrokerId("");
    setBrokerName("");
    setBrokerCredentials({});
    setSyncStartAt("");
    setSyncDateValid(true);
    setManualName("");
    setManualCurrency("USD");
    setManualInitialBalance("");
    setManualProfitCalcMethod("fifo");
    setAddError(null);
    setAddPhase(null);
  };
  const openAddAccount = () => {
    resetAddAccount();
    setAddAccountOpen(true);
    void loadBrokers();
  };

  const selectedBroker = brokers.find((broker) => broker.id === brokerId) ?? null;
  const details = brokerDetails(brokerId);

  const createAccount = async () => {
    setAddBusy(true);
    setAddPhase("creating");
    setAddError(null);
    try {
      if (addAccountType === "manual") {
        await postJson("/api/accounts", {
          name: manualName.trim(),
          kind: "manual",
          currency: manualCurrency.trim().toUpperCase(),
          initialBalance: Number(manualInitialBalance || 0),
          profitCalcMethod: manualProfitCalcMethod,
        });
        setAddAccountOpen(false);
        resetAddAccount();
        refresh();
        return;
      }

      if (addAccountType === "broker" && selectedBroker) {
        if (selectedBroker.id === "bitunix" && !syncStartAt) {
          setAddError("Sync start date is required.");
          return;
        }
        const result = await postJson<{ id: string }>("/api/accounts", {
          name: brokerName.trim() || selectedBroker.displayName,
          kind: "sync",
          broker: selectedBroker.id,
          credentials: brokerCredentials,
          initialSync: false,
          ...(syncStartAt && details.startDate !== "none"
            ? { syncStartAt: `${syncStartAt}T00:00:00.000Z` }
            : {}),
        });

        setAddPhase("syncing");
        try {
          const { sync: syncResult } = await postJson<{
            sync: {
              inserted: number;
              fetched: number;
              duplicates: number;
              skipped: number;
              skippedReasons: string[];
              message?: string;
            };
          }>(`/api/accounts/${result.id}/actions`, { action: "sync" });
          setMessage({
            title: "Account created",
            body: syncResult.message ?? syncSummary(syncResult),
          });
        } catch (error) {
          setMessage({
            title: "Account created — sync failed",
            body: error instanceof Error ? error.message : "Sync failed",
          });
        }
        setAddAccountOpen(false);
        resetAddAccount();
        refresh();
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not create account");
    } finally {
      setAddBusy(false);
      setAddPhase(null);
    }
  };
  return (
    <>
      {" "}
      <Button onClick={openAddAccount}>
        <Plus />
        Add account
      </Button>
      <Dialog
        open={addAccountOpen}
        onOpenChange={(open) => {
          if (!open) resetAddAccount();
          setAddAccountOpen(open);
        }}
      >
        <DialogContent className="add-account-dialog sm:max-w-xl">
          <DialogHeader className="account-dialog-header">
            <DialogTitle>Add account</DialogTitle>
          </DialogHeader>
          <Tabs
            value={addAccountType ?? undefined}
            onValueChange={(value) => {
              setAddAccountType(value as "broker" | "manual");
              setAddError(null);
            }}
            className="account-dialog-tabs w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="broker" className="flex-1">
                Broker
              </TabsTrigger>
              <TabsTrigger value="manual" className="flex-1">
                Manual
              </TabsTrigger>
            </TabsList>

            <div className="min-h-[420px]">
              <TabsContent value="broker">
                <div className="space-y-4">
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">Broker</Label>
                    <Select
                      value={brokerId}
                      onValueChange={(value) => {
                        setBrokerId(value);
                        const next = brokers.find((broker) => broker.id === value);
                        setBrokerName(next?.displayName ?? "");
                        setBrokerCredentials({});
                        setSyncStartAt("");
                        setSyncDateValid(true);
                        setAddError(null);
                      }}
                    >
                      <SelectTrigger>
                        {brokerId && <BrokerLogo broker={brokerId} />}
                        <SelectValue placeholder="Choose a broker" />
                      </SelectTrigger>
                      <SelectContent>
                        {brokers.map((broker) => (
                          <SelectItem key={broker.id} value={broker.id}>
                            {broker.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedBroker && (
                    <>
                      <div>
                        <Label className="mb-1 block text-xs text-muted-foreground">
                          Account name
                        </Label>
                        <Input
                          value={brokerName}
                          onChange={(event) => setBrokerName(event.target.value)}
                        />
                      </div>
                      <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Read-only access required
                        </span>
                        <br />
                        {selectedBroker.readOnlySetup ||
                          "TraderJourney only reads your trading history and never places or modifies orders."}
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {details.historyNote}
                      </p>
                      {selectedBroker.credentials.map((field) => (
                        <div key={field.key}>
                          <Label className="mb-1 block text-xs text-muted-foreground">
                            {field.label}
                          </Label>
                          <Input
                            type={field.secret ? "password" : "text"}
                            value={brokerCredentials[field.key] ?? ""}
                            onChange={(event) =>
                              setBrokerCredentials((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            autoComplete="off"
                          />
                        </div>
                      ))}
                      {details.startDate !== "none" && (
                        <div>
                          <Label className="mb-1 block text-xs text-muted-foreground">
                            Sync start date{details.startDate === "optional" ? " (optional)" : ""}
                          </Label>
                          <DatePicker
                            key={brokerId}
                            label="Sync start date"
                            value={syncStartAt}
                            onValueChange={setSyncStartAt}
                            onValidityChange={setSyncDateValid}
                          />
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {details.startDate === "optional"
                              ? "Leave blank to use the broker’s default history. "
                              : ""}
                            Dates are in UTC. An earlier date cannot extend the broker’s history
                            limit.
                          </p>
                        </div>
                      )}
                      {addError && <p className="text-sm text-loss">{addError}</p>}
                      <div className="account-dialog-actions flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setAddAccountOpen(false);
                            resetAddAccount();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void createAccount()}
                          disabled={
                            addBusy ||
                            !syncDateValid ||
                            !brokerName.trim() ||
                            selectedBroker.credentials.some(
                              (field) =>
                                !/optional/i.test(field.label) &&
                                !brokerCredentials[field.key]?.trim(),
                            ) ||
                            (selectedBroker.id === "bitunix" && !syncStartAt)
                          }
                        >
                          {addPhase === "syncing"
                            ? "Syncing…"
                            : addBusy
                              ? "Creating…"
                              : "Create account"}
                        </Button>
                      </div>
                    </>
                  )}
                  {!selectedBroker && addError && <p className="text-sm text-loss">{addError}</p>}
                </div>
              </TabsContent>

              <TabsContent value="manual">
                <div className="space-y-4">
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">Account name</Label>
                    <Input
                      value={manualName}
                      onChange={(event) => setManualName(event.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">Currency</Label>
                    <Input
                      value={manualCurrency}
                      onChange={(event) => setManualCurrency(event.target.value.toUpperCase())}
                      maxLength={3}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">
                      Initial balance
                    </Label>
                    <Input
                      value={manualInitialBalance}
                      onChange={(event) => setManualInitialBalance(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">
                      Profit calculation method
                    </Label>
                    <Select
                      value={manualProfitCalcMethod}
                      onValueChange={(value) =>
                        setManualProfitCalcMethod(value as "fifo" | "lifo" | "wavg")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fifo">FIFO</SelectItem>
                        <SelectItem value="lifo">LIFO</SelectItem>
                        <SelectItem value="wavg">Weighted average</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {addError && <p className="text-sm text-loss">{addError}</p>}
                  <div className="account-dialog-actions flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAddAccountOpen(false);
                        resetAddAccount();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void createAccount()}
                      disabled={addBusy || !manualName.trim()}
                    >
                      {addPhase === "syncing"
                        ? "Syncing…"
                        : addBusy
                          ? "Creating…"
                          : "Create account"}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
