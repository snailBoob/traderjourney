"use client";
import { OptionSelect } from "@/components/ui/option-select";

import { useState } from "react";
import { useApi, postJson } from "@/lib/use-api";
import { invalidatePendingJson } from "@/lib/api-request";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { fieldClass } from "@/components/filter-fields";
export function RuleChecklist({
  tradeKey,
  playbookId,
  showTitle = true,
  readOnly = false,
  className,
}: {
  tradeKey: string;
  playbookId: string | null;
  showTitle?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const url = `/api/trades/${encodeURIComponent(tradeKey)}/rules`;
  const bookIdForPost = playbookId;
  const { data, error, refresh } = useApi<{
      name: string | null;
      rules: { rule: string; followed: boolean | null }[];
    }>(`${url}?playbook=${playbookId ?? ""}`),
    [failure, setFailure] = useState("");
  const evaluated = data?.rules.filter((r) => r.followed !== null) ?? [],
    followed = evaluated.filter((r) => r.followed).length;
  return (
    <Card className={`flex h-full flex-col ${className ?? ""}`}>
      {showTitle && (
        <CardHeader>
          <CardTitle className="text-xs font-semibold tracking-wide">
            Strategy Rule Review
          </CardTitle>
        </CardHeader>
      )}
      <CardContent
        className={`flex min-h-40 flex-1 flex-col space-y-3 ${data?.name ? "" : "text-center"}`}
      >
        {data?.name ? (
          <>
            <p className="text-sm font-medium">{data.name}</p>
            <p className="text-xs text-muted-foreground">
              {evaluated.length
                ? `${Math.round((followed / evaluated.length) * 100)}% followed · `
                : ""}
              {evaluated.length}/{data.rules.length} rules assessed
            </p>
            {data.rules.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add rules to this strategy to review adherence.
              </p>
            )}
            {data.rules.map((r) => (
              <label
                key={r.rule}
                className="flex items-center justify-between gap-3 border-t pt-2 text-sm"
              >
                <span>{r.rule}</span>
                {readOnly ? (
                  <span
                    className={`shrink-0 ${r.followed === true ? "text-profit" : r.followed === false ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {r.followed === true
                      ? "Followed"
                      : r.followed === false
                        ? "Broken"
                        : "Not assessed"}
                  </span>
                ) : (
                  <OptionSelect
                    aria-label={r.rule}
                    className={`${fieldClass} !w-32 shrink-0`}
                    value={r.followed === null ? "unreviewed" : String(r.followed)}
                    onValueChange={async (next) => {
                      try {
                        await postJson(url, {
                          playbookId: bookIdForPost,
                          rule: r.rule,
                          followed: next === "unreviewed" ? null : next === "true",
                        });
                        invalidatePendingJson(`${url}?playbook=${playbookId ?? ""}`);
                        refresh();
                        setFailure("");
                      } catch (e) {
                        setFailure(String(e));
                      }
                    }}
                  >
                    <option value="unreviewed">Not assessed</option>
                    <option value="true">Followed</option>
                    <option value="false">Broken</option>
                  </OptionSelect>
                )}
              </label>
            ))}
          </>
        ) : (
          <p className="flex min-h-24 w-full flex-1 items-center justify-center text-center text-sm leading-6 text-muted-foreground">
            No strategy selected
          </p>
        )}
        {(error || failure) && (
          <p role="alert" className="text-xs text-destructive">
            {error || failure}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
